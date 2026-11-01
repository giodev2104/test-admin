-- ============================================================================
-- Seguridad y rendimiento (revisión del 1/11/2026). Reejecutable.
-- Ya está aplicado en Supabase; se guarda aquí para tenerlo documentado.
-- ============================================================================

-- 1) El dominio que escribe el cliente en su perfil se comprueba: solo un dominio normal (minegocio.es),
--    nada de IPs, puertos ni HTML. Lo usan las funciones de medición y de enlaces rotos.
create or replace function public.cliente_actualizar_perfil(p_token text, p_nombre text, p_telefono text, p_dominio text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare cid uuid := _cliente_de_token(p_token); c clientes; dom text;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  if length(trim(coalesce(p_nombre, ''))) = 0 then raise exception 'Escribe tu nombre.'; end if;
  dom := nullif(lower(regexp_replace(regexp_replace(trim(coalesce(p_dominio, '')), '^https?://', '', 'i'), '[/?#].*$', '')), '');
  dom := regexp_replace(dom, '\.$', '');
  if dom is not null and (length(dom) > 253
      or dom !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
      or dom ~ '(^|\.)(localhost|local|internal|intranet|lan|home|arpa|test|invalid|example)$') then
    raise exception 'Escribe solo el dominio de tu web, por ejemplo: minegocio.es';
  end if;
  update clientes set
    nombre   = left(trim(p_nombre), 100),
    telefono = nullif(left(trim(coalesce(p_telefono, '')), 30), ''),
    dominio  = dom
  where id = cid returning * into c;
  return json_build_object('id', c.id, 'email', c.email, 'nombre', c.nombre, 'dominio', c.dominio, 'telefono', c.telefono);
end
$function$;

-- 2) Índices para las claves ajenas que no tenían
create index if not exists codigos_usos_cliente_idx on public.codigos_usos (cliente_id);
create index if not exists entregas_servicio_idx on public.entregas (servicio_id);
create index if not exists pagos_caso_idx on public.pagos (caso_id);
create index if not exists pagos_servicio_idx on public.pagos (servicio_id);
create index if not exists pagos_tokens_caso_idx on public.pagos_tokens (caso_id);
create index if not exists pagos_tokens_servicio_idx on public.pagos_tokens (servicio_id);
create index if not exists push_suscripciones_usuario_idx on public.push_suscripciones (usuario);
create index if not exists recuperaciones_cliente_idx on public.recuperaciones (cliente_id);
create index if not exists reportes_responsable_idx on public.reportes (responsable_usuario);
create index if not exists servicios_cliente_caso_baja_idx on public.servicios_cliente (caso_baja_id);
create index if not exists servicios_cliente_codigo_idx on public.servicios_cliente (codigo_id);
create index if not exists sesiones_invitado_invitado_idx on public.sesiones_invitado (invitado_id);

-- 3) Misma regla de antes (solo propietarios editan el catálogo), con el correo de la sesión leído una vez por consulta
alter policy dueno_edita_catalogo on public.catalogo
  using (exists (select 1 from public.staff where lower(staff.email) = lower(coalesce((select auth.jwt() ->> 'email'), '')) and staff.es_dueno))
  with check (exists (select 1 from public.staff where lower(staff.email) = lower(coalesce((select auth.jwt() ->> 'email'), '')) and staff.es_dueno));
