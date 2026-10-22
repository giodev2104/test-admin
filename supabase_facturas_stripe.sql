-- =====================================================================
--  Velority · Facturas de los pagos con tarjeta (Stripe) en «Servicios y facturas» del portal
-- =====================================================================
-- La función «pago» guarda en webs_cliente.facturas la factura (o el recibo) de cada pago de Stripe.
-- Esta función la añade una sola vez por pago, aunque lleguen a la vez el aviso de Stripe y la vuelta del cliente.
-- Solo la usa la función del servidor (service_role). Se puede ejecutar varias veces.
create or replace function public.servidor_anadir_factura(p_cliente uuid, p_factura jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into webs_cliente (cliente_id) values (p_cliente) on conflict (cliente_id) do nothing;
  update webs_cliente w
     set facturas = jsonb_build_array(p_factura) || coalesce(w.facturas, '[]'::jsonb)
   where w.cliente_id = p_cliente
     and not exists (select 1 from jsonb_array_elements(coalesce(w.facturas, '[]'::jsonb)) f
                      where f->>'sesion' = p_factura->>'sesion' or (p_factura->>'numero' is not null and f->>'numero' = p_factura->>'numero'));
end $$;
revoke all on function public.servidor_anadir_factura(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.servidor_anadir_factura(uuid, jsonb) to service_role;
