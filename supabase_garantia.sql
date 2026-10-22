-- =====================================================================
--  Velority · Garantía de 30 días en «Renovaciones» al completar el pago de una web
-- =====================================================================
-- Cuando una web queda pagada al 100 % (pago final con tarjeta o marcada como pagada en el panel), se crea sola una
-- renovación «Garantía de 30 días · <web>» vinculada al cliente, que vence 30 días después del pago. Una por pedido.
-- Ejecútalo en Supabase > SQL Editor (se puede repetir). Requiere supabase_ficha_auto.sql (columna renovaciones.auto).
create or replace function public.garantia_por_pago()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'web' and new.pagado_en is not null and new.cliente_id is not null
     and (tg_op = 'INSERT' or old.pagado_en is null) then
    insert into renovaciones (cliente_id, concepto, tipo, fecha, avisar_dias, creado_por, auto)
    values (new.cliente_id, left('Garantía de 30 días · ' || new.nombre, 200), 'otro',
            (new.pagado_en at time zone 'Europe/Madrid')::date + 30, 7, 'sistema', 'garantia-' || new.id)
    on conflict (cliente_id, auto) where auto is not null do nothing;
  end if;
  return new;
end $$;
drop trigger if exists servicios_garantia on public.servicios_cliente;
create trigger servicios_garantia after insert or update of pagado_en on public.servicios_cliente
  for each row execute function public.garantia_por_pago();

-- Webs ya pagadas cuya garantía todavía no ha terminado
insert into renovaciones (cliente_id, concepto, tipo, fecha, avisar_dias, creado_por, auto)
select s.cliente_id, left('Garantía de 30 días · ' || s.nombre, 200), 'otro', (s.pagado_en at time zone 'Europe/Madrid')::date + 30, 7, 'sistema', 'garantia-' || s.id
  from servicios_cliente s
 where s.tipo = 'web' and s.pagado_en is not null and s.cliente_id is not null
   and (s.pagado_en at time zone 'Europe/Madrid')::date + 30 >= (now() at time zone 'Europe/Madrid')::date
on conflict (cliente_id, auto) where auto is not null do nothing;
