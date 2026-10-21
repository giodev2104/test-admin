-- =====================================================================
--  Webcare · Asistente IA del portal: límite de uso por IP
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor. Se puede ejecutar varias veces.
-- Solo lo usa la función «asistente» (service role): devuelve true si esa IP ya ha hecho demasiadas preguntas.
create or replace function public.servidor_limite_asistente(p_ip text, p_max int default 40)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if _excedido('ia-ip:' || coalesce(p_ip, ''), p_max, interval '1 hour') then return true; end if;
  perform _anotar('ia-ip:' || coalesce(p_ip, ''));
  return false;
end
$$;
revoke all on function public.servidor_limite_asistente(text, int) from public, anon, authenticated;
