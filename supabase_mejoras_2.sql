-- =====================================================================
--  Velority · Mejoras 2
-- ⚠ ATENCIÓN: este script ya está aplicado. NO lo vuelvas a ejecutar suelto: sustituiría funciones
--   (como cliente_datos) por versiones antiguas y el portal dejaría de funcionar bien.
--   Si alguna vez hay que repetirlo, ejecuta después, en orden, todos los scripts posteriores (ver GUIA.md).
-- =====================================================================
-- Ejecútalo entero en Supabase > SQL Editor DESPUÉS de supabase_mejoras.sql.
-- No borra datos y se puede ejecutar varias veces.
--
--   3. Valoración (opcional) de las solicitudes cerradas.
--   4. Mensajes leídos / no leídos («visto») en los dos sentidos.
--  14. Casos creados automáticamente cuando cae la web de un cliente.
--  16. Notas por cliente (ficha completa del cliente en el panel).
--  17. Calendario de renovaciones (dominios, planes, certificados…).
--  19. Etiquetas en los casos.
--  21. «Ver como cliente»: sesiones de solo lectura para el equipo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4) Leído / no leído
-- ---------------------------------------------------------------------
alter table public.mensajes_caso add column if not exists leido_cliente_en timestamptz;
alter table public.mensajes_caso add column if not exists leido_staff_en   timestamptz;

grant update (leido_staff_en) on public.mensajes_caso to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mensajes_caso' and policyname = 'staff_marca_leido') then
    create policy "staff_marca_leido" on public.mensajes_caso for update to authenticated
      using (public.es_staff()) with check (public.es_staff());
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 14) Origen del caso (p. ej. «medicion» si lo abre la vigilancia de la web)
-- ---------------------------------------------------------------------
alter table public.reportes add column if not exists origen text;

-- ---------------------------------------------------------------------
-- 19) Etiquetas en los casos
-- ---------------------------------------------------------------------
alter table public.reportes add column if not exists etiquetas text[] not null default '{}';

-- ---------------------------------------------------------------------
-- 21) Sesiones de solo lectura («Ver como cliente»)
-- ---------------------------------------------------------------------
alter table public.sesiones_cliente add column if not exists solo_lectura boolean not null default false;

create or replace function public._cliente_de_token(p_token text)
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select cliente_id from sesiones_cliente
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and expira_en > now() and not solo_lectura;
$$;

create or replace function public._cliente_de_token_lectura(p_token text)
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select cliente_id from sesiones_cliente
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and expira_en > now();
$$;
revoke all on function public._cliente_de_token(text), public._cliente_de_token_lectura(text) from public, anon, authenticated;

create or replace function public.staff_vista_cliente(p_cliente uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(32), 'hex');
begin
  if not public.es_staff() then
    raise exception 'Solo el equipo puede ver el portal de un cliente.';
  end if;
  if not exists (select 1 from clientes where id = p_cliente) then
    raise exception 'Cliente no encontrado.';
  end if;
  insert into sesiones_cliente (token_hash, cliente_id, solo_lectura, expira_en)
    values (encode(digest(t, 'sha256'), 'hex'), p_cliente, true, now() + interval '1 hour');
  return json_build_object('token', t);
end
$$;
revoke all on function public.staff_vista_cliente(uuid) from public, anon;
grant execute on function public.staff_vista_cliente(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Valoraciones (opcionales) de solicitudes cerradas
-- ---------------------------------------------------------------------
create table if not exists public.valoraciones (
  caso_id    bigint primary key references public.reportes(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  estrellas  int not null check (estrellas between 1 and 5),
  comentario text check (comentario is null or length(comentario) <= 1000),
  creado_en  timestamptz not null default now()
);
alter table public.valoraciones enable row level security;
revoke all on public.valoraciones from anon, authenticated;
grant select on public.valoraciones to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'valoraciones' and policyname = 'staff_lee_valoraciones') then
    create policy "staff_lee_valoraciones" on public.valoraciones for select to authenticated using (public.es_staff());
  end if;
end
$$;

create or replace function public.cliente_valorar(p_token text, p_caso bigint, p_estrellas int, p_comentario text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token);
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  if p_estrellas is null or p_estrellas not between 1 and 5 then raise exception 'Elige de 1 a 5 estrellas.'; end if;
  if not exists (select 1 from reportes where id = p_caso and cliente_id = cid and eliminado_en is null
                 and estado in ('Aceptado', 'Denegado')) then
    raise exception 'Solo puedes valorar solicitudes cerradas.';
  end if;
  insert into valoraciones (caso_id, cliente_id, estrellas, comentario)
    values (p_caso, cid, p_estrellas, nullif(left(trim(coalesce(p_comentario, '')), 1000), ''))
  on conflict (caso_id) do update set estrellas = excluded.estrellas, comentario = excluded.comentario, creado_en = now();
  return json_build_object('caso_id', p_caso, 'estrellas', p_estrellas);
end
$$;

create or replace function public.cliente_marcar_leido(p_token text, p_caso bigint)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); n int;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  update mensajes_caso m set leido_cliente_en = now()
  from reportes r
  where r.id = m.caso_id and r.id = p_caso and r.cliente_id = cid
    and m.autor_tipo = 'staff' and m.leido_cliente_en is null;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.cliente_valorar(text, bigint, int, text), public.cliente_marcar_leido(text, bigint) from public;
