-- =====================================================================
--  Webcare · Catálogo de precios único (portal + panel + cobros de Stripe)
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de supabase_borrar_cliente.sql.
-- No borra datos y se puede ejecutar varias veces: los precios que ya hayas cambiado desde el panel
-- no se pisan.
--
-- Los precios viven solo en la tabla «catalogo». El portal los muestra, la función «pago» cobra
-- exactamente estos importes y el panel los usa para los ingresos mensuales. Se editan desde el panel
-- (Negocio > «💶 Precios»), solo los propietarios. Los textos de lo que incluye cada servicio siguen en el portal.
--
--   nombre        nombre exacto del servicio (el que se guarda en casos, servicios y fichas)
--   tipo          web · mantenimiento · renting · pack · extra
--   precio        importe en € (en los planes de web, el precio «desde»; se piden por presupuesto)
--   precio_hasta  solo planes de web: precio «hasta»
--   precio_anual  solo mantenimiento: precio si se paga el año entero
--   cada          meses entre cobros (0 = pago único, 1 = mensual, 3 = trimestral)
--   activo        false = deja de ofrecerse en el portal (los clientes que ya lo tienen no cambian)
-- =====================================================================

create table if not exists public.catalogo (
  nombre          text primary key check (length(nombre) between 1 and 150),
  tipo            text not null check (tipo in ('web', 'mantenimiento', 'renting', 'pack', 'extra')),
  precio          numeric(10,2) not null check (precio >= 0),
  precio_hasta    numeric(10,2) check (precio_hasta is null or precio_hasta >= precio),
  precio_anual    numeric(10,2) check (precio_anual is null or precio_anual >= 0),
  cada            int not null default 0 check (cada in (0, 1, 3, 6, 12)),
  activo          boolean not null default true,
  orden           int not null default 0,
  actualizado_en  timestamptz not null default now(),
  actualizado_por text
);
alter table public.catalogo enable row level security;
revoke all on public.catalogo from anon, authenticated;
grant select on public.catalogo to authenticated;
grant update (precio, precio_hasta, precio_anual, activo, actualizado_en, actualizado_por) on public.catalogo to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catalogo' and policyname = 'staff_lee_catalogo') then
    create policy "staff_lee_catalogo" on public.catalogo for select to authenticated using (public.es_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catalogo' and policyname = 'dueno_edita_catalogo') then
    create policy "dueno_edita_catalogo" on public.catalogo for update to authenticated
      using (exists (select 1 from public.staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and es_dueno))
      with check (exists (select 1 from public.staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and es_dueno));
  end if;
end
$$;

-- Precios de la Propuesta Comercial 2026 (solo se insertan si no existen)
insert into public.catalogo (nombre, tipo, precio, precio_hasta, precio_anual, cada, orden) values
  ('Plan Lanzamiento',                             'web',           190, 250, null, 0, 10),
  ('Plan Negocio',                                 'web',           390, 490, null, 0, 11),
  ('Plan Ecommerce / Citas',                       'web',           690, 890, null, 0, 12),
  ('Mantenimiento Esencial',                       'mantenimiento',  19, null, 190, 1, 20),
  ('Mantenimiento Pro',                            'mantenimiento',  39, null, 390, 1, 21),
  ('Renting Plan Lanzamiento',                     'renting',        29, null, null, 1, 30),
  ('Renting Plan Negocio',                         'renting',        49, null, null, 1, 31),
  ('Renting Plan Ecommerce',                       'renting',        79, null, null, 1, 32),
  ('Pack Presencia Local Total',                   'pack',          119, null, null, 0, 40),
  ('Pack Despegue Marca & Web',                    'pack',          239, null, null, 0, 41),
  ('Pack Ecommerce Express',                       'pack',          179, null, null, 0, 42),
  ('Pack Marketing & Conversión 360°',             'pack',          149, null, null, 0, 43),
  ('EXT-01 · Redacción Persuasiva (Copywriting)',  'extra',         120, null, null, 0, 50),
  ('EXT-02 · Diseño de Logo & Marca Básico',       'extra',         149, null, null, 0, 51),
  ('EXT-03 · Aviso Legal & LOPD/RGPD Adaptado',    'extra',          45, null, null, 0, 52),
  ('EXT-04 · Pack Imágenes HD de Stock',           'extra',          39, null, null, 0, 53),
  ('EXT-05 · Configuración Correo Corporativo',    'extra',          29, null, null, 0, 54),
  ('EXT-06 · Pasarela de Pago Adicional',          'extra',          49, null, null, 0, 55),
  ('EXT-07 · Web Multidioma',                      'extra',          89, null, null, 0, 56),
  ('EXT-08 · Widget Reseñas de Google',            'extra',          39, null, null, 0, 57),
  ('EXT-09 · Asistente Chatbot IA / WhatsApp',     'extra',          99, null, null, 0, 58),
  ('EXT-10 · Carga Masiva de Productos',           'extra',          69, null, null, 0, 59),
  ('EXT-15 · Ficha Google Maps (SEO Local)',       'extra',          79, null, null, 0, 60),
  ('EXT-16 · Google Search Console & Sitemap',     'extra',          29, null, null, 0, 61),
  ('EXT-17 · Píxeles Meta (FB/IG) y TikTok',       'extra',          39, null, null, 0, 62),
  ('EXT-19 · Gestión de Blog Mensual',             'extra',          59, null, null, 1, 63),
  ('EXT-21 · Auditoría SEO Trimestral',            'extra',          49, null, null, 3, 64)
on conflict (nombre) do nothing;

-- El portal (cualquiera, sin sesión) lee los precios con esta función
create or replace function public.catalogo_publico()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('nombre', nombre, 'tipo', tipo, 'precio', precio, 'precio_hasta', precio_hasta,
                                             'precio_anual', precio_anual, 'cada', cada, 'activo', activo) order by orden, nombre), '[]'::json)
  from catalogo;
$$;
revoke all on function public.catalogo_publico() from public;
grant execute on function public.catalogo_publico() to anon, authenticated;

select 'Catálogo listo: ' || count(*) || ' servicios' as resultado from public.catalogo;
