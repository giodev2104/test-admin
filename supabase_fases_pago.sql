-- =====================================================================
--  Velority · Proyectos web en fases: 50 % de anticipo, demo con 2 revisiones, 50 % final y garantía
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de supabase_ofertas_tokens.sql. Se puede ejecutar varias veces.
--
-- Flujo de un plan de web (pedido de tipo «web»):
--   1. El equipo fija el precio cerrado (importe).            → el cliente paga el 50 % de anticipo
--   2. Anticipo cobrado (anticipo_en).                         → empieza el diseño y desarrollo
--   3. El equipo comparte la demo (demo_url).                  → el cliente pide cambios (máx. 2 rondas) o aprueba
--   4. Diseño aprobado (aprobado_en).                          → el cliente paga el 50 % restante
--   5. Pago final (pagado_en, como siempre).                   → se desbloquean los archivos de la entrega
--   6. Publicada (publicado_en).                               → empiezan los 30 días de garantía
-- =====================================================================

alter table public.servicios_cliente add column if not exists importe numeric(10,2) check (importe is null or importe > 0);
alter table public.servicios_cliente add column if not exists anticipo_en timestamptz;
alter table public.servicios_cliente add column if not exists anticipo_por text;
alter table public.servicios_cliente add column if not exists demo_url text check (demo_url is null or demo_url ~ '^https?://');
alter table public.servicios_cliente add column if not exists revisiones_usadas int not null default 0 check (revisiones_usadas between 0 and 20);
alter table public.servicios_cliente add column if not exists aprobado_en timestamptz;
alter table public.servicios_cliente add column if not exists publicado_en timestamptz;
alter table public.pagos add column if not exists parte text;

-- Acciones del cliente sobre su proyecto: pedir una ronda de cambios o aprobar el diseño final
create or replace function public.cliente_fase(p_token text, p_servicio bigint, p_accion text, p_texto text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); s servicios_cliente; txt text := left(trim(coalesce(p_texto, '')), 1500);
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  select * into s from servicios_cliente where id = p_servicio and cliente_id = cid for update;
  if s.id is null then raise exception 'Pedido no encontrado.'; end if;
  if s.anticipo_en is null or s.demo_url is null then raise exception 'Todavía no hay una demo para revisar.'; end if;
  if s.aprobado_en is not null then raise exception 'Ya aprobaste el diseño final.'; end if;
  if p_accion = 'revision' then
    if s.revisiones_usadas >= 2 then
      raise exception 'Ya has usado las 2 rondas de revisión incluidas. Escríbenos por el chat y te presupuestamos los cambios extra.';
    end if;
    if length(txt) < 5 then raise exception 'Cuéntanos qué cambios quieres.'; end if;
    update servicios_cliente set revisiones_usadas = revisiones_usadas + 1 where id = s.id returning * into s;
    if s.caso_id is not null then
      insert into mensajes_caso (caso_id, autor_tipo, texto)
        values (s.caso_id, 'usuario', '✏️ Ronda de revisión ' || s.revisiones_usadas || ' de 2:' || chr(10) || txt);
    end if;
  elsif p_accion = 'aprobar' then
    update servicios_cliente set aprobado_en = now() where id = s.id returning * into s;
    if s.caso_id is not null then
      insert into mensajes_caso (caso_id, autor_tipo, texto)
        values (s.caso_id, 'usuario', '✅ Apruebo el diseño final de «' || s.nombre || '». Paso al pago del 50 % restante.');
    end if;
  else
    raise exception 'Acción no válida.';
  end if;
  return to_json(s);
end
$$;
revoke all on function public.cliente_fase(text, bigint, text, text) from public;
grant execute on function public.cliente_fase(text, bigint, text, text) to anon, authenticated;

-- Solo para la función «pago»: registra el anticipo o el pago final de un proyecto (una vez por sesión de Stripe)
create or replace function public.servidor_registrar_fase(p_sesion text, p_cliente uuid, p_servicio bigint, p_parte text, p_importe numeric)
returns json language plpgsql security definer set search_path = public as $$
declare ya pagos; s servicios_cliente; imp text := replace(to_char(p_importe, 'FM999990.00'), '.', ',') || ' €';
begin
  select * into ya from pagos where sesion = p_sesion;
  if ya.sesion is not null then return json_build_object('repetido', true, 'servicio_id', ya.servicio_id, 'caso_id', ya.caso_id); end if;
  if p_parte = 'anticipo' then
    update servicios_cliente set anticipo_en = coalesce(anticipo_en, now()), anticipo_por = coalesce(anticipo_por, 'Stripe')
      where id = p_servicio and cliente_id = p_cliente returning * into s;
  elsif p_parte = 'final' then
    update servicios_cliente set pagado_en = coalesce(pagado_en, now()), pagado_por = coalesce(pagado_por, 'Stripe')
      where id = p_servicio and cliente_id = p_cliente returning * into s;
  else
    raise exception 'Parte de pago no válida.';
  end if;
  if s.id is null then raise exception 'Pedido no encontrado.'; end if;
  if s.caso_id is not null then
    insert into mensajes_caso (caso_id, autor_tipo, autor, texto) values (s.caso_id, 'staff', 'sistema',
      case when p_parte = 'anticipo'
        then '💶 Anticipo del 50 % recibido (' || imp || '). ¡Empezamos con el diseño y desarrollo de tu web!'
        else '💶 Pago final recibido (' || imp || '). ¡Gracias! Te entregamos todos los archivos y publicamos tu web.' end);
  end if;
  insert into pagos (sesion, cliente_id, tipo, nombre, importe, modo, servicio_id, caso_id, parte)
    values (p_sesion, p_cliente, s.tipo, s.nombre, p_importe, 'payment', s.id, s.caso_id, p_parte);
  return json_build_object('servicio_id', s.id, 'caso_id', s.caso_id, 'parte', p_parte);
