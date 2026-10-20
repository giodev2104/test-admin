-- =====================================================================
--  Webcare · Ficha de la web de cada cliente
-- =====================================================================
-- Añade la tabla "webs_cliente": los datos que el cliente ve en su portal
-- (Mi web, SEO y Facturación) y que el equipo edita desde el panel.
-- Ejecútalo en Supabase > SQL Editor sobre la base creada con
-- supabase_completo.sql (que ya lo incluye en instalaciones nuevas).
-- Se puede ejecutar varias veces sin perder datos.
-- =====================================================================

create table if not exists public.webs_cliente (
  cliente_id          uuid primary key references public.clientes(id) on delete cascade,
  -- Mi web
  plan                text,                         -- p. ej. «Mantenimiento Pro»
  puntuacion          int check (puntuacion between 0 and 100),
  resumen             text,                         -- «Tu web está segura y funcionando con normalidad.»
  revisado_en         timestamptz,
  disponibilidad      numeric(5,2) check (disponibilidad between 0 and 100),   -- % últimos 30 días
  amenazas            int check (amenazas >= 0),
  ssl_activo          boolean,
  ultima_copia        timestamptz,
  copias_guardadas    int check (copias_guardadas >= 0),
  velocidad           numeric(4,1) check (velocidad >= 0),                     -- segundos de carga
  mes_actualizaciones int check (mes_actualizaciones >= 0),
  mes_ataques         int check (mes_ataques >= 0),
  mes_cambios         int check (mes_cambios >= 0),
  mes_horas           numeric(5,1) check (mes_horas >= 0),
  horas_incluidas     numeric(5,1) check (horas_incluidas >= 0),
  horas_usadas        numeric(5,1) check (horas_usadas >= 0),
  recomendacion       text,                         -- vacía = no se muestra
  proximos            jsonb not null default '[]',  -- [{texto, cuando}]
  -- SEO
  seo_periodo         text,                         -- p. ej. «Octubre 2026»
  seo_visitas         int,                          -- % de cambio (puede ser negativo)
  seo_impresiones     int,
  seo_clics           int,
  seo_primera_pagina  int check (seo_primera_pagina >= 0),
  seo_palabras        jsonb not null default '[]',  -- [{palabra, antes, ahora}]
  seo_acciones        jsonb not null default '[]',  -- [{texto}]
  seo_informe_url     text,
  -- Facturación
  metodo_pago         text,                         -- p. ej. «Visa terminada en 4242»
  facturas            jsonb not null default '[]',  -- [{numero, fecha, importe, url}]
  actualizado_en      timestamptz not null default now(),
  actualizado_por     text
);

alter table public.webs_cliente enable row level security;
revoke all on public.webs_cliente from anon, authenticated;
grant select, insert, update on public.webs_cliente to authenticated;

drop policy if exists "staff_lee_webs" on public.webs_cliente;
create policy "staff_lee_webs" on public.webs_cliente for select to authenticated using (public.es_staff());
drop policy if exists "staff_crea_webs" on public.webs_cliente;
create policy "staff_crea_webs" on public.webs_cliente for insert to authenticated with check (public.es_staff());
drop policy if exists "staff_edita_webs" on public.webs_cliente;
create policy "staff_edita_webs" on public.webs_cliente for update to authenticated
  using (public.es_staff()) with check (public.es_staff());

-- El equipo también puede corregir el nombre y el dominio del cliente
grant update (nombre, dominio) on public.clientes to authenticated;
drop policy if exists "staff_edita_clientes" on public.clientes;
create policy "staff_edita_clientes" on public.clientes for update to authenticated
  using (public.es_staff()) with check (public.es_staff());

-- Quién y cuándo tocó la ficha por última vez
create or replace function public.webs_cliente_sello()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := coalesce(public.staff_usuario(), 'sistema');
  return new;
end $$;
drop trigger if exists webs_cliente_sello on public.webs_cliente;
create trigger webs_cliente_sello before insert or update on public.webs_cliente
  for each row execute function public.webs_cliente_sello();

-- (columna del cambio de plan automático, ver supabase_cambio_plan.sql)
alter table public.reportes add column if not exists plan_solicitado text;

-- El portal recibe también la ficha de su web (clave "web"; null si aún no hay datos)
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
end $$;

-- Comprobación
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'webs_cliente';
