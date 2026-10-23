-- =====================================================================
--  Velority · Permisos por sección para las personas invitadas por el cliente
-- =====================================================================
-- Amplía supabase_boveda_invitados.sql: al crear un usuario en «Mi cuenta», el titular marca qué secciones puede ver:
--   chat        → Chat, Demo y Soporte
--   web         → Mi web y SEO
--   servicios   → Servicios y Mis pedidos (y descargar entregas)
--   facturacion → Facturación y pagos
--   accesos     → Bóveda de accesos
-- Sus datos, su contraseña, los usuarios invitados, los referidos y la baja del plan siguen siendo solo del titular.
-- Ejecútalo en Supabase > SQL Editor después de supabase_boveda_invitados.sql (se puede repetir).

alter table public.boveda_invitados add column if not exists permisos text[] not null default '{accesos}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'boveda_invitados_permisos_check') then
    alter table public.boveda_invitados add constraint boveda_invitados_permisos_check
      check (permisos <@ array['chat','web','servicios','facturacion','accesos'] and cardinality(permisos) > 0);
  end if;
end $$;

-- Cliente de una sesión: el titular puede todo; la persona invitada, solo si tiene alguno de los permisos («chat,servicios»)
create or replace function public._acceso(p_token text, p_permisos text)
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select coalesce(public._cliente_de_token(p_token),
    (select i.cliente_id from sesiones_invitado s join boveda_invitados i on i.id = s.invitado_id
      where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and s.expira_en > now()
        and i.permisos && string_to_array(p_permisos, ',')));
$$;
create or replace function public.servidor_acceso(p_token text, p_permisos text)
returns uuid language sql stable security definer set search_path = public, extensions as $$ select public._acceso(p_token, p_permisos); $$;

create or replace function public.servidor_invitado_de_token(p_token text)
returns json language sql stable security definer set search_path = public, extensions as $$
  select json_build_object('cliente_id', i.cliente_id, 'nombre', i.nombre, 'permisos', i.permisos)
    from sesiones_invitado s join boveda_invitados i on i.id = s.invitado_id
   where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and s.expira_en > now();
$$;

create or replace function public.servidor_caso_del_cliente(p_token text, p_caso bigint)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from reportes where id = p_caso and eliminado_en is null and cliente_id = _acceso(p_token, 'chat,servicios'));
$$;

-- Las acciones del portal aceptan a la persona invitada si tiene el permiso de esa sección
do $$
declare f record; d text; rep text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and p.proname in (
              'cliente_enviar_mensaje','cliente_marcar_leido','cliente_crear_caso','cliente_demo','cliente_opinar','cliente_pedir_demo',
              'cliente_valorar','cliente_pagar_tokens','cliente_aceptar_condiciones','cliente_baja_servicio','cliente_fase','cliente_pedir_presupuesto')
  loop
    rep := case
      when f.proname in ('cliente_enviar_mensaje','cliente_marcar_leido') then '_acceso(p_token, ''chat,servicios'')'
      when f.proname in ('cliente_crear_caso','cliente_demo','cliente_opinar','cliente_pedir_demo','cliente_valorar') then '_acceso(p_token, ''chat'')'
      when f.proname = 'cliente_pagar_tokens' then '_acceso(p_token, ''facturacion'')'
      else '_acceso(p_token, ''servicios,facturacion'')' end;
    d := pg_get_functiondef(f.oid);
    if position('_cliente_de_token(p_token)' in d) > 0 then execute replace(d, '_cliente_de_token(p_token)', rep); end if;
  end loop;
end $$;

create or replace function public._permisos_validos(p text[])
returns text[] language plpgsql immutable as $$
declare r text[] := array(select distinct x from unnest(coalesce(p, '{}')) x where x = any(array['chat','web','servicios','facturacion','accesos']));
begin
  if cardinality(r) = 0 then raise exception 'Marca al menos una sección a la que pueda entrar.'; end if;
  return r;
end $$;

create or replace function public.cliente_invitados(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token);
begin
  if cid is null then raise exception 'Tu sesión ha caducado. Vuelve a entrar.'; end if;
  return coalesce((select json_agg(json_build_object('id', id, 'nombre', nombre, 'email', email, 'permisos', permisos, 'creado_en', creado_en, 'ultimo_acceso', ultimo_acceso) order by creado_en)
                   from boveda_invitados where cliente_id = cid), '[]'::json);
end $$;

