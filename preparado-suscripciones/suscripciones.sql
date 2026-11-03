-- Suscripciones, renovaciones, impagos, bajas y pago a plazos (Stripe).
-- Se aplica UNA vez, el día que se activen las suscripciones (Supabase > SQL Editor > pegar y Run).
-- Todo lo nuevo lo usa solo el servidor (función «pago»): ningún visitante ni cliente puede llamarlo directamente.

-- 1) Columnas nuevas en los servicios de cada cliente
alter table servicios_cliente
  add column if not exists stripe_suscripcion text,          -- suscripción de Stripe que cobra este servicio
  add column if not exists impago_en timestamptz,            -- primer cobro fallido sin resolver (null = al día)
  add column if not exists impago_intentos integer not null default 0,
  add column if not exists baja_programada_en timestamptz,   -- la suscripción se cancela sola en esta fecha
  add column if not exists plazos_total integer,             -- pago a plazos: número de cuotas (null = no financiado)
  add column if not exists plazos_pagados integer not null default 0;
create index if not exists servicios_cliente_stripe_suscripcion on servicios_cliente (stripe_suscripcion) where stripe_suscripcion is not null;

-- 2) El portal recibe esos datos (se añaden a la lista de servicios de «cliente_datos»)
do $$
declare d text := pg_get_functiondef('public.cliente_datos'::regproc);
        viejo text := '''publicado_en'', s.publicado_en';
begin
  if strpos(d, '''impago_en'', s.impago_en') > 0 then return; end if;   -- ya aplicado
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then
    raise exception 'cliente_datos ha cambiado: revisa este paso a mano.';
  end if;
  execute replace(d, viejo, viejo || ', ''impago_en'', s.impago_en, ''baja_programada_en'', s.baja_programada_en, '
    || '''plazos_total'', s.plazos_total, ''plazos_pagados'', s.plazos_pagados, ''suscrito'', s.stripe_suscripcion is not null');
end $$;

-- Busca el servicio de una suscripción (por su id de Stripe o, si aún no está vinculada, por cliente y nombre)
create or replace function public._servicio_de_suscripcion(p_suscripcion text, p_cliente uuid, p_nombre text)
returns servicios_cliente language plpgsql stable security definer set search_path to 'public' as $$
declare s servicios_cliente;
begin
  select * into s from servicios_cliente where stripe_suscripcion = p_suscripcion limit 1;
  if s.id is null and p_cliente is not null then
    select * into s from servicios_cliente
     where cliente_id = p_cliente and nombre = left(coalesce(p_nombre, ''), 150) and estado in ('activo', 'pendiente')
     order by creado_en desc limit 1;
  end if;
  return s;
end $$;

-- 3) Vincular la suscripción de Stripe al servicio (al terminar el primer pago)
create or replace function public.servidor_vincular_suscripcion(p_servicio bigint, p_suscripcion text, p_plazos integer default null)
returns void language sql security definer set search_path to 'public' as $$
  update servicios_cliente set stripe_suscripcion = p_suscripcion, plazos_total = coalesce(p_plazos, plazos_total)
   where id = p_servicio;
$$;

-- 4) Renovación mensual cobrada (factura de Stripe «subscription_cycle»)
create or replace function public.servidor_renovacion(p_factura text, p_cliente uuid, p_suscripcion text, p_nombre text, p_importe numeric)
returns json language plpgsql security definer set search_path to 'public' as $$
declare s servicios_cliente;
begin
  if exists (select 1 from pagos where sesion = p_factura) then return json_build_object('repetido', true); end if;
  s := _servicio_de_suscripcion(p_suscripcion, p_cliente, p_nombre);
  if s.id is not null and s.stripe_suscripcion is null then
    update servicios_cliente set stripe_suscripcion = p_suscripcion where id = s.id;
  end if;
  insert into pagos (sesion, cliente_id, tipo, nombre, importe, modo, servicio_id, caso_id, parte)
  values (p_factura, p_cliente, coalesce(s.tipo, 'suscripcion'), p_nombre, p_importe, 'subscription', s.id, s.caso_id, 'renovacion');
  if s.id is not null then
    -- Si venía de un impago, queda resuelto
    if s.impago_en is not null and s.caso_id is not null then
      insert into mensajes_caso (caso_id, autor_tipo, autor, texto)
      values (s.caso_id, 'staff', 'sistema', '✅ Cuota de «' || s.nombre || '» cobrada. Todo al día, ¡gracias!');
    end if;
    update servicios_cliente set impago_en = null, impago_intentos = 0 where id = s.id;
  end if;
  return json_build_object('servicio_id', s.id, 'caso_id', s.caso_id);
end $$;

-- 5) Cobro fallido (Stripe lo reintenta solo varios días; aquí se marca y se avisa al cliente por su chat)
create or replace function public.servidor_impago(p_factura text, p_cliente uuid, p_suscripcion text, p_nombre text,
  p_importe numeric, p_intento integer, p_proximo timestamptz)
returns json language plpgsql security definer set search_path to 'public' as $$
declare s servicios_cliente; txt text;
begin
  s := _servicio_de_suscripcion(p_suscripcion, p_cliente, p_nombre);
  if s.id is null then return json_build_object('omitido', 'Servicio no encontrado'); end if;
  update servicios_cliente set impago_en = coalesce(impago_en, now()), impago_intentos = greatest(coalesce(p_intento, 1), 1)
   where id = s.id;
  -- Un solo mensaje al cliente en el primer fallo y otro si Stripe ya no va a reintentar
  if s.caso_id is not null and (coalesce(p_intento, 1) <= 1 or p_proximo is null) then
    txt := '⚠️ No hemos podido cobrar ' || replace(to_char(p_importe, 'FM999990.00'), '.', ',') || ' € de «' || s.nombre || '». '
      || case when p_proximo is not null
              then 'Lo volveremos a intentar el ' || to_char(p_proximo at time zone 'Europe/Madrid', 'DD/MM/YYYY') || '. '
              else 'Ya no se va a reintentar automáticamente. ' end
      || 'Puedes actualizar tu tarjeta en «Facturación» › «Gestionar mi pago». Si necesitas ayuda, escríbenos aquí.';
    insert into mensajes_caso (caso_id, autor_tipo, autor, texto) values (s.caso_id, 'staff', 'sistema', txt);
  end if;
  return json_build_object('servicio_id', s.id, 'caso_id', s.caso_id, 'cliente_id', s.cliente_id, 'nombre', s.nombre);
end $$;

-- 6) Baja programada (el cliente se da de baja: sigue activo hasta el final del periodo pagado). p_fin null = la anula.
create or replace function public.servidor_baja_programada(p_suscripcion text, p_fin timestamptz)
returns json language plpgsql security definer set search_path to 'public' as $$
declare s servicios_cliente;
begin
  select * into s from servicios_cliente where stripe_suscripcion = p_suscripcion and plazos_total is null limit 1;
  -- Stripe repite el aviso con cada cambio de la suscripción: solo se apunta (y se avisa) si la fecha cambia
  if s.id is null or s.baja_programada_en is not distinct from p_fin then return json_build_object('servicio_id', s.id); end if;
  update servicios_cliente set baja_programada_en = p_fin where id = s.id;
  if p_fin is not null and s.caso_id is not null then
    insert into mensajes_caso (caso_id, autor_tipo, autor, texto)
    values (s.caso_id, 'staff', 'sistema', '📅 «' || s.nombre || '» se dará de baja el '
      || to_char(p_fin at time zone 'Europe/Madrid', 'DD/MM/YYYY') || '. Hasta entonces sigue activo y no se harán más cobros.');
  end if;
  return json_build_object('servicio_id', s.id);
end $$;

-- 7) La suscripción ha terminado en Stripe (baja al final del periodo o impago sin resolver)
create or replace function public.servidor_fin_suscripcion(p_suscripcion text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare s servicios_cliente;
begin
  select * into s from servicios_cliente where stripe_suscripcion = p_suscripcion limit 1;
  if s.id is null then return json_build_object('omitido', 'Servicio no encontrado'); end if;
  if s.plazos_total is not null then
    -- Pago a plazos: si ya está todo pagado es el final normal; si no, se marca como impago para reclamarlo
    if s.plazos_pagados < s.plazos_total then
      update servicios_cliente set impago_en = coalesce(impago_en, now()) where id = s.id;
      if s.caso_id is not null then
        insert into mensajes_caso (caso_id, autor_tipo, autor, texto) values (s.caso_id, 'staff', 'sistema',
          '⚠️ El pago a plazos de «' || s.nombre || '» se ha detenido con ' || s.plazos_pagados || ' de ' || s.plazos_total
          || ' cuotas pagadas. Escríbenos para regularizarlo.');
      end if;
    end if;
    return json_build_object('servicio_id', s.id, 'plazos', true);
  end if;
  update servicios_cliente set estado = 'baja', baja_en = now(), baja_programada_en = null where id = s.id and estado <> 'baja';
  if s.tipo in ('mantenimiento', 'renting') then
    update webs_cliente set plan = null where cliente_id = s.cliente_id and plan = s.nombre;
  end if;
  if s.caso_id is not null then
    insert into mensajes_caso (caso_id, autor_tipo, autor, texto) values (s.caso_id, 'staff', 'sistema',
      '«' || s.nombre || '» se ha dado de baja' || case when s.impago_en is not null then ' por falta de pago' else '' end
      || '. No se harán más cobros.');
  end if;
  return json_build_object('servicio_id', s.id, 'cliente_id', s.cliente_id, 'nombre', s.nombre, 'impago', s.impago_en is not null);
end $$;

-- 8) Cuota de un pago a plazos cobrada. En una web, la primera cuota cuenta como anticipo (empezamos a trabajar);
--    la entrega se libera al cobrar la última.
create or replace function public.servidor_registrar_plazo(p_factura text, p_cliente uuid, p_servicio bigint, p_importe numeric, p_total integer)
returns json language plpgsql security definer set search_path to 'public' as $$
declare s servicios_cliente; n integer;
begin
  if exists (select 1 from pagos where sesion = p_factura) then return json_build_object('repetido', true); end if;
  select * into s from servicios_cliente where id = p_servicio and cliente_id = p_cliente;
  if s.id is null then raise exception 'Pedido no encontrado.'; end if;
  n := coalesce(s.plazos_pagados, 0) + 1;
  update servicios_cliente set
    plazos_total = p_total, plazos_pagados = n, impago_en = null, impago_intentos = 0,
    anticipo_en = case when tipo = 'web' then coalesce(anticipo_en, now()) else anticipo_en end,
    anticipo_por = case when tipo = 'web' then coalesce(anticipo_por, 'Stripe (a plazos)') else anticipo_por end,
    pagado_en = case when n >= p_total then coalesce(pagado_en, now()) else pagado_en end,
    pagado_por = case when n >= p_total then coalesce(pagado_por, 'Stripe (a plazos)') else pagado_por end
   where id = s.id;
  insert into pagos (sesion, cliente_id, tipo, nombre, importe, modo, servicio_id, caso_id, parte)
  values (p_factura, p_cliente, s.tipo, s.nombre, p_importe, 'subscription', s.id, s.caso_id, 'plazo ' || n || '/' || p_total);
  if s.caso_id is not null then
    insert into mensajes_caso (caso_id, autor_tipo, autor, texto) values (s.caso_id, 'staff', 'sistema',
      '💶 Cuota ' || n || ' de ' || p_total || ' recibida (' || replace(to_char(p_importe, 'FM999990.00'), '.', ',') || ' €).'
      || case when n >= p_total then ' ¡Pago completado, gracias!' else '' end);
  end if;
  return json_build_object('servicio_id', s.id, 'caso_id', s.caso_id, 'plazo', n, 'completado', n >= p_total);
end $$;


-- 9) Cuotas automáticas tras un pago (hosting, gestión de pedidos, asistente IA): el servidor crea la suscripción de
--    Stripe con su periodo gratis y aquí se da de alta como servicio del cliente (sale en su portal, con baja disponible).
--    Idempotente: una misma suscripción nunca crea dos servicios.
create or replace function public.servidor_alta_cuota(p_cliente uuid, p_nombre text, p_importe numeric, p_suscripcion text,
  p_gratis_hasta timestamptz, p_caso bigint default null)
returns json language plpgsql security definer set search_path to 'public' as $$
declare s servicios_cliente; precio text;
begin
  select * into s from servicios_cliente where stripe_suscripcion = p_suscripcion limit 1;
  if s.id is not null then return json_build_object('servicio_id', s.id, 'repetido', true); end if;
  precio := replace(to_char(p_importe, 'FM999990.00'), '.', ',') || ' €/mes';
  insert into servicios_cliente (cliente_id, tipo, nombre, precio, estado, caso_id, activado_en, pagado_por, stripe_suscripcion, nota)
  values (p_cliente, 'extra', left(p_nombre, 150), precio, 'activo', p_caso, now(), 'Stripe', p_suscripcion,
          'Gratis hasta el ' || to_char(p_gratis_hasta at time zone 'Europe/Madrid', 'DD/MM/YYYY') || '; después ' || precio || ' con la tarjeta guardada.')
  returning * into s;
  if p_caso is not null then
    insert into mensajes_caso (caso_id, autor_tipo, autor, texto)
    values (p_caso, 'staff', 'sistema', '🔁 Activado «' || left(p_nombre, 150) || '»: gratis hasta el '
            || to_char(p_gratis_hasta at time zone 'Europe/Madrid', 'DD/MM/YYYY') || ' y después ' || precio || '. Puedes darlo de baja cuando quieras desde tu portal.');
  end if;
  return json_build_object('servicio_id', s.id);
end $$;

-- ¿Qué cuotas ya cubre el cliente? (mantenimiento o renting activos, la misma cuota ya dada de alta o hosting fuera de Velority)
create or replace function public.servidor_cuotas_cubiertas(p_cliente uuid)
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select 'EXT-28' as x from servicios_cliente where cliente_id = p_cliente and estado in ('activo', 'pendiente')
       and (nombre like 'Mantenimiento %' or nombre like 'Renting %' or nombre like 'EXT-28 %')
    union all
    select 'EXT-26' from servicios_cliente where cliente_id = p_cliente and estado in ('activo', 'pendiente')
       and (nombre in ('Mantenimiento Tienda', 'Renting Plan Ecommerce') or nombre like 'EXT-26 %')
    union all
    select 'EXT-27' from servicios_cliente where cliente_id = p_cliente and estado in ('activo', 'pendiente') and nombre like 'EXT-27 %'
    union all
    select 'EXT-28' from webs_cliente where cliente_id = p_cliente and (plan like 'Mantenimiento %' or plan like 'Renting %')
    union all
    select 'EXT-26' from webs_cliente where cliente_id = p_cliente and plan in ('Mantenimiento Tienda', 'Renting Plan Ecommerce')
    union all   -- su web se aloja fuera de Velority (columna webs_cliente.hosting_externo): nunca se le cobra hosting
    select 'EXT-28' from webs_cliente where cliente_id = p_cliente and hosting_externo
  ) t;
$$;

-- Solo el servidor (service_role) puede usar estas funciones
do $$
declare f text;
begin
  foreach f in array array[
    '_servicio_de_suscripcion(text, uuid, text)', 'servidor_vincular_suscripcion(bigint, text, integer)',
    'servidor_renovacion(text, uuid, text, text, numeric)',
    'servidor_impago(text, uuid, text, text, numeric, integer, timestamptz)',
    'servidor_baja_programada(text, timestamptz)', 'servidor_fin_suscripcion(text)',
    'servidor_registrar_plazo(text, uuid, bigint, numeric, integer)',
    'servidor_alta_cuota(uuid, text, numeric, text, timestamptz, bigint)', 'servidor_cuotas_cubiertas(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;
