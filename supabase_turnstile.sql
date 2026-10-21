-- =====================================================================
--  Velority · Registro protegido con Turnstile (Cloudflare)
-- =====================================================================
-- El portal ya no crea cuentas llamando a la base de datos directamente: pasa por la función «registro»,
-- que comprueba Turnstile y después llama a servidor_registrar (solo la puede usar el servidor).
-- Ejecútalo en Supabase > SQL Editor. Se puede ejecutar varias veces.

create or replace function public.servidor_registrar(p_ip text, p_email text, p_clave text, p_nombre text, p_dominio text,
                                                     p_plan text, p_acepta boolean, p_trampa text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  e   text := lower(trim(coalesce(p_email, '')));
  n   text := left(trim(coalesce(p_nombre, '')), 100);
  d   text := nullif(left(trim(coalesce(p_dominio, '')), 200), '');
  pl  text := nullif(left(trim(coalesce(p_plan, '')), 100), '');
  ip  text := left(coalesce(p_ip, ''), 80);
  cid uuid;
begin
  if coalesce(p_trampa, '') <> '' then
    raise exception 'No se pudo crear la cuenta.';
  end if;
  if _excedido('registro-ip:' || ip, 3, interval '1 hour') or _excedido('registro-ip:' || ip, 10, interval '1 day')
     or _excedido('registro-total', 60, interval '1 hour') then
    raise exception 'Se han creado demasiadas cuentas en poco tiempo. Inténtalo de nuevo más tarde.';
  end if;
  if e !~ '^\S+@\S+\.\S+$' or length(e) > 200 then raise exception 'Escribe un correo válido.'; end if;
  if n = '' then raise exception 'Escribe tu nombre.'; end if;
  if length(coalesce(p_clave, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres.'; end if;
  if p_acepta is not true then raise exception 'Para crear tu cuenta tienes que aceptar la política de privacidad.'; end if;
  if exists (select 1 from clientes where email = e) then raise exception 'Ya existe una cuenta con ese correo. Inicia sesión.'; end if;
  insert into clientes (email, nombre, dominio, clave_hash, acepta_privacidad_en)
    values (e, n, d, crypt(p_clave, gen_salt('bf')), now())
    returning id into cid;
  if pl is not null then
    insert into reportes (tipo_reporte, titulo, descripcion, usuario_discord, email, dominio, plan, estado, cliente_id)
    values ('Lead', 'Nuevo cliente · ' || pl,
            'Se ha registrado desde el portal del cliente y ha elegido ' || pl || '.' || coalesce(' Web: ' || d, ''),
            n, e, d, pl, 'Entrada de leads', cid);
  end if;
  perform _anotar('registro-ip:' || ip);
  perform _anotar('registro-total');
  return _cliente_sesion(cid);
end
$$;
revoke all on function public.servidor_registrar(text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.servidor_registrar(text, text, text, text, text, text, boolean, text) to service_role;

-- Cierra el registro directo desde el navegador (también la versión antigua, sin límites ni casilla de privacidad)
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'cliente_registrar' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end
$$;
