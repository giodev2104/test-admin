-- =====================================================================
--  Velority · Plan Tienda, entrar con enlace y «Recomienda y gana»
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de supabase_ficha_auto.sql.
-- No borra datos y se puede ejecutar varias veces.
--
--   · Plan «Mantenimiento Tienda» (WooCommerce): 89 €/mes o 890 €/año, 3 tokens al mes.
--   · Entrar sin contraseña: el portal pide un enlace (función «correo», acción «enlace») que dura 15 minutos
--     y sirve una sola vez.
--   · Recomienda y gana: cada cliente tiene un código; quien se registra con su enlace queda apuntado y,
--     cuando contrata (su primer caso pasa a «Aceptado» o paga un pedido), quien le recomendó gana 1 token
--     de regalo (webs_cliente.tokens_regalo, no caduca a fin de mes).
-- =====================================================================

-- 1) Plan Tienda
insert into public.catalogo (nombre, tipo, precio, precio_anual, cada, orden, tokens_mes)
values ('Mantenimiento Tienda', 'mantenimiento', 89, 890, 1, 22, 3)
on conflict (nombre) do nothing;

-- 2) Entrar con un enlace al correo
alter table public.recuperaciones add column if not exists tipo text not null default 'clave';

create or replace function public.servidor_crear_enlace(p_email text, p_ip text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare c clientes; t text;
begin
  if _excedido('enlace-ip:' || coalesce(p_ip, ''), 8, interval '1 hour') then
    return json_build_object('error', 'limite');
  end if;
  perform _anotar('enlace-ip:' || coalesce(p_ip, ''));
  select * into c from clientes where email = lower(trim(coalesce(p_email, '')));
  if c.id is null then return null; end if;
  if exists (select 1 from recuperaciones where cliente_id = c.id and tipo = 'enlace' and creado_en > now() - interval '1 minute') then
    return json_build_object('error', 'reciente');
  end if;
  delete from recuperaciones where expira_en < now() - interval '1 day';
  t := encode(gen_random_bytes(32), 'hex');
  insert into recuperaciones (token_hash, cliente_id, tipo, expira_en)
    values (encode(digest(t, 'sha256'), 'hex'), c.id, 'enlace', now() + interval '15 minutes');
  return json_build_object('token', t, 'nombre', c.nombre, 'email', c.email);
end
$$;
revoke all on function public.servidor_crear_enlace(text, text) from public, anon, authenticated;

create or replace function public.cliente_entrar_enlace(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare r recuperaciones;
begin
  select * into r from recuperaciones
    where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and tipo = 'enlace' and usado_en is null and expira_en > now();
  if r.token_hash is null then
    raise exception 'El enlace ha caducado o ya se usó. Pide otro desde «Entrar sin contraseña».';
  end if;
  update recuperaciones set usado_en = now() where token_hash = r.token_hash;
  return _cliente_sesion(r.cliente_id);
end
$$;
revoke all on function public.cliente_entrar_enlace(text) from public;
grant execute on function public.cliente_entrar_enlace(text) to anon, authenticated;

-- El enlace para cambiar la contraseña solo acepta enlaces de recuperación (no los de entrar)
create or replace function public.cliente_restablecer_clave(p_token text, p_clave text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare r recuperaciones;
begin
  if length(coalesce(p_clave, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres.'; end if;
  select * into r from recuperaciones
    where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and tipo = 'clave' and usado_en is null and expira_en > now();
  if r.token_hash is null then
    raise exception 'El enlace ha caducado o ya se usó. Pide uno nuevo desde «¿Has olvidado tu contraseña?».';
  end if;
  update recuperaciones set usado_en = now() where token_hash = r.token_hash;
  update clientes set clave_hash = crypt(p_clave, gen_salt('bf')) where id = r.cliente_id;
  delete from sesiones_cliente where cliente_id = r.cliente_id;
  return _cliente_sesion(r.cliente_id);
end
$$;

-- 3) Recomienda y gana
alter table public.clientes add column if not exists codigo_ref text unique;
update public.clientes set codigo_ref = upper(encode(extensions.gen_random_bytes(4), 'hex')) where codigo_ref is null;
create or replace function public.codigo_ref_nuevo()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.codigo_ref is null then new.codigo_ref := upper(encode(gen_random_bytes(4), 'hex')); end if;
  return new;
end
$$;
create or replace trigger clientes_codigo_ref before insert on public.clientes
  for each row execute function public.codigo_ref_nuevo();

alter table public.webs_cliente add column if not exists tokens_regalo numeric(5,1) not null default 0 check (tokens_regalo >= 0);

create table if not exists public.referidos (
  referido_id  uuid primary key references public.clientes(id) on delete cascade,
  referidor_id uuid not null references public.clientes(id) on delete cascade,
  creado_en    timestamptz not null default now(),
  ganado_en    timestamptz
);
create index if not exists referidos_referidor_idx on public.referidos (referidor_id);
alter table public.referidos enable row level security;
revoke all on public.referidos from anon, authenticated;
grant select on public.referidos to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'referidos' and policyname = 'staff_lee_referidos') then
    create policy "staff_lee_referidos" on public.referidos for select to authenticated using (public.es_staff());
  end if;
end
$$;

-- Se llama nada más registrarse con el enlace de otro cliente (solo cuentas recién creadas)
create or replace function public.cliente_aplicar_referido(p_token text, p_codigo text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); yo clientes; quien clientes;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  select * into yo from clientes where id = cid;
  select * into quien from clientes where codigo_ref = upper(trim(coalesce(p_codigo, '')));
  if quien.id is null or quien.id = cid or yo.creado_en < now() - interval '2 days'
     or exists (select 1 from referidos where referido_id = cid) then
    return json_build_object('ok', false);
  end if;
  insert into referidos (referido_id, referidor_id) values (cid, quien.id);
  return json_build_object('ok', true, 'nombre', split_part(quien.nombre, ' ', 1));
end
$$;
revoke all on function public.cliente_aplicar_referido(text, text) from public;
grant execute on function public.cliente_aplicar_referido(text, text) to anon, authenticated;

-- Premio: 1 token para quien recomendó, la primera vez que el recomendado contrata
create or replace function public.premiar_referido(p_cliente uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r referidos; caso bigint;
begin
  update referidos set ganado_en = now() where referido_id = p_cliente and ganado_en is null returning * into r;
  if r.referido_id is null then return; end if;
  insert into webs_cliente (cliente_id, tokens_regalo) values (r.referidor_id, 1)
    on conflict (cliente_id) do update set tokens_regalo = webs_cliente.tokens_regalo + 1;
  select id into caso from reportes where cliente_id = r.referidor_id and eliminado_en is null order by created_at desc limit 1;
  if caso is not null then
    insert into mensajes_caso (caso_id, autor_tipo, autor, texto)
      values (caso, 'staff', 'sistema', '🎁 ¡Gracias por recomendarnos! Tu recomendado ya es cliente y has ganado 1 token de regalo.');
  end if;
end
$$;
revoke all on function public.premiar_referido(uuid) from public, anon, authenticated;

create or replace function public.referido_por_caso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_id is not null and new.estado = 'Aceptado' and old.estado is distinct from 'Aceptado'
     and new.tipo_reporte in ('Lead', 'Cambio') then
    perform public.premiar_referido(new.cliente_id);
  end if;
  return new;
end
$$;
create or replace trigger reportes_referido after update of estado on public.reportes
  for each row execute function public.referido_por_caso();

create or replace function public.referido_por_pago()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pagado_en is not null and old.pagado_en is null then perform public.premiar_referido(new.cliente_id); end if;
  return new;
end
$$;
create or replace trigger servicios_referido after update of pagado_en on public.servicios_cliente
  for each row execute function public.referido_por_pago();

-- 4) El portal recibe su código y sus recomendaciones (versión 6 de cliente_datos)
create or replace function public.cliente_datos(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token_lectura(p_token); c clientes; lectura boolean;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  select * into c from clientes where id = cid;
  select solo_lectura into lectura from sesiones_cliente where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return json_build_object(
    'cliente', json_build_object('id', c.id, 'email', c.email, 'nombre', c.nombre, 'dominio', c.dominio,
                                 'telefono', c.telefono, 'canal', c.canal, 'codigo_ref', c.codigo_ref),
    'solo_lectura', coalesce(lectura, false),
    'web', (select to_json(w) from webs_cliente w where w.cliente_id = cid),
    'historial', coalesce((select json_agg(json_build_object('mes', h.mes, 'datos', h.datos) order by h.mes desc)
                           from (select * from webs_cliente_historial where cliente_id = cid order by mes desc limit 12) h), '[]'::json),
    'casos', coalesce((select json_agg(x order by x.created_at desc) from (
        select id, tipo_reporte, titulo, estado, plan, plan_solicitado, dominio, urgencia, created_at, resuelto_en, origen
        from reportes where cliente_id = cid and eliminado_en is null) x), '[]'::json),
    'mensajes', coalesce((select json_agg(x order by x.creado_en) from (
        select m.id, m.caso_id, m.autor_tipo, m.autor, m.texto, m.creado_en,
               m.adjunto_ruta, m.adjunto_nombre, m.adjunto_tipo, m.adjunto_tamano, m.leido_cliente_en, m.leido_staff_en
        from mensajes_caso m join reportes r on r.id = m.caso_id
        where r.cliente_id = cid and r.eliminado_en is null) x), '[]'::json),
    'valoraciones', coalesce((select json_agg(json_build_object('caso_id', v.caso_id, 'estrellas', v.estrellas))
                              from valoraciones v where v.cliente_id = cid), '[]'::json),
    'renovaciones', coalesce((select json_agg(json_build_object('concepto', x.concepto, 'fecha', x.fecha, 'tipo', x.tipo) order by x.fecha)
                              from renovaciones x where x.cliente_id = cid and x.hecho_en is null
                                and x.fecha >= current_date - 30 and x.fecha <= current_date + 365), '[]'::json),
    'servicios', coalesce((select json_agg(json_build_object('id', s.id, 'tipo', s.tipo, 'nombre', s.nombre, 'precio', s.precio,
                                  'estado', s.estado, 'caso_id', s.caso_id, 'caso_baja_id', s.caso_baja_id, 'nota', s.nota,
                                  'creado_en', s.creado_en, 'activado_en', s.activado_en, 'baja_en', s.baja_en, 'pagado_en', s.pagado_en) order by s.creado_en desc)
                           from servicios_cliente s where s.cliente_id = cid and s.estado <> 'rechazado'), '[]'::json),
    'entregas', coalesce((select json_agg(json_build_object('id', e.id, 'servicio_id', e.servicio_id, 'nombre', e.nombre, 'tipo', e.tipo,
                                  'tamano', e.tamano, 'nota', e.nota, 'creado_en', e.creado_en, 'descargado_en', e.descargado_en) order by e.creado_en desc)
                          from entregas e where e.cliente_id = cid), '[]'::json),
    'referidos', json_build_object('invitados', (select count(*) from referidos where referidor_id = cid),
                                   'ganados', (select count(*) from referidos where referidor_id = cid and ganado_en is not null)));
end
$$;

select 'Plan Tienda, enlace y recomendaciones listos' as resultado;
