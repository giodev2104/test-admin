-- =====================================================================
--  Webcare · BORRAR TODO
-- =====================================================================
-- Borra TODAS las tablas, vistas y funciones del esquema "public":
-- casos, mensajes, notas, historial, clientes del portal y lista del staff.
-- NO SE PUEDE DESHACER. Después ejecuta supabase_completo.sql.
--
-- Las cuentas de Authentication > Users (las del equipo) NO se borran:
-- así puedes volver a darte acceso solo con el INSERT del final de
-- supabase_completo.sql. Si también quieres borrarlas, quita los "--"
-- de la última línea.
-- =====================================================================

do $$
declare r record;
begin
  -- quitar las tablas de la publicación de tiempo real
  for r in select tablename from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public' loop
    execute format('alter publication supabase_realtime drop table public.%I', r.tablename);
  end loop;

  -- vistas
  for r in select table_name from information_schema.views where table_schema = 'public' loop
    execute format('drop view if exists public.%I cascade', r.table_name);
  end loop;

  -- tablas (cascade se lleva triggers, políticas y claves)
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;

  -- funciones (las de extensiones como pgcrypto no están en public)
  for r in select p.oid::regprocedure as firma
           from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('drop function if exists %s cascade', r.firma);
  end loop;
end $$;

-- Comprobación: debe salir vacío
select tablename from pg_tables where schemaname = 'public';

-- OPCIONAL: borrar también todas las cuentas de Authentication > Users
-- delete from auth.users;
