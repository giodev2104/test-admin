-- Endurecimiento de seguridad (revisión de octubre 2026). Se puede ejecutar varias veces.

-- 1) cerrar_mes: antes dejaba pasar a cualquiera cuyo JWT no tuviera email (p. ej. la clave anon pública).
--    Ahora, si la llamada viene de la API (anon/authenticated), exige ser del equipo. El cron (sin JWT) sigue funcionando.
create or replace function public.cerrar_mes(p_mes date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare m date := coalesce(p_mes, (date_trunc('month', now()) - interval '1 month')::date); n int;
begin
  if (coalesce(auth.role(), '') in ('anon', 'authenticated') or coalesce(auth.jwt() ->> 'email', '') <> '')
     and not public.es_staff() then
    raise exception 'Solo el equipo puede cerrar el mes.';
  end if;
  insert into webs_cliente_historial (cliente_id, mes, datos)
  select cliente_id, date_trunc('month', m)::date, jsonb_strip_nulls(jsonb_build_object(
    'mes_actualizaciones', mes_actualizaciones, 'mes_ataques', mes_ataques, 'mes_cambios', mes_cambios,
    'mes_horas', mes_horas, 'horas_incluidas', horas_incluidas, 'horas_usadas', horas_usadas,
    'disponibilidad', disponibilidad, 'velocidad', velocidad, 'puntuacion', puntuacion,
    'seo_visitas', seo_visitas, 'seo_impresiones', seo_impresiones, 'seo_clics', seo_clics,
    'seo_primera_pagina', seo_primera_pagina, 'plan', plan,
    'seo_palabras', case when jsonb_array_length(seo_palabras) > 0 then seo_palabras end,
    'enlaces_rotos', case when enlaces_revisado_en is not null then jsonb_array_length(enlaces_rotos) end))
  from webs_cliente
  on conflict (cliente_id, mes) do update set datos = excluded.datos, creado_en = now();
  get diagnostics n = row_count;
  update webs_cliente set mes_actualizaciones = null, mes_ataques = null, mes_cambios = null, mes_horas = null,
    horas_usadas = case when horas_incluidas is not null then 0 end
  where cliente_id in (select cliente_id from webs_cliente_historial where mes = date_trunc('month', m)::date);
  return n;
end $$;
revoke execute on function public.cerrar_mes(date) from public, anon;
grant execute on function public.cerrar_mes(date) to authenticated;

-- 2) Las funciones de trigger no deben poder llamarse por la API
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and pg_get_function_result(p.oid) = 'trigger' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- 3) search_path fijo
alter function public._permisos_validos(text[]) set search_path = public;
