-- =====================================================================
--  Velority · Cambio de plan automático
-- ⚠ ATENCIÓN: este script ya está aplicado. NO lo vuelvas a ejecutar suelto: sustituiría funciones
--   (como cliente_datos) por versiones antiguas y el portal dejaría de funcionar bien.
--   Si alguna vez hay que repetirlo, ejecuta después, en orden, todos los scripts posteriores (ver GUIA.md).
-- =====================================================================
-- Cuando un cliente pide otro plan desde su portal, se crea un caso
-- «Cambio de plan a …». Al pasar ese caso a «Aceptado» en el panel, su
-- plan cambia solo (tabla webs_cliente) y el portal lo muestra.
-- También: al aceptar el lead de un cliente nuevo con un plan de
-- mantenimiento, ese plan pasa a ser el suyo.
-- Ejecútalo en Supabase > SQL Editor. Se puede repetir sin perder datos.
-- =====================================================================

-- 1) El caso recuerda qué plan se pidió
alter table public.reportes add column if not exists plan_solicitado text;

-- 2) El portal pide el cambio con esta función (valida el plan y evita duplicados)
create or replace function public.cliente_pedir_plan(p_token text, p_plan text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); c clientes; r reportes; actual text;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  if p_plan is null or p_plan not in ('Mantenimiento Esencial', 'Mantenimiento Pro', 'Renting Plan Lanzamiento', 'Renting Plan Negocio', 'Renting Plan Ecommerce') then
    raise exception 'Plan no válido.';
  end if;
  select plan into actual from webs_cliente where cliente_id = cid;
  if actual = p_plan then raise exception 'Ya tienes ese plan.'; end if;
  if exists (select 1 from reportes where cliente_id = cid and plan_solicitado is not null
             and eliminado_en is null and estado not in ('Aceptado', 'Denegado')) then
    raise exception 'Ya tienes una solicitud de cambio de plan pendiente.';
  end if;
  select * into c from clientes where id = cid;
  insert into reportes (tipo_reporte, titulo, descripcion, usuario_discord, email, dominio, plan, plan_solicitado, estado, cliente_id)
  values ('Cambio', 'Cambio de plan a ' || p_plan,
          'El cliente pide pasar de ' || coalesce(actual, 'sin plan') || ' a ' || p_plan
            || '. Al pasar este caso a «Aceptado», su plan cambiará solo en el portal.',
          c.nombre, c.email, c.dominio, actual, p_plan, 'Entrada de leads', cid)
  returning * into r;
  return json_build_object('id', r.id, 'tipo_reporte', r.tipo_reporte, 'titulo', r.titulo, 'estado', r.estado,
                           'plan', r.plan, 'plan_solicitado', r.plan_solicitado, 'dominio', r.dominio,
                           'urgencia', r.urgencia, 'created_at', r.created_at);
end
$$;
revoke all on function public.cliente_pedir_plan(text, text) from public;
grant execute on function public.cliente_pedir_plan(text, text) to anon, authenticated;

-- 3) Al aceptar el caso, se aplica el plan (un lead aceptado no pisa un plan ya puesto)
create or replace function public.aplicar_plan_aceptado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'Aceptado' and old.estado is distinct from 'Aceptado' and new.cliente_id is not null then
    if new.plan_solicitado is not null then
      insert into webs_cliente (cliente_id, plan) values (new.cliente_id, new.plan_solicitado)
        on conflict (cliente_id) do update set plan = excluded.plan;
    elsif new.tipo_reporte = 'Lead' and new.plan like 'Mantenimiento%' then
      update webs_cliente set plan = new.plan where cliente_id = new.cliente_id and plan is null;
      if not found then
        insert into webs_cliente (cliente_id, plan) values (new.cliente_id, new.plan)
          on conflict (cliente_id) do nothing;
      end if;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists reportes_plan_aceptado on public.reportes;
create trigger reportes_plan_aceptado after update of estado on public.reportes
  for each row execute function public.aplicar_plan_aceptado();

-- 4) El portal recibe también qué plan pidió en cada caso (para mostrar «pendiente»)
create or replace function public.cliente_datos(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); c clientes;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  select * into c from clientes where id = cid;
  return json_build_object(
    'cliente', json_build_object('id', c.id, 'email', c.email, 'nombre', c.nombre, 'dominio', c.dominio),
    'web', (select to_json(w) from webs_cliente w where w.cliente_id = cid),
    'casos', coalesce((select json_agg(x order by x.created_at desc) from (
        select id, tipo_reporte, titulo, estado, plan, plan_solicitado, dominio, urgencia, created_at
        from reportes where cliente_id = cid and eliminado_en is null) x), '[]'::json),
    'mensajes', coalesce((select json_agg(x order by x.creado_en) from (
        select m.id, m.caso_id, m.autor_tipo, m.autor, m.texto, m.creado_en
        from mensajes_caso m join reportes r on r.id = m.caso_id
        where r.cliente_id = cid and r.eliminado_en is null) x), '[]'::json));
end
$$;

-- 5) Solicitudes de cambio de plan que ya estaban aceptadas antes de este script: se aplican ahora
update public.reportes set plan_solicitado = substring(titulo from '^Cambio de plan a (.+)$')
  where plan_solicitado is null and titulo ~ '^Cambio de plan a Mantenimiento';
--    (solo si la ficha no se ha editado después de aceptarla)
with ultimo as (
  select distinct on (cliente_id) cliente_id, plan_solicitado, coalesce(resuelto_en, created_at) as fecha
  from public.reportes
  where estado = 'Aceptado' and plan_solicitado is not null and cliente_id is not null and eliminado_en is null
  order by cliente_id, coalesce(resuelto_en, created_at) desc)
insert into public.webs_cliente (cliente_id, plan)
  select cliente_id, plan_solicitado from ultimo
on conflict (cliente_id) do update set plan = excluded.plan
  where webs_cliente.actualizado_en < (select fecha from ultimo where ultimo.cliente_id = webs_cliente.cliente_id);

-- Comprobación: plan actual de cada cliente
select c.email, w.plan from public.clientes c left join public.webs_cliente w on w.cliente_id = c.id order by c.creado_en desc;
