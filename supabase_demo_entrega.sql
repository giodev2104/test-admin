-- =====================================================================
--  Velority · Apartado «Demo» del portal: el equipo entrega la demo gratuita y el cliente la aprueba o pide cambios
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de supabase_demo.sql y supabase_fases_pago.sql. Se puede ejecutar varias veces.
--
-- Flujo:
--   1. El cliente pide su demo gratuita (caso «Demo gratuita»).
--   2. El equipo, desde el caso, envía la demo (enlace y/o imágenes por el chat) y el precio cerrado.
--   3. El cliente la ve en «Demo» y pulsa «Quiero cambios» (mensaje al chat) o «Me gusta, quiero mi web»:
--      se crea su pedido de web con ese precio y pasa a pagar el 50 % de anticipo (proyecto por fases).
-- =====================================================================

alter table public.reportes add column if not exists demo_url text check (demo_url is null or demo_url ~ '^https?://');
alter table public.reportes add column if not exists demo_importe numeric(10,2) check (demo_importe is null or demo_importe > 0);
alter table public.reportes add column if not exists demo_nota text check (demo_nota is null or length(demo_nota) <= 1500);
alter table public.reportes add column if not exists demo_enviada_en timestamptz;
alter table public.reportes add column if not exists demo_aceptada_en timestamptz;

-- Acciones del cliente sobre su demo: pedir cambios o aceptarla (crea el pedido de web con el precio cerrado)
create or replace function public.cliente_demo(p_token text, p_caso bigint, p_accion text, p_texto text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); r reportes; s servicios_cliente; txt text := left(trim(coalesce(p_texto, '')), 1500);
  v_precio text;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  select * into r from reportes where id = p_caso and cliente_id = cid and eliminado_en is null for update;
  if r.id is null then raise exception 'Caso no encontrado.'; end if;
  if r.demo_enviada_en is null then raise exception 'Tu demo todavía no está lista. Te avisaremos por el chat.'; end if;
  if p_accion = 'cambios' then
    if length(txt) < 5 then raise exception 'Cuéntanos qué cambiarías.'; end if;
    insert into mensajes_caso (caso_id, autor_tipo, texto)
      values (r.id, 'usuario', '✏️ Cambios que me gustaría en la demo:' || chr(10) || txt);
    return json_build_object('ok', true);
  elsif p_accion = 'aceptar' then
    if r.demo_importe is null then raise exception 'Estamos preparando tu precio cerrado: te lo enviamos por el chat.'; end if;
    v_precio := regexp_replace(replace(to_char(r.demo_importe, 'FM999990.00'), '.', ','), ',00$', '') || ' € (precio cerrado)';
    select * into s from servicios_cliente where caso_id = r.id and cliente_id = cid and tipo = 'web' and estado <> 'rechazado'
      order by id desc limit 1;
    if s.id is null then
      insert into servicios_cliente (cliente_id, tipo, nombre, precio, estado, caso_id, importe)
        values (cid, 'web', 'Creación de tu web', v_precio, 'pendiente', r.id, r.demo_importe) returning * into s;
    elsif s.anticipo_en is null and s.importe is distinct from r.demo_importe then
      update servicios_cliente set importe = r.demo_importe, precio = v_precio where id = s.id returning * into s;
    end if;
    if r.demo_aceptada_en is null then
      update reportes set demo_aceptada_en = now() where id = r.id;
      insert into mensajes_caso (caso_id, autor_tipo, texto)
        values (r.id, 'usuario', '✅ ¡Me gusta la demo! Quiero mi web. Paso a pagar el anticipo del 50 %.');
    end if;
    return to_json(s);
  else
    raise exception 'Acción no válida.';
  end if;
end
$$;
revoke all on function public.cliente_demo(text, bigint, text, text) from public;
grant execute on function public.cliente_demo(text, bigint, text, text) to anon, authenticated;

-- El portal recibe también los datos de la demo de cada caso
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
        select id, tipo_reporte, titulo, estado, plan, plan_solicitado, dominio, urgencia, created_at, resuelto_en, origen,
               demo_url, demo_importe, demo_nota, demo_enviada_en, demo_aceptada_en
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
