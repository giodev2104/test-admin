-- =====================================================================
--  Webcare · «Quiero mi demo gratuita»: crea un caso «Demo gratuita» para el equipo
-- =====================================================================
-- Ejecútalo en Supabase > SQL Editor. Se puede ejecutar varias veces.
create or replace function public.cliente_pedir_demo(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid := _cliente_de_token(p_token); c clientes; r reportes;
begin
  if cid is null then raise exception 'SESION_CADUCADA'; end if;
  select * into c from clientes where id = cid;
  select * into r from reportes where cliente_id = cid and titulo = 'Demo gratuita' and eliminado_en is null
    and estado not in ('Aceptado', 'Denegado') order by created_at desc limit 1;
  if r.id is not null then return json_build_object('caso', to_json(r), 'repetido', true); end if;
  insert into reportes (tipo_reporte, titulo, descripcion, usuario_discord, email, dominio, estado, cliente_id)
  values ('Lead', 'Demo gratuita',
          'El cliente ha pedido su demo gratuita desde la portada del portal. Pregúntale por el chat qué secciones quiere, si tiene textos, imágenes o logo y 2 o 3 webs de referencia, y prepárale la demo.'
            || coalesce(' Web: ' || c.dominio, ''),
          c.nombre, c.email, c.dominio, 'Entrada de leads', cid)
  returning * into r;
  return json_build_object('caso', json_build_object('id', r.id, 'tipo_reporte', r.tipo_reporte, 'titulo', r.titulo, 'estado', r.estado,
                             'plan', r.plan, 'plan_solicitado', r.plan_solicitado, 'dominio', r.dominio, 'urgencia', r.urgencia,
                             'created_at', r.created_at, 'origen', r.origen), 'repetido', false);
end
$$;
revoke all on function public.cliente_pedir_demo(text) from public;
grant execute on function public.cliente_pedir_demo(text) to anon, authenticated;
