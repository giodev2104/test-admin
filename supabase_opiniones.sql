-- =====================================================================
--  Velority · Opiniones de clientes en la web
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de supabase_entregas.sql.
-- No borra datos y se puede ejecutar varias veces.
--
-- Cuando el cliente descarga su entrega (o se cierra su solicitud) puede valorar el trabajo.
-- Si marca «Mostrar mi opinión en la web», aparece en la página principal del portal con su nombre
-- y la inicial de su apellido. El equipo puede ocultar cualquier opinión desde el panel (Negocio).
-- =====================================================================

alter table public.valoraciones add column if not exists publica        boolean not null default false;
alter table public.valoraciones add column if not exists oculta         boolean not null default false;
alter table public.valoraciones add column if not exists nombre_publico text;
alter table public.valoraciones add column if not exists servicio       text;

grant update (oculta) on public.valoraciones to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'valoraciones' and policyname = 'staff_oculta_valoraciones') then
    create policy "staff_oculta_valoraciones" on public.valoraciones for update to authenticated
      using (public.es_staff()) with check (public.es_staff());
  end if;
end
$$;

-- El cliente valora un caso cerrado o un pedido cuya entrega ya ha descargado
create or replace function public.cliente_opinar(p_token text, p_caso bigint, p_estrellas int, p_comentario text, p_publica boolean)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); c clientes; srv text; nombre text;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  if p_estrellas is null or p_estrellas not between 1 and 5 then raise exception 'Elige de 1 a 5 estrellas.'; end if;
  if not exists (select 1 from reportes where id = p_caso and cliente_id = cid and eliminado_en is null) then
    raise exception 'No encontramos ese pedido.';
  end if;
  select s.nombre into srv from servicios_cliente s
    where s.caso_id = p_caso and s.cliente_id = cid
      and exists (select 1 from entregas e where e.servicio_id = s.id and e.descargado_en is not null)
    limit 1;
  if srv is null and not exists (select 1 from reportes where id = p_caso and estado in ('Aceptado', 'Denegado')) then
    raise exception 'Podrás valorarlo cuando descargues tu entrega o se cierre la solicitud.';
  end if;
  select * into c from clientes where id = cid;
  nombre := split_part(trim(c.nombre), ' ', 1)
            || case when split_part(trim(c.nombre), ' ', 2) <> '' then ' ' || upper(left(split_part(trim(c.nombre), ' ', 2), 1)) || '.' else '' end;
  insert into valoraciones (caso_id, cliente_id, estrellas, comentario, publica, nombre_publico, servicio)
    values (p_caso, cid, p_estrellas, nullif(left(trim(coalesce(p_comentario, '')), 1000), ''), coalesce(p_publica, false), nombre,
            coalesce(srv, (select coalesce(nullif(plan, ''), titulo) from reportes where id = p_caso)))
  on conflict (caso_id) do update set estrellas = excluded.estrellas, comentario = excluded.comentario, publica = excluded.publica,
    nombre_publico = excluded.nombre_publico, servicio = excluded.servicio, creado_en = now();
  return json_build_object('caso_id', p_caso, 'estrellas', p_estrellas, 'publica', coalesce(p_publica, false));
end
$$;
revoke all on function public.cliente_opinar(text, bigint, int, text, boolean) from public;
grant execute on function public.cliente_opinar(text, bigint, int, text, boolean) to anon, authenticated;

-- Opiniones que se muestran en la página principal (cualquiera puede leerlas; sin datos personales)
create or replace function public.valoraciones_publicas()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'media', (select round(avg(estrellas)::numeric, 1) from valoraciones where publica and not oculta),
    'total', (select count(*) from valoraciones where publica and not oculta),
    'lista', coalesce((select json_agg(x) from (
        select nombre_publico as nombre, estrellas, comentario, servicio, creado_en::date as fecha
        from valoraciones
        where publica and not oculta and comentario is not null
        order by creado_en desc limit 9) x), '[]'::json));
$$;
revoke all on function public.valoraciones_publicas() from public;
grant execute on function public.valoraciones_publicas() to anon, authenticated;

select 'Opiniones listas' as resultado;
