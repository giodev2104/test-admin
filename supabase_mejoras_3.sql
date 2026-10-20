-- =====================================================================
--  Webcare · Mejoras 3
-- =====================================================================
-- Ejecútalo entero en Supabase > SQL Editor DESPUÉS de supabase_mejoras_2.sql.
-- No borra datos y se puede ejecutar varias veces.
--
--   1. Informe mensual automático por correo (día 1 a las 8:00).
--   2. Datos reales de Google (Search Console y Analytics) en la ficha SEO.
--   6. Sin permanencia: el cliente puede pedir la baja desde su portal.
--   8. Urgencias: los casos urgentes quedan marcados (origen «urgente»).
--  10. Bóveda cifrada de accesos (contraseñas) del cliente.
--  14. Revisión de enlaces rotos y errores 404.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columnas nuevas de la ficha de la web
-- ---------------------------------------------------------------------
alter table public.webs_cliente add column if not exists informe_auto boolean not null default true;
alter table public.webs_cliente add column if not exists gsc_propiedad text;
alter table public.webs_cliente add column if not exists ga4_propiedad text;
alter table public.webs_cliente add column if not exists google_en timestamptz;
alter table public.webs_cliente add column if not exists google_error text;
alter table public.webs_cliente add column if not exists enlaces_revisado_en timestamptz;
alter table public.webs_cliente add column if not exists enlaces_paginas int;
alter table public.webs_cliente add column if not exists enlaces_rotos jsonb not null default '[]';

-- ---------------------------------------------------------------------
-- 1) Informes enviados (para no mandar dos veces el mismo mes)
-- ---------------------------------------------------------------------
create table if not exists public.informes_enviados (
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  mes        date not null,
  enviado_en timestamptz not null default now(),
  enviado_por text,
  primary key (cliente_id, mes)
);
alter table public.informes_enviados enable row level security;
revoke all on public.informes_enviados from anon, authenticated;
grant select on public.informes_enviados to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'informes_enviados' and policyname = 'staff_lee_informes') then
    create policy "staff_lee_informes" on public.informes_enviados for select to authenticated using (public.es_staff());
  end if;
end
$$;

-- El historial mensual guarda también las palabras clave y los enlaces rotos
create or replace function public.cerrar_mes(p_mes date default null)
returns int language plpgsql security definer set search_path = public as $$
declare m date := coalesce(p_mes, (date_trunc('month', now()) - interval '1 month')::date); n int;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> '' and not public.es_staff() then
    raise exception 'Solo el equipo puede cerrar el mes.';
  end if;
  insert into webs_cliente_historial (cliente_id, mes, datos)
  select cliente_id, date_trunc('month', m)::date, jsonb_strip_nulls(jsonb_build_object(
    'mes_actualizaciones', mes_actualizaciones, 'mes_ataques', mes_ataques, 'mes_cambios', mes_cambios,
    'mes_horas', mes_horas, 'horas_incluidas', horas_incluidas, 'horas_usadas', horas_usadas,
    'disponibilidad', disponibilidad, 'velocidad', velocidad, 'puntuacion', puntuacion,
    'seo_visitas', seo_visitas, 'seo_impresiones', seo_impresiones, 'seo_clics', seo_clics,
    'seo_primera_pagina', seo_primera_pagina, 'plan', plan,
    'seo_palabras', case when jsonb_array_length(seo_palabras) > 0 then seo_palabras end,
    'enlaces_rotos', case when enlaces_revisado_en is not null then jsonb_array_length(enlaces_rotos) end))
  from webs_cliente
  on conflict (cliente_id, mes) do update set datos = excluded.datos, creado_en = now();
  get diagnostics n = row_count;
  update webs_cliente set mes_actualizaciones = null, mes_ataques = null, mes_cambios = null, mes_horas = null,
    horas_usadas = case when horas_incluidas is not null then 0 end;
  return n;
end
$$;
revoke all on function public.cerrar_mes(date) from public, anon;
grant execute on function public.cerrar_mes(date) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Baja sin permanencia: el cliente la pide y, al aceptar el caso, se le quita el plan
-- ---------------------------------------------------------------------
create or replace function public.cliente_cancelar_plan(p_token text, p_motivo text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); c clientes; r reportes; actual text;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  select plan into actual from webs_cliente where cliente_id = cid;
  if actual is null then raise exception 'No tienes ningún plan activo.'; end if;
  if exists (select 1 from reportes where cliente_id = cid and plan_solicitado is not null
             and eliminado_en is null and estado not in ('Aceptado', 'Denegado')) then
    raise exception 'Ya tienes una solicitud de cambio de plan o de baja pendiente.';
  end if;
  select * into c from clientes where id = cid;
  insert into reportes (tipo_reporte, titulo, descripcion, usuario_discord, email, dominio, plan, plan_solicitado, estado, cliente_id)
  values ('Cambio', 'Baja del plan ' || actual,
          'El cliente pide darse de baja de ' || actual || '. Motivo: ' || coalesce(nullif(left(trim(coalesce(p_motivo, '')), 1000), ''), 'no lo indica')
            || '. Al pasar este caso a «Aceptado», se le quitará el plan del portal. Recuerda cancelar también su suscripción en Stripe.',
          c.nombre, c.email, c.dominio, actual, 'Cancelar', 'Entrada de leads', cid)
  returning * into r;
  return json_build_object('id', r.id, 'tipo_reporte', r.tipo_reporte, 'titulo', r.titulo, 'estado', r.estado,
                           'plan', r.plan, 'plan_solicitado', r.plan_solicitado, 'dominio', r.dominio,
                           'urgencia', r.urgencia, 'created_at', r.created_at, 'origen', r.origen);
