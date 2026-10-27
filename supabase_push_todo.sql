-- Avisos push de TODO lo que hacen los clientes (además de casos y mensajes, en supabase_push.sql):
-- registros, pedidos, pagos, aprobaciones, cambios pedidos, bajas, catálogo de productos, bóveda, invitados,
-- valoraciones, códigos de descuento, recomendaciones, descargas, correos recibidos y webs caídas o recuperadas.
-- Lo que hace el propio equipo desde el panel nunca se avisa. Requiere supabase_push.sql y la función «push».

-- Envía un aviso a la función «push» (nunca bloquea la operación que lo provoca)
create or replace function public._push_enviar(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare u text; s text;
begin
  select valor into u from ajustes where clave = 'url_proyecto';
  select valor into s from ajustes where clave = 'secreto_cron';
  if u is null or s is null then return; end if;
  perform net.http_post(
    url := u || '/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-secreto', s),
    body := jsonb_build_object('accion', 'evento') || p,
    timeout_milliseconds := 15000);
exception when others then
  return;
end
$$;
revoke all on function public._push_enviar(jsonb) from public, anon, authenticated;

create or replace function public._avisar_evento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  cid uuid := nullif(n->>'cliente_id', '')::uuid;
  cli text; t text; x text; enl text; tag text; todos boolean := false; previo boolean;
