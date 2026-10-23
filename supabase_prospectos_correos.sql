-- =====================================================================
--  Velority · Correo de los clientes potenciales, buscado automáticamente
-- =====================================================================
-- Google Maps no da el correo de los negocios. La función «prospectos» (accion "correos") lo busca con la API de
-- Brave Search: busca el negocio por nombre, ciudad y teléfono, y saca el correo de los resultados (por ejemplo el
-- fragmento de su página de Facebook o de un directorio). Se apunta de dónde salió.
-- Ejecútalo en Supabase > SQL Editor después de supabase_prospectos.sql (se puede repetir).

alter table public.prospectos add column if not exists correo_buscado_en timestamptz;   -- ya se buscó (con o sin éxito)
alter table public.prospectos add column if not exists correo_fuente text;              -- página donde apareció el correo

-- Contador mensual genérico (ajustes_web) que se niega a pasar del máximo: lo usa la búsqueda de correos con Brave
create or replace function public.servidor_gastar_cupo(p_clave text, p_max int)
returns int language plpgsql security definer set search_path = public as $$
declare mes text := to_char(now() at time zone 'UTC', 'YYYY-MM'); usados int;
begin
  insert into ajustes_web (clave, valor, actualizado_por) values (p_clave, jsonb_build_object('mes', mes, 'peticiones', 0), 'sistema')
  on conflict (clave) do nothing;
  select case when valor->>'mes' = mes then coalesce((valor->>'peticiones')::int, 0) else 0 end into usados
    from ajustes_web where clave = p_clave for update;
  if usados >= p_max then return -1; end if;
  update ajustes_web set valor = jsonb_build_object('mes', mes, 'peticiones', usados + 1), actualizado_en = now() where clave = p_clave;
  return usados + 1;
end $$;
revoke all on function public.servidor_gastar_cupo(text, int) from public, anon, authenticated;
grant execute on function public.servidor_gastar_cupo(text, int) to service_role;
