-- =====================================================================
--  Webcare · Ofertas en el catálogo y pago de extras con tokens
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de supabase_crecimiento.sql. Se puede ejecutar varias veces.
--
--   catalogo.oferta_pct     descuento en % (vacío = sin oferta). Lo muestra el portal con la etiqueta
--                           «X% OFF» y la función «pago» cobra el precio rebajado.
--   catalogo.oferta_hasta   último día de la oferta (vacío = hasta que la quites)
--   catalogo.precio_tokens  solo extras de pago único: cuántos tokens cuesta (vacío = solo con tarjeta)
--
-- Pago con tokens: primero se gastan los tokens del mes que le quedan al cliente y después los de regalo.
-- Cada pago queda en la tabla pagos_tokens y cuenta en los tokens usados del mes.
-- Los renting dejan de incluir tokens al mes (solo los planes de mantenimiento los incluyen).
-- =====================================================================

alter table public.catalogo add column if not exists precio_tokens numeric(5,1) check (precio_tokens is null or precio_tokens > 0);
alter table public.catalogo add column if not exists oferta_pct int check (oferta_pct is null or oferta_pct between 1 and 90);
alter table public.catalogo add column if not exists oferta_hasta date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'catalogo_tokens_solo_extras') then
    alter table public.catalogo add constraint catalogo_tokens_solo_extras check (precio_tokens is null or (tipo = 'extra' and cada = 0));
  end if;
end
$$;
grant update (precio_tokens, oferta_pct, oferta_hasta) on public.catalogo to authenticated;

-- Oferta en vigor (null si no hay o ya caducó)
create or replace function public.oferta_vigente(p_pct int, p_hasta date)
returns int language sql stable as $$
  select case when p_pct is not null and (p_hasta is null or p_hasta >= (now() at time zone 'Europe/Madrid')::date) then p_pct end;
$$;

-- El portal lee los precios, las ofertas en vigor y el precio en tokens
create or replace function public.catalogo_publico()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('nombre', nombre, 'tipo', tipo, 'precio', precio, 'precio_hasta', precio_hasta,
                                             'precio_anual', precio_anual, 'cada', cada, 'activo', activo,
                                             'precio_tokens', precio_tokens, 'oferta', oferta_vigente(oferta_pct, oferta_hasta),
                                             'oferta_hasta', case when oferta_vigente(oferta_pct, oferta_hasta) is not null then oferta_hasta end)
                           order by orden, nombre), '[]'::json)
  from catalogo;
$$;
revoke all on function public.catalogo_publico() from public;
grant execute on function public.catalogo_publico() to anon, authenticated;

-- Pagos hechos con tokens
create table if not exists public.pagos_tokens (
  id           bigserial primary key,
  cliente_id   uuid not null references public.clientes(id) on delete cascade,
  nombre       text not null,
  tokens       numeric(5,1) not null check (tokens > 0),
  del_mes      numeric(5,1) not null default 0 check (del_mes >= 0),
  de_regalo    numeric(5,1) not null default 0 check (de_regalo >= 0),
  caso_id      bigint references public.reportes(id) on delete set null,
  servicio_id  bigint references public.servicios_cliente(id) on delete set null,
  creado_en    timestamptz not null default now()
);
create index if not exists pagos_tokens_cliente_idx on public.pagos_tokens (cliente_id, creado_en);
alter table public.pagos_tokens enable row level security;
revoke all on public.pagos_tokens from anon, authenticated;
grant select on public.pagos_tokens to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pagos_tokens' and policyname = 'staff_lee_pagos_tokens') then
    create policy "staff_lee_pagos_tokens" on public.pagos_tokens for select to authenticated using (public.es_staff());
  end if;
end
$$;

