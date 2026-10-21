-- =====================================================================
--  Velority · Borrar las valoraciones de prueba (no pertenecen a ningún cliente real)
-- =====================================================================
-- Ejecútalo una vez en Supabase > SQL Editor. Solo borra valoraciones cuyo cliente no existe.
delete from public.valoraciones v
where v.cliente_id is null or not exists (select 1 from public.clientes c where c.id = v.cliente_id);