create or replace function public.cliente_crear_invitado(p_token text, p_nombre text, p_email text, p_clave text, p_permisos text[])
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); e text := lower(trim(coalesce(p_email, ''))); n text := trim(coalesce(p_nombre, '')); per text[] := _permisos_validos(p_permisos);
begin
  if cid is null then raise exception 'Tu sesión ha caducado. Vuelve a entrar.'; end if;
  if n = '' or length(n) > 80 then raise exception 'Escribe el nombre de la persona.'; end if;
  if e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Escribe un correo válido.'; end if;
  if length(coalesce(p_clave, '')) < 10 then raise exception 'La contraseña debe tener al menos 10 caracteres.'; end if;
  if exists (select 1 from clientes where email = e) or exists (select 1 from boveda_invitados where email = e) then
    raise exception 'Ese correo ya tiene una cuenta. Usa otro.';
  end if;
  if (select count(*) from boveda_invitados where cliente_id = cid) >= 10 then raise exception 'Puedes invitar como máximo a 10 personas.'; end if;
  insert into boveda_invitados (cliente_id, nombre, email, clave_hash, permisos) values (cid, n, e, crypt(p_clave, gen_salt('bf')), per);
  return cliente_invitados(p_token);
end $$;

create or replace function public.cliente_permisos_invitado(p_token text, p_id bigint, p_permisos text[])
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); per text[] := _permisos_validos(p_permisos);
begin
  if cid is null then raise exception 'Tu sesión ha caducado. Vuelve a entrar.'; end if;
  update boveda_invitados set permisos = per where id = p_id and cliente_id = cid;
  return cliente_invitados(p_token);
end $$;

-- Datos del portal: el titular recibe todo; la persona invitada, solo lo de sus secciones
create or replace function public.cliente_datos(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token_lectura(p_token); c clientes; lectura boolean; inv record; es_inv boolean := false; j jsonb; p text[];
begin
  if cid is null then
    -- Persona invitada: solo recibe lo de sus permisos
    select i.cliente_id, i.nombre, i.permisos into inv from sesiones_invitado s join boveda_invitados i on i.id = s.invitado_id
     where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and s.expira_en > now();
    cid := inv.cliente_id; es_inv := cid is not null;
  end if;
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  select * into c from clientes where id = cid;
  select solo_lectura into lectura from sesiones_cliente where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  j := jsonb_build_object(
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
  if not es_inv then return j::json; end if;

  p := inv.permisos;
  j := j || jsonb_build_object('invitado', jsonb_build_object('nombre', inv.nombre, 'permisos', to_jsonb(p),
                                 'web_pagada', exists (select 1 from servicios_cliente where cliente_id = cid and tipo = 'web' and pagado_en is not null)),
                               'cliente', jsonb_build_object('id', c.id, 'nombre', c.nombre, 'dominio', c.dominio),
                               'referidos', jsonb_build_object('invitados', 0, 'ganados', 0));
  if not ('chat' = any(p)) then
    if 'servicios' = any(p) then   -- solo las conversaciones de sus pedidos
      j := jsonb_set(j, '{casos}', coalesce((select jsonb_agg(x) from jsonb_array_elements(j->'casos') x
             where (x->>'id')::bigint in (select caso_id from servicios_cliente where cliente_id = cid and caso_id is not null
                                           union select caso_baja_id from servicios_cliente where cliente_id = cid and caso_baja_id is not null)), '[]'::jsonb));
      j := jsonb_set(j, '{mensajes}', coalesce((select jsonb_agg(m) from jsonb_array_elements(j->'mensajes') m
             where (m->>'caso_id')::bigint in (select (x->>'id')::bigint from jsonb_array_elements(j->'casos') x)), '[]'::jsonb));
    else
      j := j || jsonb_build_object('casos', '[]'::jsonb, 'mensajes', '[]'::jsonb);
    end if;
    j := j || jsonb_build_object('valoraciones', '[]'::jsonb);
  end if;
  if not ('servicios' = any(p) or 'facturacion' = any(p)) then j := j || jsonb_build_object('servicios', '[]'::jsonb, 'entregas', '[]'::jsonb);
  elsif not ('servicios' = any(p)) then j := j || jsonb_build_object('entregas', '[]'::jsonb); end if;
  if not ('web' = any(p)) then
    j := j || jsonb_build_object('historial', '[]'::jsonb, 'renovaciones', '[]'::jsonb,
      'web', case when 'facturacion' = any(p) and j->'web' <> 'null'::jsonb
                  then jsonb_build_object('facturas', j->'web'->'facturas', 'metodo_pago', j->'web'->'metodo_pago') else 'null'::jsonb end);
  elsif not ('facturacion' = any(p)) and j->'web' <> 'null'::jsonb then
    j := jsonb_set(j, '{web}', (j->'web') - 'facturas' - 'metodo_pago');
  end if;
  return j::json;
end $$;

revoke all on function public._acceso(text, text), public.servidor_acceso(text, text), public._permisos_validos(text[]),
  public.cliente_crear_invitado(text, text, text, text, text[]), public.cliente_permisos_invitado(text, bigint, text[]) from public, anon, authenticated;
revoke execute on function public.cliente_crear_invitado(text, text, text, text) from anon, authenticated;   -- versión antigua, sin permisos
grant execute on function public.cliente_crear_invitado(text, text, text, text, text[]), public.cliente_permisos_invitado(text, bigint, text[]) to anon, authenticated;
grant execute on function public.servidor_acceso(text, text) to service_role;
