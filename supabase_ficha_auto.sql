-- =====================================================================
--  Velority · Ficha del cliente automática
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de supabase_catalogo.sql.
-- No borra datos y se puede ejecutar varias veces.
--
--   · Plan contratado: se pone solo cuando un servicio de mantenimiento o renting pasa a «activo».
--   · Tokens incluidos: según el plan (columna tokens_mes del catálogo, editable en Negocio > Precios).
--   · Cambios completados y tokens usados del mes: se cuentan solos con los casos cerrados como «Aceptado»
--     (en cada caso se apuntan los tokens gastados).
--   · Mensaje de estado y recomendación: los escribe la función «medir» si están en automático.
--   · Renovaciones de dominio y SSL: las apunta la función «medir» con la fecha de caducidad.
--   · Datos de WordPress (actualizaciones, ataques, amenazas, copias): los envía el plugin «Velority Conector»
--     a la función «wp» con la clave de conexión de cada cliente.
-- =====================================================================

-- Tokens incluidos al mes en cada plan
alter table public.catalogo add column if not exists tokens_mes numeric(5,1) check (tokens_mes is null or tokens_mes >= 0);
update public.catalogo set tokens_mes = case nombre when 'Mantenimiento Pro' then 2 when 'Renting Plan Ecommerce' then 2 else 0 end
  where tipo in ('mantenimiento', 'renting') and tokens_mes is null;
grant update (tokens_mes) on public.catalogo to authenticated;

alter table public.webs_cliente add column if not exists resumen_auto       boolean not null default true;
alter table public.webs_cliente add column if not exists recomendacion_auto boolean not null default true;
alter table public.webs_cliente add column if not exists wp_clave_hash      text unique;
alter table public.webs_cliente add column if not exists wp_visto_en        timestamptz;
alter table public.webs_cliente add column if not exists wp_datos           jsonb;

alter table public.reportes add column if not exists tokens numeric(5,1) check (tokens is null or tokens >= 0);

alter table public.renovaciones add column if not exists auto text;
create unique index if not exists renovaciones_auto_idx on public.renovaciones (cliente_id, auto) where auto is not null;

-- 1) El plan de la ficha sigue al servicio de mantenimiento/renting activo
create or replace function public.plan_desde_servicio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo not in ('mantenimiento', 'renting') then return new; end if;
  if new.estado = 'activo' and (tg_op = 'INSERT' or old.estado is distinct from 'activo') then
    insert into webs_cliente (cliente_id, plan) values (new.cliente_id, new.nombre)
      on conflict (cliente_id) do update set plan = excluded.plan;
  elsif tg_op = 'UPDATE' and old.estado = 'activo' and new.estado <> 'activo'
        and not exists (select 1 from servicios_cliente where cliente_id = new.cliente_id and id <> new.id
                        and tipo in ('mantenimiento', 'renting') and estado = 'activo') then
    update webs_cliente set plan = null where cliente_id = new.cliente_id and plan = new.nombre;
  end if;
  return new;
end
$$;
create or replace trigger servicios_plan after insert or update of estado on public.servicios_cliente
  for each row execute function public.plan_desde_servicio();

-- 2) Tokens incluidos según el plan (al cambiar de plan o al cambiar los tokens del plan en el catálogo)
create or replace function public.tokens_del_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.plan is distinct from old.plan then
    new.horas_incluidas := (select tokens_mes from catalogo where nombre = new.plan);
  end if;
  return new;
end
$$;
create or replace trigger webs_tokens_plan before insert or update of plan on public.webs_cliente
  for each row execute function public.tokens_del_plan();

create or replace function public.tokens_catalogo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tokens_mes is distinct from old.tokens_mes then
    update webs_cliente set horas_incluidas = new.tokens_mes where plan = new.nombre;
  end if;
  return new;
end
$$;
create or replace trigger catalogo_tokens after update of tokens_mes on public.catalogo
  for each row execute function public.tokens_catalogo();

-- 3) Cambios completados y tokens usados del mes, contados con los casos cerrados
create or replace function public.recontar_mes(p_cliente uuid)
returns void language plpgsql security definer set search_path = public as $$
declare desde timestamptz := date_trunc('month', now()); n int; t numeric; con_tokens boolean;
begin
  select count(*) filter (where r.tipo_reporte in ('Cambio', 'Incidencia') and r.plan_solicitado is null
                            and coalesce(r.origen, '') <> 'medicion'
                            and r.titulo !~ '^(Contratar|Presupuesto|Baja de servicio|Plan web):'),
         coalesce(sum(r.tokens), 0), bool_or(r.tokens is not null)
    into n, t, con_tokens
  from reportes r
  where r.cliente_id = p_cliente and r.eliminado_en is null and r.estado = 'Aceptado' and r.resuelto_en >= desde;
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

create or replace function public.recontar_por_caso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_id is not null and (tg_op = 'INSERT' or new.estado is distinct from old.estado or new.tokens is distinct from old.tokens
                                     or new.eliminado_en is distinct from old.eliminado_en or new.resuelto_en is distinct from old.resuelto_en) then
    perform public.recontar_mes(new.cliente_id);
  end if;
  return new;
end
$$;
create or replace trigger reportes_recontar after insert or update on public.reportes
  for each row execute function public.recontar_por_caso();

-- 4) Renovaciones automáticas (dominio y SSL): solo para la función «medir» (service role)
create or replace function public.servidor_renovacion_auto(p_cliente uuid, p_auto text, p_concepto text, p_tipo text, p_fecha date, p_avisar int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into renovaciones (cliente_id, concepto, tipo, fecha, avisar_dias, creado_por, auto)
  values (p_cliente, p_concepto, p_tipo, p_fecha, p_avisar, 'automático', p_auto)
  on conflict (cliente_id, auto) where auto is not null do update
    set fecha = excluded.fecha, concepto = excluded.concepto,
        hecho_en = case when renovaciones.fecha <> excluded.fecha then null else renovaciones.hecho_en end;
end
$$;
revoke all on function public.servidor_renovacion_auto(uuid, text, text, text, date, int) from public, anon, authenticated;

-- 5) Clave de conexión del plugin de WordPress (se muestra una sola vez; se guarda su huella)
create or replace function public.staff_clave_wp(p_cliente uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare clave text := 'wc_' || encode(gen_random_bytes(24), 'hex');
begin
  if not public.es_staff() then raise exception 'Solo el equipo puede conectar webs.'; end if;
  if not exists (select 1 from clientes where id = p_cliente) then raise exception 'Cliente no encontrado.'; end if;
  insert into webs_cliente (cliente_id, wp_clave_hash) values (p_cliente, encode(digest(clave, 'sha256'), 'hex'))
    on conflict (cliente_id) do update set wp_clave_hash = excluded.wp_clave_hash, wp_visto_en = null;
  return clave;
end
$$;
revoke all on function public.staff_clave_wp(uuid) from public, anon;
grant execute on function public.staff_clave_wp(uuid) to authenticated;

-- Recuento inicial del mes en curso
select public.recontar_mes(id) from public.clientes;

select 'Ficha automática lista' as resultado;
