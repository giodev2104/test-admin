-- =====================================================================
--  Velority · Tarifas 2026 (Propuesta Comercial & Tarifas Web)
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de supabase_mejoras_3.sql.
-- No borra datos y se puede ejecutar varias veces.
--   · Planes recurrentes válidos: Mantenimiento Esencial / Pro y Renting Plan Lanzamiento / Negocio / Ecommerce.
--   · Al aceptar el alta de un cliente con un plan de mantenimiento o de renting, ese pasa a ser su plan.
--   · Los clientes con planes antiguos pasan a los nuevos:
--       Mantenimiento Básico → Mantenimiento Esencial · Mantenimiento Pro + SEO → Mantenimiento Pro
--       (Mantenimiento Pro conserva el nombre y pasa a la cuota nueva)
-- =====================================================================

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

create or replace function public.aplicar_plan_aceptado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'Aceptado' and old.estado is distinct from 'Aceptado' and new.cliente_id is not null then
    if new.plan_solicitado = 'Cancelar' then
      update webs_cliente set plan = null where cliente_id = new.cliente_id;
    elsif new.plan_solicitado is not null then
      insert into webs_cliente (cliente_id, plan) values (new.cliente_id, new.plan_solicitado)
        on conflict (cliente_id) do update set plan = excluded.plan;
    elsif new.tipo_reporte = 'Lead' and (new.plan like 'Mantenimiento%' or new.plan like 'Renting Plan%') then
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

-- Clientes con planes antiguos → planes nuevos
update public.webs_cliente set plan = 'Mantenimiento Esencial' where plan = 'Mantenimiento Básico';
update public.webs_cliente set plan = 'Mantenimiento Pro' where plan = 'Mantenimiento Pro + SEO';

select plan, count(*) as clientes from public.webs_cliente group by plan order by plan;
