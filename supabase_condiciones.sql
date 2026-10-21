-- =====================================================================
--  Velority · Constancia de aceptación de las condiciones (sin mensaje en el chat)
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de supabase_fases_pago.sql. Se puede ejecutar varias veces.
-- Guarda en el caso la fecha y hora en que el cliente marcó «He leído y acepto el Aviso Legal y las
-- Condiciones de Contratación de Servicios de Pago Único». Solo lo ve el equipo (detalle del caso).
-- =====================================================================
alter table public.reportes add column if not exists condiciones_aceptadas_en timestamptz;
alter table public.reportes add column if not exists condiciones_version text;

create or replace function public.cliente_aceptar_condiciones(p_token text, p_caso bigint, p_version text)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := _cliente_de_token(p_token);
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  update reportes set condiciones_aceptadas_en = now(), condiciones_version = left(coalesce(p_version, ''), 60)
   where id = p_caso and cliente_id = cid;
end
$$;
revoke all on function public.cliente_aceptar_condiciones(text, bigint, text) from public;
grant execute on function public.cliente_aceptar_condiciones(text, bigint, text) to anon, authenticated;

-- Limpieza: los avisos «✅ He leído y acepto…» que se escribían antes en el chat pasan al caso y se borran del chat
update public.reportes r set condiciones_aceptadas_en = m.creado_en, condiciones_version = 'condiciones-pago-unico-2026'
  from public.mensajes_caso m
 where m.caso_id = r.id and m.texto like '✅ He leído y acepto el Aviso Legal%' and r.condiciones_aceptadas_en is null;
delete from public.mensajes_caso where texto like '✅ He leído y acepto el Aviso Legal%';
