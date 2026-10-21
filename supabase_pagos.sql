-- =====================================================================
--  Velority · Pagos con Stripe Checkout (el pedido se crea solo cuando el cobro está confirmado)
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor DESPUÉS de supabase_opiniones.sql.
-- No borra datos y se puede ejecutar varias veces.
--
-- La función «pago» crea la página de pago de Stripe con el importe del catálogo y, cuando Stripe
-- confirma el cobro (al volver el cliente o por el aviso automático de Stripe), llama a
-- servidor_registrar_pago: crea el caso y el servicio ya marcado como pagado, o marca como pagado
-- un pedido que ya existía. Cada pago se registra una sola vez (tabla pagos).
-- =====================================================================

create table if not exists public.pagos (
  sesion        text primary key,
  cliente_id    uuid not null references public.clientes(id) on delete cascade,
  tipo          text not null,
  nombre        text not null,
  importe       numeric(10,2),
  modo          text,
  servicio_id   bigint references public.servicios_cliente(id) on delete set null,
  caso_id       bigint references public.reportes(id) on delete set null,
  creado_en     timestamptz not null default now()
);
create index if not exists pagos_cliente_idx on public.pagos (cliente_id);
alter table public.pagos enable row level security;
revoke all on public.pagos from anon, authenticated;
grant select on public.pagos to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pagos' and policyname = 'staff_lee_pagos') then
    create policy "staff_lee_pagos" on public.pagos for select to authenticated using (public.es_staff());
  end if;
end
$$;

-- Solo para la función «pago» (service role): registra un cobro confirmado por Stripe
create or replace function public.servidor_registrar_pago(p_sesion text, p_cliente uuid, p_tipo text, p_nombre text,
                                                          p_importe numeric, p_modo text, p_servicio bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare c clientes; r reportes; s servicios_cliente; ya pagos; actual text; precio text;
begin
  select * into ya from pagos where sesion = p_sesion;
  if ya.sesion is not null then
    return json_build_object('repetido', true, 'caso_id', ya.caso_id, 'servicio_id', ya.servicio_id);
  end if;
  select * into c from clientes where id = p_cliente;
  if c.id is null then raise exception 'Cliente no encontrado.'; end if;
  precio := replace(to_char(p_importe, 'FM999990.00'), '.', ',') || ' €' || case when p_modo = 'subscription' then '/mes' else '' end;

  if p_servicio is not null then
    -- Pago de un pedido que ya existía (p. ej. desde «Mis pedidos»)
    update servicios_cliente set pagado_en = now(), pagado_por = 'Stripe'
      where id = p_servicio and cliente_id = p_cliente returning * into s;
    if s.id is null then raise exception 'Pedido no encontrado.'; end if;
    if s.caso_id is not null then
      insert into mensajes_caso (caso_id, autor_tipo, autor, texto)
        values (s.caso_id, 'staff', 'sistema', '💶 Pago recibido por Stripe (' || precio || '). ¡Gracias!');
    end if;
    insert into pagos (sesion, cliente_id, tipo, nombre, importe, modo, servicio_id, caso_id)
      values (p_sesion, p_cliente, p_tipo, p_nombre, p_importe, p_modo, s.id, s.caso_id);
    return json_build_object('servicio_id', s.id, 'caso_id', s.caso_id);
  end if;

  select plan into actual from webs_cliente where cliente_id = p_cliente;
  if p_tipo in ('mantenimiento', 'renting') then
    insert into reportes (tipo_reporte, titulo, descripcion, usuario_discord, email, dominio, plan, plan_solicitado, estado, cliente_id)
    values ('Cambio', 'Cambio de plan a ' || p_nombre,
            'Pagado por Stripe (' || precio || '). El cliente pasa de ' || coalesce(actual, 'sin plan') || ' a ' || p_nombre
              || '. Al pasar este caso a «Aceptado», su plan cambiará solo en el portal. Si tenía otra suscripción en Stripe, cancélala.',
            c.nombre, c.email, c.dominio, actual, p_nombre, 'Entrada de leads', p_cliente)
    returning * into r;
  else
    insert into reportes (tipo_reporte, titulo, descripcion, usuario_discord, email, dominio, plan, estado, cliente_id)
    values ('Cambio', 'Contratar: ' || p_nombre,
            'Pagado por Stripe (' || precio || '). El cliente ha contratado «' || p_nombre || '» desde su portal.',
            c.nombre, c.email, c.dominio, actual, 'Entrada de leads', p_cliente)
    returning * into r;
  end if;
  insert into servicios_cliente (cliente_id, tipo, nombre, precio, estado, caso_id, pagado_en, pagado_por)
    values (p_cliente, p_tipo, left(p_nombre, 150), precio, 'pendiente', r.id, now(), 'Stripe') returning * into s;
  insert into pagos (sesion, cliente_id, tipo, nombre, importe, modo, servicio_id, caso_id)
    values (p_sesion, p_cliente, p_tipo, p_nombre, p_importe, p_modo, s.id, r.id);
  return json_build_object('servicio_id', s.id, 'caso_id', r.id);
end
$$;
revoke all on function public.servidor_registrar_pago(text, uuid, text, text, numeric, text, bigint) from public, anon, authenticated;

-- Los planes de web (precio por presupuesto) se siguen pidiendo sin pago: el caso se titula «Presupuesto»
create or replace function public.cliente_pedir_presupuesto(p_token text, p_nombre text, p_precio text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); c clientes; r reportes; s servicios_cliente; nom text := left(trim(coalesce(p_nombre, '')), 150);
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  if nom not like 'Plan %' then raise exception 'Solo los planes de web se piden por presupuesto.'; end if;
  if exists (select 1 from servicios_cliente where cliente_id = cid and nombre = nom and estado = 'pendiente') then
    raise exception 'Ya has pedido presupuesto de «%»; el equipo lo está preparando.', nom;
  end if;
  select * into c from clientes where id = cid;
  insert into reportes (tipo_reporte, titulo, descripcion, usuario_discord, email, dominio, estado, cliente_id)
  values ('Cambio', 'Presupuesto: ' || nom,
          'El cliente pide presupuesto de «' || nom || '»' || coalesce(' (' || p_precio || ')', '')
            || '. Envíale el precio final por el chat; cuando lo pague, márcalo como pagado en su ficha.',
          c.nombre, c.email, c.dominio, 'Entrada de leads', cid)
  returning * into r;
  insert into servicios_cliente (cliente_id, tipo, nombre, precio, estado, caso_id)
    values (cid, 'web', nom, left(p_precio, 60), 'pendiente', r.id) returning * into s;
  return json_build_object('caso', json_build_object('id', r.id, 'tipo_reporte', r.tipo_reporte, 'titulo', r.titulo, 'estado', r.estado,
                             'plan', r.plan, 'plan_solicitado', r.plan_solicitado, 'dominio', r.dominio, 'urgencia', r.urgencia,
                             'created_at', r.created_at, 'origen', r.origen),
                           'servicio', to_json(s));
end
$$;
revoke all on function public.cliente_pedir_presupuesto(text, text, text) from public;
grant execute on function public.cliente_pedir_presupuesto(text, text, text) to anon, authenticated;

-- Ya no se puede pedir un servicio de pago sin pagar: la petición directa queda solo para el equipo
revoke execute on function public.cliente_pedir_servicio(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.cliente_pedir_plan(text, text) from public, anon, authenticated;

select 'Pagos listos' as resultado;