end
$$;
revoke all on function public.servidor_registrar_fase(text, uuid, bigint, text, numeric) from public, anon, authenticated;

-- El portal recibe también las fases de cada pedido
create or replace function public.cliente_datos(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token_lectura(p_token); c clientes; lectura boolean;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  select * into c from clientes where id = cid;
  select solo_lectura into lectura from sesiones_cliente where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return json_build_object(
    'cliente', json_build_object('id', c.id, 'email', c.email, 'nombre', c.nombre, 'dominio', c.dominio,
                                 'telefono', c.telefono, 'canal', c.canal, 'codigo_ref', c.codigo_ref),
    'solo_lectura', coalesce(lectura, false),
    'web', (select to_json(w) from webs_cliente w where w.cliente_id = cid),
    'historial', coalesce((select json_agg(json_build_object('mes', h.mes, 'datos', h.datos) order by h.mes desc)
                           from (select * from webs_cliente_historial where cliente_id = cid order by mes desc limit 12) h), '[]'::json),
    'casos', coalesce((select json_agg(x order by x.created_at desc) from (
        select id, tipo_reporte, titulo, estado, plan, plan_solicitado, dominio, urgencia, created_at, resuelto_en, origen
        from reportes where cliente_id = cid and eliminado_en is null) x), '[]'::json),
    'mensajes', coalesce((select json_agg(x order by x.creado_en) from (
        select m.id, m.caso_id, m.autor_tipo, m.autor, m.texto, m.creado_en,
               m.adjunto_ruta, m.adjunto_nombre, m.adjunto_tipo, m.adjunto_tamano, m.leido_cliente_en, m.leido_staff_en
        from mensajes_caso m join reportes r on r.id = m.caso_id
        where r.cliente_id = cid and r.eliminado_en is null) x), '[]'::json),
    'valoraciones', coalesce((select json_agg(json_build_object('caso_id', v.caso_id, 'estrellas', v.estrellas))
                              from valoraciones v where v.cliente_id = cid), '[]'::json),
    'renovaciones', coalesce((select json_agg(json_build_object('concepto', x.concepto, 'fecha', x.fecha, 'tipo', x.tipo) order by x.fecha)
                              from renovaciones x where x.cliente_id = cid and x.hecho_en is null
                                and x.fecha >= current_date - 30 and x.fecha <= current_date + 365), '[]'::json),
    'servicios', coalesce((select json_agg(json_build_object('id', s.id, 'tipo', s.tipo, 'nombre', s.nombre, 'precio', s.precio,
                                  'estado', s.estado, 'caso_id', s.caso_id, 'caso_baja_id', s.caso_baja_id, 'nota', s.nota,
                                  'creado_en', s.creado_en, 'activado_en', s.activado_en, 'baja_en', s.baja_en, 'pagado_en', s.pagado_en,
                                  'importe', s.importe, 'anticipo_en', s.anticipo_en, 'demo_url', s.demo_url,
                                  'revisiones_usadas', s.revisiones_usadas, 'aprobado_en', s.aprobado_en, 'publicado_en', s.publicado_en)
                                  order by s.creado_en desc)
                           from servicios_cliente s where s.cliente_id = cid and s.estado <> 'rechazado'), '[]'::json),
    'entregas', coalesce((select json_agg(json_build_object('id', e.id, 'servicio_id', e.servicio_id, 'nombre', e.nombre, 'tipo', e.tipo,
                                  'tamano', e.tamano, 'nota', e.nota, 'creado_en', e.creado_en, 'descargado_en', e.descargado_en) order by e.creado_en desc)
                          from entregas e where e.cliente_id = cid), '[]'::json),
    'referidos', json_build_object('invitados', (select count(*) from referidos where referidor_id = cid),
                                   'ganados', (select count(*) from referidos where referidor_id = cid and ganado_en is not null)));
end
$$;
