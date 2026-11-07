// Diseño del panel con «Apariencia»: tema claro/oscuro/automático y menú arriba/izquierda/derecha (se guarda en cada dispositivo).
// Se carga después del script principal: rehace la navegación moviendo los botones originales (con sus acciones y contadores),
// y sustituye renderInicio() y tarjeta() por la versión nueva. Los estilos están en apariencia.css.
(function () {
  const $ = id => document.getElementById(id), H = document.documentElement;
  const leer = (k, d) => { try { return localStorage.getItem(k) || d; } catch (_) { return d; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const oscuroSistema = matchMedia("(prefers-color-scheme: dark)");
  function aplicar() {
    const t = leer("vel-tema", "oscuro"), m = leer("vel-menu", "izq");
    H.dataset.tema = t === "auto" ? (oscuroSistema.matches ? "oscuro" : "claro") : t;
    H.dataset.temaElegido = t; H.dataset.menu = m;
    document.querySelectorAll("[data-fx-ajuste]").forEach(b => { const [k, v] = b.dataset.fxAjuste.split(":"); b.setAttribute("aria-pressed", String((k === "tema" ? t : m) === v)); });
  }
  oscuroSistema.addEventListener("change", aplicar);

  const svg = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    inicio: svg('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
    casos: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>'),
    clientes: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>'),
    renovaciones: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'),
    negocio: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    correo: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
    equipo: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'),
    papelera: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
    guia: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>'),
    salir: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
    ajustes: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    mas: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
    flecha: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    sol: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    luna: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
    auto: svg('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  };
  const SEC = [["inicio", "Inicio"], ["casos", "Pipeline"], ["clientes", "Clientes"], ["renovaciones", "Renovaciones"], ["correo", "Correo"], ["negocio", "Negocio"]];
  const logo = (document.querySelector(".rail-logo svg") || {}).outerHTML || "";

  // ---------- Menú lateral (izquierda o derecha) ----------
  const aside = document.querySelector("aside.w-14");
  if (aside && !aside.dataset.fx) {
    // Se mueven los botones originales (con sus avisos y acciones), no se crean de nuevo
    aside.dataset.fx = "1"; aside.classList.add("fx-lado");
    const prep = (el, t, extra) => { if (!el) return ""; el.classList.add("fx-nav"); el.querySelectorAll("svg").forEach(s => { s.setAttribute("width", "18"); s.setAttribute("height", "18"); s.removeAttribute("class"); });
      const sp = document.createElement("span"); sp.textContent = t; el.querySelector("svg") ? el.querySelector("svg").after(sp) : el.prepend(sp); if (extra) el.insertAdjacentHTML("beforeend", extra); return el; };
    const q = v => aside.querySelector(`[data-ir="${v}"]`);
    const g = (t, els) => { const n = document.createElement("nav"); n.className = "fx-grupo"; n.innerHTML = `<p>${t}</p>`; els.filter(Boolean).forEach(e => n.appendChild(e)); return n; };
    const inicio = prep(q("inicio"), "Inicio"), casos = prep(q("casos"), "Pipeline", `<em class="fx-n" data-fx-n></em>`), clientesB = prep(q("clientes"), "Clientes"), renov = prep(q("renovaciones"), "Renovaciones"),
      negocio = prep(q("negocio"), "Negocio"), correo = prep(q("correo"), "Correo"), admin = prep($("admin-abrir"), "Equipo"), papelera = prep($("papelera-abrir"), "Papelera"),
      tema = prep($("tema-abrir"), "Tema de la web"), avisos = prep($("avisos-abrir"), "Avisos del móvil"), guia = prep($("guia-abrir"), "Guía"), salir = $("salir");
    const apar = document.createElement("button"); apar.type = "button"; apar.className = "fx-nav rail-btn"; apar.dataset.fxAbrir = ""; apar.innerHTML = I.ajustes + "<span>Apariencia</span>";
    const marca = document.createElement("div"); marca.className = "fx-marca"; marca.innerHTML = `<span class="fx-logo">${logo}</span><b>Velority</b>`;
    const yo = document.createElement("div"); yo.className = "fx-yo"; yo.innerHTML = `<span class="fx-av" data-fx-ini></span><span><b data-fx-nombre></b><small data-fx-rol></small></span>`;
    if (salir) { salir.className = "fx-salir"; salir.innerHTML = I.salir; yo.appendChild(salir); }
    const viejo = [...aside.children];
    aside.append(marca, g("Trabajo", [inicio, casos, clientesB, renov]), g("Comercial", [correo, negocio]), g("Ajustes", [admin, papelera, tema, avisos, guia, apar]), yo);
    viejo.forEach(e => { if (e.isConnected && e.parentNode === aside) e.remove(); });
  }
  // ---------- Menú arriba ----------
  const bar = document.querySelector("div.sticky.top-0.z-20");
  if (bar && !bar.dataset.fx) {
    bar.dataset.fx = "1"; bar.classList.add("fx-barra");
    const izq = document.createElement("div"); izq.className = "fx-top";
    izq.innerHTML = `<span class="fx-marca fx-marca-top"><span class="fx-logo">${logo}</span><b>Velority</b></span>
      <nav class="fx-tabs" aria-label="Secciones">${SEC.map(([v, t]) => `<button type="button" data-ir="${v}" class="rail-btn fx-tab">${t}${v === "casos" ? `<em data-fx-n></em>` : ""}</button>`).join("")}</nav>`;
    bar.prepend(izq);
    const tit = document.createElement("h2"); tit.id = "fx-titulo"; bar.prepend(tit);
    const der = document.createElement("div"); der.className = "fx-der";
    der.innerHTML = `<button type="button" class="top-btn" data-fx-abrir aria-label="Apariencia" title="Apariencia">${I.ajustes}</button><button type="button" class="fx-av" data-fx-ini data-fx-mas aria-label="Tu cuenta y más opciones"></button>`;
    bar.appendChild(der);
  }
  // ---------- Barra inferior en el móvil ----------
  if (!$("fx-tabbar")) {
    const t = document.createElement("nav"); t.id = "fx-tabbar"; t.setAttribute("aria-label", "Menú");
    t.innerHTML = [["inicio", "Hoy"], ["casos", "Pipeline"], ["clientes", "Clientes"], ["correo", "Correo"]].map(([v, x]) => `<button type="button" data-ir="${v}" class="rail-btn">${I[v]}<span>${x}</span>${v === "correo" ? `<em class="fx-tab-n" data-fx-correo-n></em>` : ""}</button>`).join("");
    document.body.appendChild(t);
  }
  // ---------- «Más» en el móvil: el resto de secciones y ajustes ----------
  if (!$("fx-mas")) {
    const m = document.createElement("div"); m.id = "fx-mas"; m.hidden = true;
    const ir = (v, t) => `<button type="button" data-ir="${v}" data-fx-cerrar-mas>${I[v]}<span>${t}</span></button>`;
    const bt = (id, ic, t) => `<button type="button" data-fx-clic="${id}">${ic}<span>${t}</span></button>`;
    m.innerHTML = `<div class="fx-mas-caja" role="dialog" aria-modal="true" aria-label="Más"><div class="fx-mas-asa"></div>
      ${ir("renovaciones", "Renovaciones")}${ir("negocio", "Negocio")}${bt("admin-abrir", I.equipo, "Equipo")}${bt("papelera-abrir", I.papelera, "Papelera")}
      ${bt("tema-abrir", I.sol, "Tema de la web")}${bt("avisos-abrir", I.auto, "Avisos del móvil")}${bt("guia-abrir", I.guia, "Guía")}
      <button type="button" data-fx-abrir>${I.ajustes}<span>Apariencia</span></button>${bt("salir", I.salir, "Cerrar sesión")}</div>`;
    document.body.appendChild(m);
    document.addEventListener("click", e => {
      const t = e.target.closest ? e.target : null; if (!t) return;
      if (t.closest("[data-fx-mas]") && matchMedia("(max-width: 760px)").matches) {   // solo se ofrecen los botones que el panel muestra a esta persona
        m.querySelectorAll("[data-fx-clic]").forEach(b => { const o = $(b.dataset.fxClic); b.hidden = !o || o.classList.contains("hidden"); });
        m.hidden = false; return;
      }
      if (t === m || t.closest("[data-fx-cerrar-mas]") || t.closest("#fx-mas [data-fx-abrir]")) { m.hidden = true; return; }
      const c = t.closest("[data-fx-clic]"); if (c) { m.hidden = true; const o = $(c.dataset.fxClic); if (o) o.click(); }
    });
    addEventListener("keydown", e => { if (e.key === "Escape") m.hidden = true; });
  }

  // ---------- Panel «Apariencia» ----------
  if (!$("fx-ajustes")) {
    const p = document.createElement("div"); p.id = "fx-ajustes"; p.hidden = true;
    const op = (k, v, t, ic) => `<button type="button" data-fx-ajuste="${k}:${v}" class="fx-op">${ic}<span>${t}</span></button>`;
    const mini = cls => `<span class="fx-mini ${cls}"><i></i><i></i></span>`;
    p.innerHTML = `<div class="fx-aj-caja" role="dialog" aria-modal="true" aria-labelledby="fx-aj-t">
      <header><h2 id="fx-aj-t">Apariencia</h2><button type="button" data-fx-cerrar aria-label="Cerrar">×</button></header>
      <p class="fx-aj-k">Tema</p><div class="fx-ops">${op("tema", "claro", "Claro", I.sol)}${op("tema", "oscuro", "Oscuro", I.luna)}${op("tema", "auto", "Automático", I.auto)}</div>
      <p class="fx-aj-k">Menú</p><div class="fx-ops">${op("menu", "arriba", "Arriba", mini("m-arriba"))}${op("menu", "izq", "Lateral izquierdo", mini("m-izq"))}${op("menu", "der", "Lateral derecho", mini("m-der"))}</div>
      <p class="fx-aj-nota">Se guarda en este dispositivo. «Automático» sigue el modo claro u oscuro del móvil o del ordenador. En el móvil el menú va siempre abajo.</p></div>`;
    document.body.appendChild(p);
    document.addEventListener("click", e => {
      const t = e.target.closest ? e.target : null; if (!t) return;
      if (t.closest("[data-fx-abrir]")) { p.hidden = false; return; }
      if (t.closest("[data-fx-cerrar]") || t === p) { p.hidden = true; return; }
      const a = t.closest("[data-fx-ajuste]");
      if (a) { const [k, v] = a.dataset.fxAjuste.split(":"); guardar(k === "tema" ? "vel-tema" : "vel-menu", v); aplicar(); }
    });
    addEventListener("keydown", e => { if (e.key === "Escape") p.hidden = true; });
  }

  // ---------- Inicio (cifras de la prueba 1 + «Lo siguiente» y grupos de la prueba 2) ----------
  window.renderInicio = function () {
    const base = activos().filter(abierto).filter(r => dashAmbito === "equipo" || r.responsable_usuario === usuarioActual || !r.responsable_usuario);
    const prio = (a, b) => (vencido(b) - vencido(a)) || (cambioPrio(b) - cambioPrio(a)) || (sinResponder(b) - sinResponder(a)) || (urgencia(b) - urgencia(a));
    const venc = base.filter(vencido), resp = base.filter(sinResponder), sin = base.filter(r => !r.responsable_usuario), pv = base.filter(porVencer);
    const urg = activos().filter(r => abierto(r) && esUrgente(r) && !primerMensajeEquipo(r));
    const cam24 = activos().filter(r => nivelCambio(r) === 2);
    const mes = new Date(); mes.setDate(1); mes.setHours(0, 0, 0, 0);
    const resMes = activos().filter(r => r.estado === "Aceptado" && new Date(r.resuelto_en || 0) >= mes);
    const medioH = resMes.length ? Math.round(resMes.reduce((t, r) => t + (new Date(r.resuelto_en) - new Date(r.created_at)), 0) / resMes.length / HORA) : null;
    const accion = r => sinResponder(r) ? "Responder" : !r.responsable_usuario ? "Asignar" : vencido(r) ? "Desbloquear" : "Resolver";
    const vistos = new Set(), G = { urgente: [], hoy: [], despues: [] };
    const meter = (g, r, motivo, chip) => { if (vistos.has(r.id)) return; vistos.add(r.id); G[g].push({ r, motivo, chip }); };
    urg.sort((a, b) => urgenciaVence(a) - urgenciaVence(b)).forEach(r => meter("urgente", r, "Urgencia del cliente", urgenciaChip(r)));
    venc.slice().sort(prio).forEach(r => meter("urgente", r, "Fuera de plazo · " + accion(r), slaBadge(r)));
    cam24.sort((a, b) => cambioVence(a) - cambioVence(b)).forEach(r => meter("hoy", r, "Cambio en 24 h", cambioChip(r)));
    resp.slice().sort(prio).forEach(r => meter("hoy", r, "Te ha escrito", slaBadge(r)));
    pv.slice().sort((a, b) => slaRestante(a) - slaRestante(b)).forEach(r => meter("hoy", r, "Vence pronto · " + accion(r), slaBadge(r)));
    base.slice().sort(prio).forEach(r => meter("despues", r, accion(r), slaBadge(r)));
    const sig = G.urgente[0] || G.hoy[0] || G.despues[0];
    const fecha = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
    const n = G.urgente.length + G.hoy.length;
    const kpi = (t, v, nota, tono, dest) => `<button type="button" data-ir="${dest || "casos"}" class="fx-kpi"><span><i class="fx-dot ${v ? tono : ""}"></i>${t}</span><b>${v}</b><small>${nota}</small></button>`;
    const fila = (x, tono) => `<li><button type="button" data-detalle="${x.r.id}" class="fx-fila"><span class="fx-check ${tono}" aria-hidden="true"></span>
      <span class="fx-fila-t"><b>${esc(x.r.titulo || "Sin título")}</b><small>${esc(x.r.usuario_discord || "Anónimo")} · ${esc(x.motivo)}</small></span><span class="fx-fila-c">${x.chip || ""}</span></button></li>`;
    const grupo = (t, k, tono, max) => G[k].length ? `<section class="fx-grupo-l"><h3>${t} <span>${G[k].length}</span></h3><ul>${G[k].slice(0, max).map(x => fila(x, tono)).join("")}</ul>${G[k].length > max ? `<button type="button" data-ir="casos" class="fx-vermas">Ver ${G[k].length - max} más</button>` : ""}</section>` : "";
    const agenda = [], ini = new Date(); ini.setHours(0, 0, 0, 0);
    for (const r of activos()) {
      if (new Date(r.created_at) >= ini) agenda.push({ f: r.created_at, t: "Nuevo caso", d: r.titulo || "Sin título", id: r.id });
      for (const m of mensajesDe(r.id)) if (new Date(m.creado_en) >= ini) agenda.push({ f: m.creado_en, t: m.autor_tipo === "staff" ? bonito(m.autor || "Equipo") + " respondió" : (r.usuario_discord || "Cliente") + " escribió", d: "#" + r.id, id: r.id });
    }
    agenda.sort((a, b) => new Date(b.f) - new Date(a.f));
    $("vista-inicio").innerHTML = `
    <header class="fx-cab"><div><p class="fx-fecha">${fecha.charAt(0).toUpperCase() + fecha.slice(1)}</p><h1>${saludo()}, ${esc(bonito(usuarioActual || ""))}</h1>
      <p class="fx-sub">${n ? `<b>${n} ${n === 1 ? "cosa necesita" : "cosas necesitan"} tu atención hoy</b>` : "Lo tienes todo al día"}</p></div>
      <div class="fx-seg" role="group" aria-label="Ámbito"><button type="button" data-ambito="yo" aria-pressed="${dashAmbito === "yo"}">Mis casos</button><button type="button" data-ambito="equipo" aria-pressed="${dashAmbito === "equipo"}">Equipo</button></div></header>
    <section class="fx-kpis">${kpi("Vencidos", venc.length, "Fuera de plazo", "rojo")}${kpi("Sin responder", resp.length, "El cliente espera", "ambar")}${kpi("Sin asignar", sin.length, "Nadie se ha hecho cargo", "violeta")}${kpi("Vencen pronto", pv.length, "Menos de 6 h", "azul")}${kpi("Aceptados este mes", resMes.length, medioH === null ? "Sin tiempo medio aún" : "Media " + medioH + " h por caso", "verde", "negocio")}</section>
    <div class="fx-inicio"><div class="fx-principal">
      ${sig ? `<article class="fx-sig"><p class="fx-sig-k">Lo siguiente</p><h2>${esc(sig.r.titulo || "Sin título")}</h2>
        <p class="fx-sig-m">${esc(sig.r.usuario_discord || "Anónimo")} · #${sig.r.id} · ${esc(etapaDe(sig.r.estado).t)} · hace ${edadCorta(sig.r)}</p>
        <div class="fx-sig-c"><span class="fx-motivo">${esc(sig.motivo)}</span>${sig.chip || ""}</div>
        <div class="fx-sig-b"><button type="button" data-detalle="${sig.r.id}" class="fx-btn">Abrir caso ${I.flecha}</button><button type="button" data-ir="casos" class="fx-btn s">Ver el pipeline</button></div></article>`
        : `<article class="fx-sig"><p class="fx-sig-k">Lo siguiente</p><h2>Nada pendiente. Buen trabajo.</h2></article>`}
      ${grupo("Urgente", "urgente", "rojo", 5)}${grupo("Para hoy", "hoy", "ambar", 5)}${grupo("Después", "despues", "", 4)}</div>
      <aside class="fx-tarj"><h3>Hoy</h3>${agenda.length ? `<ol class="fx-tl">${agenda.slice(0, 10).map(a => `<li><button type="button" data-detalle="${a.id}"><time>${new Date(a.f).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</time><span><b>${esc(a.t)}</b><small>${esc(a.d)}</small></span></button></li>`).join("")}</ol>` : `<p class="fx-vacio">Nada todavía hoy.</p>`}</aside>
    </div>`;
  };

  // ---------- Tarjeta del pipeline ----------
  window.tarjeta = function (r) {
    const estado = columnaDe(r.estado), resuelto = cerrado(estado), venc = !resuelto && vencido(r), pide = !resuelto && sinResponder(r);
    const tipo = tipoDe(r), resp = r.responsable_usuario;
    const chips = [esUrgente(r) ? urgenciaChip(r) : "", cambioChip(r), r.plan ? `<span class="mini">${esc(r.plan)}</span>` : ""].join("");
    return `<article class="card fx-card ${venc ? "fx-venc" : ""} ${resuelto ? "fx-res" : ""}" style="--c:${TIPOS[tipo].rgb}">
      <div class="fx-card-top"><span class="fx-tipo" style="--t:${TIPOS[tipo].rgb}">${esc(tipo)}</span><span class="fx-edad">${edadCorta(r)}</span><span class="grip" aria-hidden="true">⋮⋮</span>${puedeBorrar() ? `<button type="button" data-borrar="${r.id}" class="fx-x" aria-label="Eliminar caso #${r.id}">×</button>` : ""}</div>
      <h3>${esc(r.titulo || "Sin título")}</h3><p class="fx-cli">${esc(r.usuario_discord || "Anónimo")}</p>
      ${chips ? `<div class="fx-chips">${chips}</div>` : ""}
      <div class="fx-pie">${resp ? `<span class="fx-av s">${esc(resp.charAt(0).toUpperCase())}</span>` : `<span class="fx-sin">Sin asignar</span>`}${pide ? `<span class="fx-pide">Te ha escrito</span>` : ""}
        <span class="fx-pie-d">${resuelto ? `<span class="mini">${estado === "Aceptado" ? "Aceptado" : "Denegado"}</span>` : slaBadge(r)}${!resuelto && siguienteEtapa(r.estado) ? `<button type="button" data-avanzar="${r.id}" class="avanzar" aria-label="Pasar a ${siguienteEtapa(r.estado).t}">→</button>` : ""}</span></div></article>`;
  };
  const TIT = Object.fromEntries(SEC);
  // ---------- Móvil: pipeline sencillo (lista por etapa en vez de columnas). En PC no se muestra ----------
  let fxEtapa = null;
  function pipelineMovil() {
    const cont = $("vista-casos"); if (!cont) return;
    let el = $("fx-mcasos"); if (!el) { el = document.createElement("div"); el.id = "fx-mcasos"; cont.appendChild(el); }
    if (vista !== "casos") return;
    const todos = activos(), abiertasE = ETAPAS.filter(x => !cerrado(x.e));
    const de = e => todos.filter(r => columnaDe(r.estado) === e);
    const cerr = todos.filter(r => cerrado(r.estado)).sort((a, b) => new Date(b.resuelto_en || b.created_at) - new Date(a.resuelto_en || a.created_at)).slice(0, 20);
    const tabs = abiertasE.map(x => ({ k: x.e, t: x.t, n: de(x.e).length, c: x.c })).concat([{ k: "__cerrados", t: "Cerrados", n: cerr.length, c: "113,113,122" }]);
    if (!fxEtapa || !tabs.some(t => t.k === fxEtapa)) fxEtapa = (tabs.find(t => t.n && t.k !== "__cerrados") || tabs[0]).k;
    const prio = (a, b) => (vencido(b) - vencido(a)) || (cambioPrio(b) - cambioPrio(a)) || (sinResponder(b) - sinResponder(a)) || (new Date(a.created_at) - new Date(b.created_at));
    const lista = fxEtapa === "__cerrados" ? cerr : de(fxEtapa).sort(prio);
    const fila = r => { const res = cerrado(r.estado), venc = !res && vencido(r), pide = !res && sinResponder(r);
      return `<li><button type="button" data-detalle="${r.id}" class="fx-mfila ${venc ? "venc" : ""}"><i style="background:rgb(${TIPOS[tipoDe(r)].rgb})"></i>
        <span class="fx-mfila-t"><b>${esc(r.titulo || "Sin título")}</b><small>${esc(r.usuario_discord || "Anónimo")} · ${esc(tipoDe(r))}${pide ? ' · <em>Te ha escrito</em>' : !r.responsable_usuario && !res ? " · Sin asignar" : ""}</small></span>
        <span class="fx-mfila-d">${res ? `<span class="mini">${r.estado === "Aceptado" ? "Aceptado" : "Denegado"}</span>` : slaBadge(r)}</span></button></li>`; };
    el.innerHTML = `<div class="fx-mtabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" data-fx-etapa="${t.k}" aria-selected="${t.k === fxEtapa}"><i style="background:rgb(${t.c})"></i>${t.t}<span>${t.n}</span></button>`).join("")}</div>
      ${lista.length ? `<ul class="fx-mlista">${lista.map(fila).join("")}</ul>` : `<p class="fx-vacio" style="text-align:center;padding:40px 0">No hay casos aquí.</p>`}`;
  }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-fx-etapa]"); if (b) { fxEtapa = b.dataset.fxEtapa; pipelineMovil(); } });
  const esMovil = matchMedia("(max-width: 760px)");
  esMovil.addEventListener("change", () => { try { render(); } catch (_) {} });

  // Datos de la barra y del menú (usuario, contador del pipeline, título): tras cada render()
  function refrescar() {
    document.querySelectorAll("[data-fx-n]").forEach(e => e.textContent = activos().filter(abierto).length || "");
    const t = $("fx-titulo"); if (t) t.textContent = TIT[vista] || "";
    document.querySelectorAll("[data-fx-ini]").forEach(e => { e.textContent = usuarioActual ? usuarioActual.charAt(0).toUpperCase() : ""; e.title = usuarioActual ? bonito(usuarioActual) : ""; });
    document.querySelectorAll("[data-fx-nombre]").forEach(e => e.textContent = usuarioActual ? bonito(usuarioActual) : "");
    document.querySelectorAll("[data-fx-rol]").forEach(e => e.textContent = usuarioActual ? (soyDueno ? "Propietario" : "Equipo") : "");
    document.querySelectorAll(".rail-btn[data-ir]").forEach(b => b.classList.toggle("on", b.dataset.ir === vista));
    const cn = $("correo-n"); document.querySelectorAll("[data-fx-correo-n]").forEach(e => e.textContent = cn && !cn.classList.contains("hidden") ? cn.textContent : "");
    pipelineMovil();
  }
  const renderBase = window.render;
  window.render = function () { const r = renderBase.apply(this, arguments); try { refrescar(); } catch (_) {} return r; };
  setInterval(() => { try { refrescar(); } catch (_) {} }, 60000);

  // ---------- Iconos: los emojis de botones, filtros y barra pasan a iconos de línea como los del menú ----------
  const ic = (d, w = 16) => `<svg class="fx-ic" viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const P = {
    usuarios: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    mio: '<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 12-5M16 18l2 2 4-4"/>',
    vacio: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/>',
    piezas: '<path d="M4 4h6v3a2 2 0 1 0 4 0V4h6v6h-3a2 2 0 1 0 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H4z"/>',
    web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    llave: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    brillo: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
    caja: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    estrella: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    brote: '<path d="M12 21v-9M12 12C12 7 8 4 4 4c0 5 3 8 8 8zM12 14c0-4 3-7 8-7 0 4-3 7-8 7z"/>',
    etiqueta: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
    almohadilla: '<path d="M5 9h14M5 15h14M10 4l-2 16M16 4l-2 16"/>',
    mas: '<path d="M12 5v14M5 12h14"/>',
    papelera: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    rayo: '<path d="M13 2L3 14h8l-1 8 10-12h-8z"/>',
    reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    campana: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
    campanaNo: '<path d="M13.7 21a2 2 0 0 1-3.4 0M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14M18 14V8a6 6 0 0 0-9.3-5M2 2l20 20"/>',
    pantalla: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    euro: '<path d="M18 7a7 7 0 1 0 0 10M4 10h10M4 14h10"/>',
    bandeja: '<path d="M22 13h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 13v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6z"/>',
    diana: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    correo: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    ojo: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    lupa: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    portapapeles: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9z"/>',
    calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    clip: '<path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
    prohibido: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    telefono: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
    lapiz: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  };
  const EMO = { "👥": "usuarios", "👤": "usuario", "🙋": "mio", "◌": "vacio", "🧩": "piezas", "🌐": "web", "🛠": "llave", "✨": "brillo", "📦": "caja",
    "⭐": "estrella", "★": "estrella", "☆": "estrella", "🌱": "brote", "🏷": "etiqueta", "🏷️": "etiqueta", "#": "almohadilla", "＋": "mas", "🗑": "papelera",
    "⚡": "rayo", "🕒": "reloj", "🔔": "campana", "🔕": "campanaNo", "🖥": "pantalla", "💶": "euro", "📥": "bandeja", "🎯": "diana", "✉️": "correo", "✉": "correo",
    "👁": "ojo", "🔎": "lupa", "📋": "portapapeles", "📅": "calendario", "📎": "clip", "🚫": "prohibido", "✅": "ok", "📞": "telefono", "✏️": "lapiz" };
  try { if (typeof EMOJI_FILTRO === "object") for (const g of Object.values(EMOJI_FILTRO)) for (const k of Object.keys(g)) if (EMO[g[k]]) g[k] = ic(P[EMO[g[k]]], 15); } catch (_) {}
  window.actualizarSonidoBtn = function () {
    const b = $("sonido-btn"); if (!b) return;
    b.innerHTML = ic(P[sonidoOn ? "campana" : "campanaNo"], 17);
    b.setAttribute("aria-pressed", String(sonidoOn)); b.setAttribute("aria-label", sonidoOn ? "Silenciar sonidos" : "Activar sonidos"); b.title = sonidoOn ? "Silenciar sonidos" : "Activar sonidos";
  };
  const notifBase = window.actualizarNotifBtn;
  window.actualizarNotifBtn = function () {
    notifBase.apply(this, arguments);
    const b = $("notif-btn"); if (!b || b.classList.contains("hidden")) return;
    const activo = b.getAttribute("aria-pressed") === "true";
    b.innerHTML = ic(P[activo ? "campana" : "pantalla"], 16) + "<span>Avisos</span>"; b.classList.add("fx-notif"); b.style.color = activo ? "var(--tx)" : ""; b.style.borderColor = activo ? "var(--ln2)" : "";
  };
  // Emoji al principio del texto de un botón, enlace o pestaña → icono de línea
  const RE = new RegExp("^\\s*(" + Object.keys(EMO).filter(k => k !== "#").map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|") + ")\\uFE0F?\\s*");
  function iconizar(raiz) {
    (raiz.querySelectorAll ? raiz : document).querySelectorAll("button, a, [role='tab'], label").forEach(el => {
      if (el.dataset.fxIc) return;
      const t = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      if (!t || el.firstElementChild && el.firstChild !== t && el.firstElementChild.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING && el.firstElementChild.tagName === "svg") return;
      const m = t.textContent.match(RE); if (!m) return;
      el.dataset.fxIc = "1"; t.textContent = t.textContent.slice(m[0].length);
      const sp = document.createElement("span"); sp.className = "fx-ic-c"; sp.innerHTML = ic(P[EMO[m[1]]], 15); el.insertBefore(sp, t);
    });
  }
  let pend = false;
  new MutationObserver(() => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; iconizar(document.body); }); }).observe(document.body, { childList: true, subtree: true });
  try { actualizarSonidoBtn(); actualizarNotifBtn(); } catch (_) {}
  aplicar();
  render();
  iconizar(document.body);
})();
