-- Descuentos de temporada (Black Friday…): aplicada en Supabase el 05/11/2026.
-- Cada servicio del catálogo tiene su % de temporada (oferta_temporada). Solo se aplica mientras el «Tema de temporada»
-- del panel está en vigor y con la casilla «Aplicar los descuentos de temporada» marcada.
-- catalogo_publico() (lo que ve la web) y la función «pago» (lo que cobra Stripe) usan la misma regla: oferta_actual().
alter table public.catalogo add column if not exists oferta_temporada integer
  check (oferta_temporada is null or oferta_temporada between 1 and 90);

create or replace function public.temporada_descuentos_hasta()
returns date language sql stable security definer set search_path to 'public' as $$
  select case
    when coalesce((a.valor->>'descuentos')::boolean, false)
     and coalesce(a.valor->>'tema', '') <> ''
     and (nullif(a.valor->>'desde','') is null or now() >= (a.valor->>'desde')::timestamptz)
     and (nullif(a.valor->>'hasta','') is null or now() <= (a.valor->>'hasta')::timestamptz)
    then coalesce(((a.valor->>'hasta')::timestamptz at time zone 'Europe/Madrid')::date, date '9999-12-31') end
  from ajustes_web a where a.clave = 'tema';
$$;

create or replace function public.oferta_actual(p_pct integer, p_hasta date, p_temporada integer)
returns integer language sql stable security definer set search_path to 'public' as $$
  select case when p_temporada is not null and temporada_descuentos_hasta() is not null
              then greatest(p_temporada, coalesce(oferta_vigente(p_pct, p_hasta), 0))
              else oferta_vigente(p_pct, p_hasta) end;
$$;

create or replace function public.oferta_actual_hasta(p_pct integer, p_hasta date, p_temporada integer)
returns date language sql stable security definer set search_path to 'public' as $$
  select case
    when p_temporada is not null and temporada_descuentos_hasta() is not null
         and p_temporada >= coalesce(oferta_vigente(p_pct, p_hasta), 0)
      then nullif(temporada_descuentos_hasta(), date '9999-12-31')
    when oferta_vigente(p_pct, p_hasta) is not null then p_hasta end;
$$;

create or replace function public.catalogo_publico()
returns json language sql stable security definer set search_path to 'public' as $$
  select coalesce(json_agg(json_build_object('nombre', nombre, 'tipo', tipo, 'precio', precio, 'precio_hasta', precio_hasta,
                                             'precio_anual', precio_anual, 'cada', cada, 'activo', activo,
                                             'precio_tokens', precio_tokens,
                                             'oferta', oferta_actual(oferta_pct, oferta_hasta, oferta_temporada),
                                             'oferta_hasta', oferta_actual_hasta(oferta_pct, oferta_hasta, oferta_temporada))
                           order by orden, nombre), '[]'::json)
  from catalogo;
$$;

-- 50 %: lo que apenas cuesta hacer o deja cuota mensual detrás
update public.catalogo set oferta_temporada = 50 where nombre in (
  'EXT-09 · Asistente Chatbot IA / WhatsApp', 'EXT-12 · Panel de gestión de pedidos',
  'EXT-22 · Kit de reseñas (QR + tarjeta)', 'EXT-16 · Google Search Console & Sitemap', 'Pack Citas');
-- 25 %: lo que lleva horas de trabajo y los packs
update public.catalogo set oferta_temporada = 25 where nombre in (
  'EXT-14 · Optimización de velocidad (WPO)', 'EXT-23 · Revisión de accesibilidad', 'EXT-13 · Página o sección extra',
  'EXT-25 · Cambios sueltos (1 hora)', 'EXT-15 · Ficha Google Maps (SEO Local)', 'EXT-08 · Widget Reseñas de Google',
  'EXT-18 · Reservas o cita online', 'EXT-20 · Carta digital con QR', 'EXT-24 · Puesta en marcha de anuncios',
  'EXT-17 · Píxeles Meta (FB/IG) y TikTok', 'EXT-11 · Panel de gestión de productos', 'EXT-06 · Pasarela de Pago Adicional',
  'EXT-10 · Carga Masiva de Productos', 'EXT-07 · Web Multidioma',
  'Pack Presencia Local', 'Pack Hostelería', 'Pack Tienda Lista');
