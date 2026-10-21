-- =====================================================================
--  Velority · Borrar un cliente por completo (solo propietarios)
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de supabase_pagos.sql.
-- No borra datos por sí solo y se puede ejecutar varias veces.
--
-- Desde el panel (ficha del cliente > «Borrar cliente») un propietario puede eliminar a un cliente
-- escribiendo su correo para confirmar. Se borran su cuenta del portal, sus sesiones, la ficha de su
-- web, el historial, sus casos con mensajes y notas, servicios, entregas, pagos registrados,
-- valoraciones, renovaciones y la bóveda. Los archivos (adjuntos y entregas) los quita el panel
-- con la lista que devuelve la función. No se puede deshacer.
-- =====================================================================

-- El equipo puede quitar adjuntos del chat (para limpiar los archivos de un cliente borrado)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'staff_quita_adjuntos') then
    create policy "staff_quita_adjuntos" on storage.objects for delete to authenticated
      using (bucket_id = 'adjuntos' and public.es_staff());
  end if;
end
$$;

create or replace function public.staff_borrar_cliente(p_cliente uuid, p_confirmar text)
returns json language plpgsql security definer set search_path = public as $$
declare c clientes; archivos json; n int;
begin
  if not exists (select 1 from staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and es_dueno) then
    raise exception 'Solo los propietarios pueden borrar clientes.';
  end if;
  select * into c from clientes where id = p_cliente;
  if c.id is null then raise exception 'Ese cliente ya no existe.'; end if;
  if lower(trim(coalesce(p_confirmar, ''))) <> lower(c.email) then
    raise exception 'Para confirmar, escribe exactamente el correo del cliente.';
  end if;
  select coalesce(json_agg(x), '[]'::json) into archivos from (
    select 'entregas' as bucket, ruta from entregas where cliente_id = p_cliente
    union all
    select 'adjuntos', m.adjunto_ruta from mensajes_caso m join reportes r on r.id = m.caso_id
      where r.cliente_id = p_cliente and m.adjunto_ruta is not null) x;
  delete from reportes where cliente_id = p_cliente;
  get diagnostics n = row_count;
  delete from clientes where id = p_cliente;
  return json_build_object('nombre', c.nombre, 'casos', n, 'archivos', archivos);
end
$$;
revoke all on function public.staff_borrar_cliente(uuid, text) from public, anon;
grant execute on function public.staff_borrar_cliente(uuid, text) to authenticated;

select 'Borrado de clientes listo' as resultado;