begin
  if public.es_staff() then return null; end if;
  if cid is not null then select coalesce(nullif(nombre, ''), email) into cli from clientes where id = cid; end if;
  cli := coalesce(cli, 'Un cliente');
  enl := case when cid is not null then 'cliente=' || cid end;

  if tg_table_name = 'clientes' then
    t := '👤 Nuevo cliente: ' || coalesce(nullif(n->>'nombre', ''), n->>'email');
    x := concat_ws(' · ', n->>'email', nullif(n->>'dominio', ''), nullif(n->>'telefono', ''));
    enl := 'cliente=' || (n->>'id');

  elsif tg_table_name = 'valoraciones' then
    t := '⭐ ' || (n->>'estrellas') || ' estrellas · ' || cli;
    x := coalesce(nullif(n->>'comentario', ''), 'Nueva valoración sin comentario.');

  elsif tg_table_name = 'pagos' then
    t := '💶 Pago recibido · ' || cli;
    x := concat_ws(' · ', n->>'nombre', replace(to_char((n->>'importe')::numeric, 'FM9999990.00'), '.', ',') || ' €', nullif(n->>'parte', ''));

  elsif tg_table_name = 'servicios_cliente' then
    if tg_op = 'INSERT' then
      t := '🛒 Nuevo pedido · ' || cli; x := concat_ws(' · ', n->>'nombre', n->>'precio');
    elsif o->>'aprobado_en' is null and n->>'aprobado_en' is not null then
      t := '✅ ' || cli || ' ha aprobado su web'; x := n->>'nombre';
    elsif coalesce((n->>'revisiones_usadas')::int, 0) > coalesce((o->>'revisiones_usadas')::int, 0) then
      t := '✏️ ' || cli || ' pide cambios'; x := (n->>'nombre') || ' · ronda ' || (n->>'revisiones_usadas');
    elsif (o->>'caso_baja_id' is null and n->>'caso_baja_id' is not null) or (o->>'baja_en' is null and n->>'baja_en' is not null) then
      t := '👋 ' || cli || ' ha pedido la baja'; x := n->>'nombre';
    else return null; end if;

  elsif tg_table_name = 'productos' then
    -- Reordenar el catálogo no avisa (cambia muchos productos a la vez)
    if tg_op = 'UPDATE' and (n - 'orden' - 'actualizado_en' - 'actualizado_por') = (o - 'orden' - 'actualizado_en' - 'actualizado_por') then return null; end if;
    t := '🛍️ ' || cli || case tg_op when 'INSERT' then ' ha añadido un producto' when 'UPDATE' then ' ha editado un producto' else ' ha borrado un producto' end;
    x := (n->>'nombre') || coalesce(' · ' || replace(to_char(coalesce(n->>'precio_oferta', n->>'precio')::numeric, 'FM9999990.00'), '.', ',') || ' €', '')
         || case when tg_op = 'UPDATE' and (n->>'visible') is distinct from (o->>'visible') then case when (n->>'visible')::boolean then ' · ahora visible' else ' · ahora oculto' end else '' end;
    tag := 'catalogo-' || cid;

  elsif tg_table_name = 'credenciales' then
    t := '🔐 ' || cli || case tg_op when 'INSERT' then ' ha guardado un acceso' when 'UPDATE' then ' ha cambiado un acceso' else ' ha borrado un acceso' end;
    x := 'Bóveda: ' || coalesce(nullif(n->>'servicio', ''), 'sin nombre');   -- nunca el usuario ni la contraseña

  elsif tg_table_name = 'boveda_invitados' then
    if tg_op = 'UPDATE' then return null; end if;   -- últimos accesos, cambios de clave…
    t := '👥 ' || cli || case tg_op when 'INSERT' then ' ha invitado a alguien a su portal' else ' ha quitado un invitado' end;
    x := concat_ws(' · ', n->>'nombre', n->>'email');

  elsif tg_table_name = 'correos' then
    if n->>'direccion' <> 'entrada' then return null; end if;
    t := '📧 ' || coalesce(nullif(n->>'contacto_nombre', ''), n->>'contacto');
    x := coalesce(nullif(n->>'asunto', ''), '(sin asunto)');
    enl := 'correo'; tag := 'correo-' || (n->>'id');

  elsif tg_table_name = 'referidos' then
    select coalesce(nullif(nombre, ''), email) into cli from clientes where id = (n->>'referidor_id')::uuid;
    t := '🤝 Nuevo cliente recomendado';
    x := 'Por ' || coalesce(cli, 'un cliente') || coalesce(' → ' || (select coalesce(nullif(nombre, ''), email) from clientes where id = (n->>'referido_id')::uuid), '');
    enl := 'cliente=' || (n->>'referido_id');

  elsif tg_table_name = 'codigos_usos' then
    t := '🏷️ ' || cli || ' ha usado un código';
    x := coalesce((select codigo from codigos_promo where id = (n->>'codigo_id')::bigint), 'Código') || coalesce(' · −' || replace(to_char((n->>'descuento')::numeric, 'FM9999990.00'), '.', ',') || ' €', '');

  elsif tg_table_name = 'entregas' then
    if not (o->>'descargado_en' is null and n->>'descargado_en' is not null) then return null; end if;
    t := '📥 ' || cli || ' ha descargado un archivo'; x := n->>'nombre';

  elsif tg_table_name = 'reportes' then
    if o->>'demo_aceptada_en' is null and n->>'demo_aceptada_en' is not null then
      t := '✅ ' || cli || ' ha aceptado la demo';
    elsif o->>'condiciones_aceptadas_en' is null and n->>'condiciones_aceptadas_en' is not null then
      t := '📝 ' || cli || ' ha aceptado las condiciones';
    else return null; end if;
    x := '«' || coalesce(nullif(n->>'titulo', ''), 'Sin título') || '» (#' || (n->>'id') || ')';
    enl := 'caso=' || (n->>'id');

  elsif tg_table_name = 'comprobaciones' then
    -- Solo cuando la web cambia de estado (cae o vuelve), no en cada medición
    select ok into previo from comprobaciones where cliente_id = cid and id <> (n->>'id')::bigint order by creado_en desc limit 1;
    if (n->>'ok')::boolean = coalesce(previo, true) then return null; end if;
    select coalesce(nullif(dominio, ''), cli) into cli from clientes where id = cid;
    t := case when (n->>'ok')::boolean then '🟢 Web recuperada · ' else '🔴 Web caída · ' end || coalesce(cli, 'un cliente');
    x := case when (n->>'ok')::boolean then 'Vuelve a funcionar' || coalesce(' (' || (n->>'ms') || ' ms)', '') else 'No responde' || coalesce(' · código ' || nullif(n->>'codigo', ''), '') end;
    tag := 'web-' || cid; todos := true;

  else return null; end if;

  perform public._push_enviar(jsonb_build_object('titulo', left(t, 120), 'texto', left(coalesce(x, ''), 300),
    'enlace', enl, 'etiqueta', tag, 'todos', todos));
  return null;
exception when others then
  return null;
end
$$;
revoke all on function public._avisar_evento() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['clientes', 'valoraciones', 'pagos', 'servicios_cliente', 'productos', 'credenciales', 'boveda_invitados',
                           'correos', 'referidos', 'codigos_usos', 'entregas', 'reportes', 'comprobaciones'] loop
    execute format('drop trigger if exists avisar_push_evento on public.%I', t);
    execute format('create trigger avisar_push_evento after %s on public.%I for each row execute function public._avisar_evento()',
      case t
        when 'productos' then 'insert or update or delete'
        when 'credenciales' then 'insert or update or delete'
        when 'boveda_invitados' then 'insert or delete'
        when 'servicios_cliente' then 'insert or update'
        when 'entregas' then 'update'
        when 'reportes' then 'update'
        else 'insert' end, t);
  end loop;
end $$;
