# Activar suscripciones, renovaciones, impagos, bajas y pago a plazos

Todo está preparado y probado, pero **nada está activo**: el código está en la rama `suscripciones` de
`test-admin` (esta carpeta) y de `test-cliente` (portal y condiciones). La web publicada no ha cambiado.

## Antes de activar (decisiones tuyas)
- Revisa con tu gestoría las **condiciones** (`test-cliente/legal/condiciones-suscripcion/`) y, sobre todo,
  los **recargos del pago a plazos** (3 % a 6 plazos, 6 % a 12): cobrar intereses a particulares puede entrar en
  la Ley 16/2011 de crédito al consumo. Si prefieres evitarlo, pon los recargos a 0 en los dos sitios:
  `PLAZOS` en `pago/index.ts` y `FINANCIACION` en el `index.html` del portal.
- Prueba primero con Stripe en **modo de prueba** (clave `sk_test_…` y tarjeta 4242 4242 4242 4242).

## Pasos para activarlo (unos 15 minutos)
1. **Base de datos**: Supabase › SQL Editor › pega `suscripciones.sql` › Run.
2. **Función de pagos**: despliega `pago/index.ts` como la función `pago` (Verify JWT desactivado).
3. **Secreto**: Supabase › Edge Functions › Secrets › `SUSCRIPCIONES_ACTIVAS` = `1`.
4. **Stripe** › Desarrolladores › Webhooks › el endpoint de `…/functions/v1/pago` › añade los eventos:
   `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
   (además de los que ya tiene: `checkout.session.completed`).
5. **Stripe** › Configuración › Facturación › Suscripciones y correos: activa los **reintentos automáticos**
   (Smart Retries) y, al final de los reintentos, **cancelar la suscripción**.
6. **Portal**: une la rama `suscripciones` de `test-cliente` a `main` (se puso al día con `main` el 2 de noviembre de 2026) y cambia en `index.html`
   `const SUSCRIPCIONES_ACTIVAS=false` por `true`. Añade `/legal/condiciones-suscripcion/` al `sitemap.xml`.

## Qué hace
- **Cuotas automáticas al pagar**: al pagar el 50 % final de una web, Stripe guarda la tarjeta y se crean solas las
  suscripciones con su periodo gratis: **hosting** 5 €/mes (1.er mes gratis) y, en el Plan Ecommerce, **gestión de
  pedidos** 9 €/mes (3 meses gratis). Al pagar el extra EXT-12 o el Pack Tienda Lista se activa la de pedidos, y con
  EXT-09 o el Pack Citas la del **asistente IA** 19 €/mes (3 meses gratis). No se crean si ya las cubre su
  mantenimiento o renting (o si ya las tiene). El hosting tampoco se crea si su web se aloja fuera de Velority
  (`webs_cliente.hosting_externo`, ya marcado para Fernando García). El cliente lo ve antes de pagar, en la ventana «Antes de pagar» y en la
  página de Stripe, y lo acepta. Cada cuota sale en su portal como servicio con baja disponible; si se da de baja
  durante el periodo gratis no se le cobra nada. Si algo fallara al crearlas, el pago se registra igual y te llega
  un aviso al móvil («Cuotas sin activar») para activarlas a mano.
- **Renovaciones**: cada cobro mensual queda registrado en el panel y su factura aparece en el portal del cliente.
- **Impagos**: si falla un cobro, el cliente ve un aviso con el botón «Cambiar mi tarjeta» y un mensaje en su chat,
  y a ti te llega un aviso al móvil. Al cobrarse, se quita solo.
- **Bajas**: al darse de baja desde el portal, la suscripción de Stripe se cancela al final del mes pagado
  (no se cobra nada más) y ese día el servicio pasa a «De baja» y se le quita el plan. También funciona si el
  cliente cancela desde el portal de facturación de Stripe.
- **Pago a plazos**: 3, 6 o 12 cuotas automáticas con tarjeta; la suscripción se termina sola tras la última.
  En webs, la primera cuota cuenta como anticipo y la entrega se libera con la última.