end
$$;
revoke all on function public.cliente_cancelar_plan(text, text) from public;
grant execute on function public.cliente_cancelar_plan(text, text) to anon, authenticated;

create or replace function public.aplicar_plan_aceptado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'Aceptado' and old.estado is distinct from 'Aceptado' and new.cliente_id is not null then
    if new.plan_solicitado = 'Cancelar' then
      update webs_cliente set plan = null where cliente_id = new.cliente_id;
    elsif new.plan_solicitado is not null then
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

-- ---------------------------------------------------------------------
-- 8) Urgencias: el caso urgente queda marcado con origen «urgente»
-- ---------------------------------------------------------------------
create or replace function public.cliente_crear_caso(p_token text, p_tipo text, p_titulo text, p_descripcion text, p_urgente boolean)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); c clientes; r reportes;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  if p_tipo is null or p_tipo not in ('Cambio', 'Incidencia', 'Duda') then raise exception 'Tipo de solicitud no válido.'; end if;
  if length(trim(coalesce(p_descripcion, ''))) = 0 then raise exception 'Cuéntanos qué necesitas.'; end if;
  select * into c from clientes where id = cid;
  insert into reportes (tipo_reporte, titulo, descripcion, usuario_discord, email, dominio, plan, estado, urgencia, origen, cliente_id)
  values (p_tipo, left(trim(coalesce(p_titulo, '')), 120), left(p_descripcion, 4000), c.nombre, c.email, c.dominio,
          coalesce((select plan from webs_cliente where cliente_id = cid),
                   (select plan from reportes where cliente_id = cid and plan is not null order by created_at desc limit 1)),
          'Entrada de leads', case when p_urgente then 0.85 end, case when p_urgente then 'urgente' end, cid)
  returning * into r;
  return json_build_object('id', r.id, 'tipo_reporte', r.tipo_reporte, 'titulo', r.titulo, 'estado', r.estado,
                           'plan', r.plan, 'dominio', r.dominio, 'urgencia', r.urgencia, 'created_at', r.created_at, 'origen', r.origen);
end
$$;

-- ---------------------------------------------------------------------
-- 10) Bóveda de accesos: las contraseñas se guardan cifradas por la función «boveda»
--     (la clave de cifrado vive en los secretos de Supabase, nunca en la base de datos)
-- ---------------------------------------------------------------------
create table if not exists public.credenciales (
  id             bigint generated by default as identity primary key,
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  servicio       text not null check (length(servicio) between 1 and 80),
  url            text check (url is null or length(url) <= 300),
  usuario        text check (usuario is null or length(usuario) <= 200),
  secreto        text not null,
  notas          text check (notas is null or length(notas) <= 1000),
  creado_por     text not null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists credenciales_cliente_idx on public.credenciales (cliente_id);
alter table public.credenciales enable row level security;
revoke all on public.credenciales from anon, authenticated;

create table if not exists public.credenciales_accesos (
  id            bigint generated by default as identity primary key,
  cliente_id    uuid not null references public.clientes(id) on delete cascade,
  credencial_id bigint,
  servicio      text,
  quien         text not null,
  quien_tipo    text not null check (quien_tipo in ('cliente', 'staff')),
  accion        text not null check (accion in ('ver', 'crear', 'editar', 'borrar')),
  creado_en     timestamptz not null default now()
);
create index if not exists credenciales_accesos_cliente_idx on public.credenciales_accesos (cliente_id, creado_en desc);
alter table public.credenciales_accesos enable row level security;
revoke all on public.credenciales_accesos from anon, authenticated;

-- Solo para las funciones del servidor: de quién es este token (no vale una vista de solo lectura)
create or replace function public.servidor_cliente_de_token(p_token text)
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select public._cliente_de_token(p_token);
$$;
revoke all on function public.servidor_cliente_de_token(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Tareas programadas: informe (día 1, 8:00), Google (lunes 6:30) y enlaces (cada hora, una web por vez)
-- ---------------------------------------------------------------------
create or replace function public.lanzar_funcion(p_nombre text)
returns void language plpgsql security definer set search_path = public as $$
declare u text; s text;
begin
  if p_nombre not in ('informe', 'google', 'enlaces', 'medir') then
    raise exception 'Función no permitida.';
  end if;
  select valor into u from ajustes where clave = 'url_proyecto';
  select valor into s from ajustes where clave = 'secreto_cron';
  if u is null or s is null then
    return;
  end if;
  perform net.http_post(
    url := u || '/functions/v1/' || p_nombre,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-secreto', s),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
end
$$;
revoke all on function public.lanzar_funcion(text) from public, anon, authenticated;

do $$
begin
  perform cron.schedule('webcare-informe', '0 8 1 * *', 'select public.lanzar_funcion(''informe'')');
  perform cron.schedule('webcare-google', '30 6 * * 1', 'select public.lanzar_funcion(''google'')');
  perform cron.schedule('webcare-enlaces', '23 * * * *', 'select public.lanzar_funcion(''enlaces'')');
exception when others then
  raise notice 'pg_cron no disponible: %', sqlerrm;
end
$$;

select 'Mejoras 3 aplicadas' as resultado;
