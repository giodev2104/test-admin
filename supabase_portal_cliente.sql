-- =====================================================================
--  Portal del cliente (test-cliente)  <->  Panel del equipo (test-admin)
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de supabase.sql y del resto
-- de migraciones. Se puede ejecutar varias veces sin romper nada.
--
-- Qué hace:
--   * Vincula cada caso (reportes) con la cuenta del cliente que lo creó.
--   * Deja que un cliente con sesión iniciada:
--       - cree sus propios casos (lead al registrarse, y solicitudes de soporte),
--       - vea solo SUS casos (nunca los de otros ni las notas internas),
--       - lea y escriba en el chat (mensajes_caso) de SUS casos.
--   * Las políticas del staff ya existentes no se tocan: las de aquí se suman.
--
-- Importante: la tabla "reportes" y "mensajes_caso" deben tener RLS activado
-- (supabase.sql ya lo hace). Compruébalo con la consulta del final.
-- En Authentication > Providers > Email, deja activado "Allow new users to sign up".
-- =====================================================================

-- 1) Columna que une el caso con la cuenta del cliente
alter table public.reportes
  add column if not exists cliente_id uuid references auth.users(id) on delete set null;
create index if not exists reportes_cliente_id_idx on public.reportes (cliente_id);

-- 2) ¿Este caso es del cliente que hace la petición? (security definer evita recursión de RLS)
create or replace function public.caso_es_mio(caso bigint)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.reportes
    where id = caso and cliente_id = auth.uid() and eliminado_en is null
  );
$$;
revoke all on function public.caso_es_mio(bigint) from public;
grant execute on function public.caso_es_mio(bigint) to authenticated;

-- 3) Casos: el cliente ve y crea solo los suyos
grant select, insert on public.reportes to authenticated;

drop policy if exists "cliente_ve_sus_casos" on public.reportes;
create policy "cliente_ve_sus_casos" on public.reportes
  for select to authenticated
  using (cliente_id = auth.uid() and eliminado_en is null);

drop policy if exists "cliente_crea_sus_casos" on public.reportes;
create policy "cliente_crea_sus_casos" on public.reportes
  for insert to authenticated
  with check (
    cliente_id = auth.uid()
    and estado = 'Entrada de leads'
    and tipo_reporte in ('Lead', 'Cambio', 'Incidencia', 'Duda')
    and responsable_usuario is null
    and eliminado_en is null
  );
-- (No hay política de UPDATE/DELETE para clientes: solo el staff mueve o borra casos.)

-- 4) Chat: el cliente lee y escribe en el chat de sus casos, siempre como "usuario"
grant select, insert on public.mensajes_caso to authenticated;

drop policy if exists "cliente_lee_su_chat" on public.mensajes_caso;
create policy "cliente_lee_su_chat" on public.mensajes_caso
  for select to authenticated
  using (public.caso_es_mio(caso_id));

drop policy if exists "cliente_escribe_su_chat" on public.mensajes_caso;
create policy "cliente_escribe_su_chat" on public.mensajes_caso
  for insert to authenticated
  with check (autor_tipo = 'usuario' and autor is null and public.caso_es_mio(caso_id));

-- notas_caso y actividad_caso NO reciben políticas para clientes: son internas del equipo.

-- 5) Tiempo real (el panel ya lo usa; esto solo lo asegura)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reportes') then
    alter publication supabase_realtime add table public.reportes;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensajes_caso') then
    alter publication supabase_realtime add table public.mensajes_caso;
  end if;
end $$;

-- 6) Comprobación: las dos filas deben salir con rowsecurity = true.
--    Si sale false, CUALQUIER cliente podría ver todos los casos: activa RLS antes de publicar el portal.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('reportes', 'mensajes_caso');