grant execute on function public.cliente_valorar(text, bigint, int, text), public.cliente_marcar_leido(text, bigint) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 16) Notas por cliente (las ve solo el equipo)
-- ---------------------------------------------------------------------
create table if not exists public.notas_cliente (
  id         bigint generated by default as identity primary key,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  autor      text not null,
  texto      text not null check (length(texto) between 1 and 2000),
  creado_en  timestamptz not null default now()
);
create index if not exists notas_cliente_cliente_idx on public.notas_cliente (cliente_id, creado_en desc);
alter table public.notas_cliente enable row level security;
revoke all on public.notas_cliente from anon, authenticated;
grant select, insert on public.notas_cliente to authenticated;
grant delete on public.notas_cliente to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notas_cliente' and policyname = 'staff_lee_notas_cliente') then
    create policy "staff_lee_notas_cliente" on public.notas_cliente for select to authenticated using (public.es_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notas_cliente' and policyname = 'staff_crea_notas_cliente') then
    create policy "staff_crea_notas_cliente" on public.notas_cliente for insert to authenticated with check (autor = public.staff_usuario());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notas_cliente' and policyname = 'staff_borra_sus_notas_cliente') then
    create policy "staff_borra_sus_notas_cliente" on public.notas_cliente for delete to authenticated using (autor = public.staff_usuario());
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 17) Calendario de renovaciones
-- ---------------------------------------------------------------------
create table if not exists public.renovaciones (
  id          bigint generated by default as identity primary key,
  cliente_id  uuid references public.clientes(id) on delete cascade,
  concepto    text not null check (length(concepto) between 1 and 200),
  tipo        text not null default 'otro' check (tipo in ('dominio', 'plan', 'ssl', 'hosting', 'correo', 'otro')),
  fecha       date not null,
  importe     text,
  avisar_dias int not null default 15 check (avisar_dias between 0 and 120),
  hecho_en    timestamptz,
  creado_por  text,
  creado_en   timestamptz not null default now()
);
create index if not exists renovaciones_fecha_idx on public.renovaciones (fecha);
alter table public.renovaciones enable row level security;
revoke all on public.renovaciones from anon, authenticated;
grant select, insert, update, delete on public.renovaciones to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'renovaciones' and policyname = 'staff_renovaciones') then
    create policy "staff_renovaciones" on public.renovaciones for all to authenticated
      using (public.es_staff()) with check (public.es_staff());
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Lo que recibe el portal (versión 3): también valoraciones, leídos y renovaciones
-- ---------------------------------------------------------------------
create or replace function public.cliente_datos(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token_lectura(p_token); c clientes; lectura boolean;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  select * into c from clientes where id = cid;
  select solo_lectura into lectura from sesiones_cliente where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return json_build_object(
    'cliente', json_build_object('id', c.id, 'email', c.email, 'nombre', c.nombre, 'dominio', c.dominio,
                                 'telefono', c.telefono, 'canal', c.canal),
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
                                and x.fecha >= current_date - 30 and x.fecha <= current_date + 365), '[]'::json));
end
$$;

-- El portal se entera al momento cuando el equipo lee sus mensajes («visto»)
create or replace trigger avisar_portal_leido after update of leido_staff_en on public.mensajes_caso
  for each row execute function public.avisar_portal();

-- Tiempo real: el panel se entera al momento de nuevas valoraciones
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'valoraciones') then
    alter publication supabase_realtime add table public.valoraciones;
  end if;
end
$$;

select 'Mejoras 2 aplicadas' as resultado;
