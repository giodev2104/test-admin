-- =====================================================================
--  Velority · Tema de temporada (Halloween…) que se cambia desde el panel
-- =====================================================================
-- El panel guarda en «ajustes_web» (clave «tema») qué tema se ve en velority.es, entre qué fechas, el texto de la
-- franja superior y si también se aplica al panel. La portada lo lee con tema_publico() (sin datos privados).
-- Solo los propietarios del panel pueden cambiarlo. Ejecútalo en Supabase > SQL Editor. Se puede ejecutar varias veces.

create table if not exists public.ajustes_web (
  clave           text primary key check (clave ~ '^[a-z_]{1,40}$'),
  valor           jsonb not null default '{}'::jsonb,
  actualizado_por text,
  actualizado_en  timestamptz not null default now()
);
alter table public.ajustes_web enable row level security;
revoke all on public.ajustes_web from anon, authenticated;
grant select, insert, update on public.ajustes_web to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ajustes_web' and policyname = 'staff_lee_ajustes') then
    create policy "staff_lee_ajustes" on public.ajustes_web for select to authenticated using (public.es_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ajustes_web' and policyname = 'duenos_crean_ajustes') then
    create policy "duenos_crean_ajustes" on public.ajustes_web for insert to authenticated
      with check (exists (select 1 from public.staff s where s.usuario = public.staff_usuario() and s.es_dueno));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ajustes_web' and policyname = 'duenos_cambian_ajustes') then
    create policy "duenos_cambian_ajustes" on public.ajustes_web for update to authenticated
      using (exists (select 1 from public.staff s where s.usuario = public.staff_usuario() and s.es_dueno))
      with check (exists (select 1 from public.staff s where s.usuario = public.staff_usuario() and s.es_dueno));
  end if;
end
$$;

-- Lo que necesita la portada (cualquiera puede leerlo): solo los campos del tema
create or replace function public.tema_publico()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('tema', valor->>'tema', 'desde', valor->>'desde', 'hasta', valor->>'hasta',
                           'franja', valor->>'franja', 'franja_activa', coalesce((valor->>'franja_activa')::boolean, false),
                           'franja_demo', coalesce((valor->>'franja_demo')::boolean, false))
  from ajustes_web where clave = 'tema';
$$;
revoke all on function public.tema_publico() from public;
grant execute on function public.tema_publico() to anon, authenticated;

-- Halloween 2026: desde ya hasta el 1 de noviembre a las 23:59 (hora de España). Solo se crea si no existe.
insert into public.ajustes_web (clave, valor, actualizado_por)
values ('tema', jsonb_build_object('tema', 'halloween', 'desde', '2026-10-22T00:00:00+02:00', 'hasta', '2026-11-01T23:59:59+01:00',
        'franja', '🎃 ¡Feliz Halloween! Pide tu demo gratuita y sin compromiso', 'franja_activa', true, 'franja_demo', true,
        'en_panel', true), 'sistema')
on conflict (clave) do nothing;