-- Tokens usados del mes = los de los casos cerrados + los gastados en extras este mes
create or replace function public.recontar_mes(p_cliente uuid)
returns void language plpgsql security definer set search_path = public as $$
declare desde timestamptz := date_trunc('month', now()); n int; t numeric; con_tokens boolean; e numeric;
begin
  select count(*) filter (where r.tipo_reporte in ('Cambio', 'Incidencia') and r.plan_solicitado is null
                            and coalesce(r.origen, '') <> 'medicion'
                            and r.titulo !~ '^(Contratar|Presupuesto|Baja de servicio|Plan web):'),
         coalesce(sum(r.tokens), 0), coalesce(bool_or(r.tokens is not null), false)
    into n, t, con_tokens
  from reportes r
  where r.cliente_id = p_cliente and r.eliminado_en is null and r.estado = 'Aceptado' and r.resuelto_en >= desde;
  select coalesce(sum(del_mes), 0) into e from pagos_tokens where cliente_id = p_cliente and creado_en >= desde;
  -- Si los tokens del mes se llevan a mano (ningún caso tiene tokens), el pago ya los sumó directamente
  if con_tokens then t := t + e; end if;
  update webs_cliente set mes_cambios = n,
         mes_horas = case when con_tokens then t else mes_horas end,
         horas_usadas = case when con_tokens then t else horas_usadas end
   where cliente_id = p_cliente and (mes_cambios is distinct from n or (con_tokens and horas_usadas is distinct from t));
  if not found and n > 0 and not exists (select 1 from webs_cliente where cliente_id = p_cliente) then
    insert into webs_cliente (cliente_id, mes_cambios, mes_horas, horas_usadas)
      values (p_cliente, n, case when con_tokens then t end, case when con_tokens then t end);
  end if;
end
$$;
revoke all on function public.recontar_mes(uuid) from public, anon, authenticated;

-- El cliente paga un extra con sus tokens: crea el caso y el pedido ya pagado
create or replace function public.cliente_pagar_tokens(p_token text, p_nombre text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); c clientes; k catalogo; w webs_cliente;
        disp numeric; del_mes numeric; de_regalo numeric; r reportes; s servicios_cliente; txt text;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  select * into k from catalogo where nombre = p_nombre;
  if k.nombre is null or k.tipo <> 'extra' or not k.activo or k.precio_tokens is null then
    raise exception 'Este servicio no se puede pagar con tokens.';
  end if;
  select * into c from clientes where id = cid;
  select * into w from webs_cliente where cliente_id = cid for update;
  disp := greatest(coalesce(w.horas_incluidas, 0) - coalesce(w.horas_usadas, 0), 0);
  if disp + coalesce(w.tokens_regalo, 0) < k.precio_tokens then
    raise exception 'No tienes tokens suficientes: este servicio cuesta % y te quedan %.',
      regexp_replace(to_char(k.precio_tokens, 'FM9990.0'), '\.0$', ''), regexp_replace(to_char(disp + coalesce(w.tokens_regalo, 0), 'FM9990.0'), '\.0$', '');
  end if;
  del_mes := least(k.precio_tokens, disp);
  de_regalo := k.precio_tokens - del_mes;
  txt := regexp_replace(to_char(k.precio_tokens, 'FM9990.0'), '\.0$', '') || case when k.precio_tokens = 1 then ' token' else ' tokens' end;
  insert into reportes (tipo_reporte, titulo, descripcion, usuario_discord, email, dominio, plan, estado, cliente_id)
  values ('Cambio', 'Contratar: ' || k.nombre,
          'Pagado con ' || txt || ' desde su portal. El cliente ha contratado «' || k.nombre || '».',
          c.nombre, c.email, c.dominio, w.plan, 'Entrada de leads', cid)
  returning * into r;
  insert into servicios_cliente (cliente_id, tipo, nombre, precio, estado, caso_id, pagado_en, pagado_por)
    values (cid, 'extra', k.nombre, txt, 'pendiente', r.id, now(), 'Tokens') returning * into s;
  insert into pagos_tokens (cliente_id, nombre, tokens, del_mes, de_regalo, caso_id, servicio_id)
    values (cid, k.nombre, k.precio_tokens, del_mes, de_regalo, r.id, s.id);
  update webs_cliente set tokens_regalo = tokens_regalo - de_regalo,
         horas_usadas = case when del_mes > 0 then coalesce(horas_usadas, 0) + del_mes else horas_usadas end
   where cliente_id = cid;
  perform recontar_mes(cid);
  return json_build_object('caso', json_build_object('id', r.id, 'tipo_reporte', r.tipo_reporte, 'titulo', r.titulo, 'estado', r.estado,
                             'plan', r.plan, 'plan_solicitado', r.plan_solicitado, 'dominio', r.dominio, 'urgencia', r.urgencia,
                             'created_at', r.created_at, 'origen', r.origen),
                           'servicio', to_json(s),
                           'web', (select to_json(x) from webs_cliente x where x.cliente_id = cid));
end
$$;
revoke all on function public.cliente_pagar_tokens(text, text) from public;
grant execute on function public.cliente_pagar_tokens(text, text) to anon, authenticated;

-- Los renting ya no incluyen tokens al mes (el aviso del catálogo pone a cero también a sus clientes)
update public.catalogo set tokens_mes = null where tipo = 'renting' and tokens_mes is not null;
