if (exigirRol('ADMIN', 'VENDEDOR', 'DESPACHADOR')) {
  renderNav('crm');
  iniciar();
}

let cat = {}; // listas, vendedores, etapas, camiones, conductores, perfiles, comunas
const modal = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modal'));
function abrirModal(titulo, html) {
  document.getElementById('modal-titulo').textContent = titulo;
  document.getElementById('modal-cuerpo').innerHTML = html;
  modal().show();
}
const opciones = (arr, val, txt, sel) => arr.map((x) => `<option value="${x[val]}" ${String(x[val]) === String(sel) ? 'selected' : ''}>${esc(x[txt])}</option>`).join('');
const intentar = (fn) => async (...a) => { try { await fn(...a); } catch (e) { aviso(e.message, 'danger'); } };

async function iniciar() {
  cat = await api('/crm/catalogos');
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => mostrarTab(b.dataset.tab)));
  document.getElementById('buscar-cli').addEventListener('input', () => { clearTimeout(window.tCli); window.tCli = setTimeout(cargarClientes, 300); });
  document.getElementById('filtro-estado').addEventListener('change', cargarPedidos);
  const inicial = location.hash.slice(1) || (Sesion.usuario.rol === 'DESPACHADOR' ? 'despachos' : 'pipeline');
  mostrarTab(inicial);
  contarRequerimientos();
}

function mostrarTab(tab) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('d-none', p.dataset.panel !== tab));
  history.replaceState(null, '', '#' + tab);
  ({ pipeline: cargarPipeline, clientes: cargarClientes, pedidos: cargarPedidos, despachos: cargarDespachos, requerimientos: cargarRequerimientos })[tab]?.();
}

// ---------------- Pipeline ----------------
async function cargarPipeline() {
  const ops = await api('/crm/oportunidades');
  const k = document.getElementById('kanban');
  k.innerHTML = cat.etapas.map((e) => {
    const deEtapa = ops.filter((o) => o.id_etapa === e.id_etapa);
    const suma = deEtapa.reduce((s, o) => s + o.monto_estimado, 0);
    return `<div class="kanban-col" data-etapa="${e.id_etapa}">
      <div class="d-flex justify-content-between small fw-semibold mb-2"><span>${esc(e.nombre)} (${deEtapa.length})</span><span class="text-muted">${clp(suma)}</span></div>
      ${deEtapa.map((o) => `<div class="kanban-card" draggable="true" data-id="${o.id_oportunidad}">
        <div class="fw-semibold">${esc(o.cliente)} <span class="badge text-bg-light">${o.segmento}</span></div>
        <div>${esc(o.titulo)}</div>
        <div class="d-flex justify-content-between text-muted"><span>${clp(o.monto_estimado)}</span><span>${esc(o.vendedor)}</span></div>
        <a href="#" class="small" onclick="verCliente(${o.id_cliente}); return false;">Ver ficha</a>
      </div>`).join('')}
    </div>`;
  }).join('');

  k.querySelectorAll('.kanban-card').forEach((c) => c.addEventListener('dragstart', (ev) => ev.dataTransfer.setData('text/plain', c.dataset.id)));
  k.querySelectorAll('.kanban-col').forEach((col) => {
    col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', intentar(async (ev) => {
      ev.preventDefault();
      col.classList.remove('drop');
      await api(`/crm/oportunidades/${ev.dataTransfer.getData('text/plain')}`, { method: 'PATCH', body: { id_etapa: Number(col.dataset.etapa) } });
      cargarPipeline();
    }));
  });
}

async function modalOportunidad() {
  const clientes = await api('/crm/clientes');
  abrirModal('Nueva oportunidad', `
    <form id="f-op" class="vstack gap-2">
      <select name="id_cliente" class="form-select">${opciones(clientes, 'id_cliente', 'nombre')}</select>
      <input name="titulo" class="form-control" placeholder="Título (ej. Convenio anual de carnes)" required>
      <input name="monto_estimado" type="number" class="form-control" placeholder="Monto estimado (CLP)">
      <button class="btn btn-cofrial">Crear</button>
    </form>`);
  document.getElementById('f-op').addEventListener('submit', intentar(async (ev) => {
    ev.preventDefault();
    await api('/crm/oportunidades', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) });
    modal().hide();
    cargarPipeline();
  }));
}

// ---------------- Clientes ----------------
async function cargarClientes() {
  const q = document.getElementById('buscar-cli').value.trim();
  const cs = await api('/crm/clientes' + (q ? `?q=${encodeURIComponent(q)}` : ''));
  document.getElementById('tabla-clientes').innerHTML = `
    <thead><tr><th>Cliente</th><th>Segmento</th><th>RUT</th><th>Convenio</th><th>Vendedor</th><th class="text-end">Pedidos</th><th class="text-end">Compras</th><th>Última compra</th></tr></thead>
    <tbody>${cs.map((c) => `<tr role="button" onclick="verCliente(${c.id_cliente})">
      <td>${esc(c.nombre)} ${c.es_prospecto ? '<span class="badge text-bg-warning">Prospecto</span>' : ''}<div class="small text-muted">${esc(c.email)}</div></td>
      <td>${c.segmento}</td><td>${esc(c.rut)}</td><td>${esc(c.lista || '—')}</td><td>${esc(c.vendedor || '—')}</td>
      <td class="text-end">${c.pedidos}</td><td class="text-end">${clp(c.total_compras)}</td><td>${fecha(c.ultima_compra)}</td></tr>`).join('')}</tbody>`;
}

function modalCliente() {
  abrirModal('Nuevo cliente o prospecto', `
    <form id="f-cli" class="row g-2">
      <div class="col-md-4"><select name="segmento" class="form-select"><option>B2B</option><option>B2C</option></select></div>
      <div class="col-md-4"><input name="rut" class="form-control" placeholder="RUT" required></div>
      <div class="col-md-4"><input name="telefono" class="form-control" placeholder="Teléfono"></div>
      <div class="col-md-6"><input name="nombre" class="form-control" placeholder="Razón social o nombre" required></div>
      <div class="col-md-6"><input name="email" type="email" class="form-control" placeholder="Correo" required></div>
      <div class="col-md-6"><label class="small">Convenio (B2B)</label><select name="id_lista_precio" class="form-select"><option value="">Sin convenio</option>${opciones(cat.listas, 'id_lista_precio', 'nombre')}</select></div>
      <div class="col-md-6"><label class="small">Vendedor</label><select name="id_vendedor" class="form-select">${opciones(cat.vendedores, 'id_usuario', 'nombre', Sesion.usuario.id)}</select></div>
      <div class="col-md-5"><input name="calle" class="form-control" placeholder="Calle"></div>
      <div class="col-md-3"><input name="numero" class="form-control" placeholder="Número"></div>
      <div class="col-md-4"><select name="id_comuna" class="form-select">${opciones(cat.comunas, 'id_comuna', 'nombre')}</select></div>
      <div class="col-md-8"><input name="oportunidad" class="form-control" placeholder="Oportunidad inicial (opcional)"></div>
      <div class="col-md-4"><input name="monto_estimado" type="number" class="form-control" placeholder="Monto estimado"></div>
      <div class="col-12"><button class="btn btn-cofrial">Guardar (entra al pipeline como Prospecto)</button></div>
    </form>`);
  document.getElementById('f-cli').addEventListener('submit', intentar(async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    d.direccion = d.calle ? { calle: d.calle, numero: d.numero, id_comuna: Number(d.id_comuna) } : null;
    d.id_lista_precio = d.id_lista_precio ? Number(d.id_lista_precio) : null;
    d.id_vendedor = Number(d.id_vendedor);
    const r = await api('/crm/clientes', { method: 'POST', body: d });
    aviso('Cliente creado');
    cargarClientes();
    verCliente(r.id_cliente);
  }));
}

async function verCliente(id) {
  const c = await api(`/crm/clientes/${id}`);
  abrirModal(c.nombre, `
    <div class="row g-3">
      <div class="col-md-5">
        <div class="small text-muted">Segmento</div><div>${c.segmento} ${c.es_prospecto ? '<span class="badge text-bg-warning">Prospecto</span>' : '<span class="badge text-bg-success">Cliente</span>'}</div>
        <div class="small text-muted mt-2">RUT / contacto</div><div>${esc(c.rut)} · ${esc(c.email)} · ${esc(c.telefono || '')}</div>
        <div class="small text-muted mt-2">Convenio · vendedor</div><div>${esc(c.lista || 'Precio lista')} · ${esc(c.vendedor || '—')}</div>
        <div class="small text-muted mt-2">Direcciones</div>${c.direcciones.map((d) => `<div>${esc(d.calle)} ${esc(d.numero)}, ${esc(d.comuna)}</div>`).join('') || '—'}
        <div class="small text-muted mt-2">Acceso al portal</div>
        ${c.acceso_portal ? `<div>${esc(c.acceso_portal)}</div>` : `
          <form id="f-acceso" class="input-group input-group-sm mt-1">
            <input name="email" class="form-control" value="${esc(c.email)}">
            <input name="password" class="form-control" placeholder="Clave inicial" minlength="6" required>
            <button class="btn btn-outline-primary">Crear</button>
          </form>`}
      </div>
      <div class="col-md-7">
        <h3 class="h6">Registrar interacción</h3>
        <form id="f-int" class="input-group input-group-sm mb-3">
          <select name="tipo" class="form-select" style="max-width:120px"><option>LLAMADA</option><option>CORREO</option><option>REUNION</option><option>VISITA</option><option>NOTA</option></select>
          <input name="descripcion" class="form-control" placeholder="¿Qué se conversó?" required>
          <button class="btn btn-cofrial">Guardar</button>
        </form>
        <div style="max-height:200px;overflow:auto" class="small">${c.interacciones.map((i) => `<div class="border-bottom py-1"><b>${i.tipo}</b> · ${fecha(i.fecha)} · ${esc(i.usuario)}<div>${esc(i.descripcion)}</div></div>`).join('') || '<span class="text-muted">Sin interacciones</span>'}</div>
      </div>
      <div class="col-md-6"><h3 class="h6">Pedidos</h3><div class="small">${c.pedidos.map((p) => `<div>#${p.id_pedido} · ${fecha(p.fecha)} · ${badge(p.estado)} · ${clp(p.total)}</div>`).join('') || '—'}</div></div>
      <div class="col-md-6"><h3 class="h6">Oportunidades</h3><div class="small">${c.oportunidades.map((o) => `<div>${esc(o.titulo)} · ${esc(o.etapa)} · ${clp(o.monto_estimado)}</div>`).join('') || '—'}</div>
        <h3 class="h6 mt-2">Requerimientos</h3><div class="small">${c.requerimientos.map((r) => `<div>${badge(r.categoria_ia)} ${esc(r.mensaje.slice(0, 80))}</div>`).join('') || '—'}</div></div>
    </div>`);
  document.getElementById('f-int').addEventListener('submit', intentar(async (ev) => {
    ev.preventDefault();
    await api(`/crm/clientes/${id}/interacciones`, { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) });
    verCliente(id);
  }));
  document.getElementById('f-acceso')?.addEventListener('submit', intentar(async (ev) => {
    ev.preventDefault();
    await api(`/crm/clientes/${id}/acceso`, { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) });
    aviso('Cuenta del portal creada');
    verCliente(id);
  }));
}

// ---------------- Pedidos ----------------
const ACCIONES = {
  PENDIENTE: [['CONFIRMADO', 'Confirmar', 'success'], ['CANCELADO', 'Cancelar', 'outline-danger']],
  CONFIRMADO: [['EN_PREPARACION', 'A preparación', 'primary'], ['CANCELADO', 'Cancelar', 'outline-danger']],
};

async function cargarPedidos() {
  const estado = document.getElementById('filtro-estado').value;
  const ps = await api('/crm/pedidos' + (estado ? `?estado=${estado}` : ''));
  document.getElementById('tabla-pedidos').innerHTML = `
    <thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Canal</th><th>Despacho a</th><th class="text-end">Total</th><th>Estado</th><th></th></tr></thead>
    <tbody>${ps.map((p) => `<tr>
      <td><a href="#" onclick="verPedido(${p.id_pedido}); return false;">${p.id_pedido}</a></td><td>${fecha(p.fecha)}</td>
      <td>${esc(p.cliente)} <span class="badge text-bg-light">${p.segmento}</span></td><td>${p.canal}</td>
      <td class="small">${esc(p.direccion)}</td><td class="text-end">${clp(p.total)}</td>
      <td>${badge(p.estado)} ${p.id_despacho ? `<span class="small text-muted">desp. #${p.id_despacho}</span>` : ''}</td>
      <td class="text-nowrap">${(ACCIONES[p.estado] || []).map(([e, t, c]) => `<button class="btn btn-sm btn-${c}" onclick="cambiarEstado(${p.id_pedido}, '${e}')">${t}</button>`).join(' ')}</td>
    </tr>`).join('')}</tbody>`;
}

const cambiarEstado = intentar(async (id, estado) => {
  if (estado === 'CANCELADO' && !confirm(`¿Cancelar el pedido #${id}? El stock se devolverá al inventario.`)) return;
  await api(`/crm/pedidos/${id}/estado`, { method: 'PATCH', body: { estado } });
  aviso(`Pedido #${id} → ${estado}`);
  cargarPedidos();
});

async function verPedido(id) {
  const p = await api(`/crm/pedidos/${id}`);
  abrirModal(`Pedido #${p.id_pedido} · ${p.cliente}`, `
    <p>${badge(p.estado)} Canal ${p.canal} · ${fecha(p.fecha)} · <b>${clp(p.total)}</b></p>
    <table class="table table-sm"><thead><tr><th>Producto</th><th class="text-end">Cantidad</th><th class="text-end">Precio</th><th class="text-end">Subtotal</th></tr></thead>
      <tbody>${p.detalle.map((d) => `<tr><td>${esc(d.nombre)}</td><td class="text-end">${d.cantidad} ${esc(d.unidad)}</td><td class="text-end">${clp(d.precio_unitario)}</td><td class="text-end">${clp(d.cantidad * d.precio_unitario)}</td></tr>`).join('')}</tbody></table>
    <h3 class="h6">Historial</h3>
    ${p.historial.map((h) => `<div class="small">${fecha(h.fecha)} · ${badge(h.estado)} ${esc(h.usuario || 'cliente')} ${esc(h.comentario || '')}</div>`).join('')}`);
}

async function modalPedidoCRM() {
  const [clientes, prods] = await Promise.all([api('/crm/clientes'), api('/productos')]);
  abrirModal('Pedido ingresado por el vendedor (canal CRM)', `
    <form id="f-ped" class="vstack gap-2">
      <select id="ped-cli" class="form-select">${opciones(clientes, 'id_cliente', 'nombre')}</select>
      <select id="ped-dir" class="form-select"></select>
      <div id="ped-items"></div>
      <button type="button" class="btn btn-sm btn-outline-secondary" id="ped-mas">+ Producto</button>
      <p class="small text-muted mb-0">El precio se calcula según el convenio del cliente al guardar.</p>
      <button class="btn btn-cofrial">Crear pedido</button>
    </form>`);
  const fila = () => `<div class="input-group input-group-sm mb-1"><select class="form-select ped-prod">${opciones(prods.productos, 'id_producto', 'nombre')}</select><input type="number" min="1" value="10" class="form-control ped-cant" style="max-width:90px"></div>`;
  const items = document.getElementById('ped-items');
  items.innerHTML = fila();
  document.getElementById('ped-mas').addEventListener('click', () => items.insertAdjacentHTML('beforeend', fila()));
  const cargarDirs = async () => {
    const c = await api(`/crm/clientes/${document.getElementById('ped-cli').value}`);
    document.getElementById('ped-dir').innerHTML = c.direcciones.map((d) => `<option value="${d.id_direccion}">${esc(d.calle)} ${esc(d.numero)}, ${esc(d.comuna)}</option>`).join('') || '<option value="">El cliente no tiene direcciones</option>';
  };
  document.getElementById('ped-cli').addEventListener('change', cargarDirs);
  cargarDirs();
  document.getElementById('f-ped').addEventListener('submit', intentar(async (ev) => {
    ev.preventDefault();
    const itemsSel = [...items.children].map((r) => ({ id_producto: Number(r.querySelector('.ped-prod').value), cantidad: Number(r.querySelector('.ped-cant').value) }));
    const r = await api('/crm/pedidos', { method: 'POST', body: {
      id_cliente: Number(document.getElementById('ped-cli').value), id_direccion: Number(document.getElementById('ped-dir').value), items: itemsSel } });
    modal().hide();
    aviso(`Pedido #${r.id_pedido} creado por ${clp(r.total)}`);
    cargarPedidos();
  }));
}

// ---------------- Despachos ----------------
async function cargarDespachos() {
  cat = await api('/crm/catalogos');
  const [desps, listos] = await Promise.all([api('/crm/despachos'), api('/crm/pedidos?estado=EN_PREPARACION')]);
  const libres = cat.camiones.filter((c) => !c.en_ruta);
  document.getElementById('form-despacho').innerHTML = `
    <label class="small">Camión disponible</label><select name="id_camion" class="form-select form-select-sm">${libres.map((c) => `<option value="${c.id_camion}">${c.codigo} · ${c.patente}</option>`).join('')}</select>
    <label class="small">Conductor</label><select name="id_conductor" class="form-select form-select-sm">${opciones(cat.conductores, 'id_conductor', 'nombre')}</select>
    <label class="small">Tipo de carga (rango de frío)</label><select name="id_perfil_frio" class="form-select form-select-sm">${cat.perfiles.map((p) => `<option value="${p.id_perfil_frio}">${p.nombre} (${p.temp_min} a ${p.temp_max} °C)</option>`).join('')}</select>
    <label class="small">Pedidos EN PREPARACIÓN</label>
    <div class="border rounded p-2 small" style="max-height:200px;overflow:auto">${listos.map((p) => `<div class="form-check"><input class="form-check-input" type="checkbox" value="${p.id_pedido}" id="pd${p.id_pedido}"><label class="form-check-label" for="pd${p.id_pedido}">#${p.id_pedido} · ${esc(p.cliente)} · ${esc(p.direccion)}</label></div>`).join('') || '<span class="text-muted">No hay pedidos listos. Pasa pedidos a preparación en la pestaña Pedidos.</span>'}</div>
    <button class="btn btn-cofrial btn-sm">Despachar</button>`;
  document.getElementById('tabla-despachos').innerHTML = `
    <thead><tr><th>#</th><th>Camión</th><th>Conductor</th><th>Frío</th><th>Pedidos</th><th>Salida</th><th>Alertas</th><th>Estado</th><th></th></tr></thead>
    <tbody>${desps.map((d) => `<tr>
      <td>${d.id_despacho}</td><td>${d.camion}</td><td>${esc(d.conductor)}</td><td class="small">${d.perfil_frio}<br>${d.temp_min} a ${d.temp_max} °C</td>
      <td>${esc(d.pedidos || '')}</td><td class="small">${fecha(d.fecha_salida)}</td>
      <td>${d.alertas ? `<span class="badge text-bg-danger">${d.alertas}</span>` : '<span class="text-muted">0</span>'}</td>
      <td>${badge(d.estado)}</td>
      <td>${d.estado === 'EN_RUTA' ? `<button class="btn btn-sm btn-success" onclick="finalizarDespacho(${d.id_despacho})">Entregado</button>` : ''}</td></tr>`).join('')}</tbody>`;
}

document.getElementById('form-despacho').addEventListener('submit', intentar(async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const pedidos = [...f.querySelectorAll('input[type=checkbox]:checked')].map((c) => Number(c.value));
  const r = await api('/crm/despachos', { method: 'POST', body: {
    id_camion: Number(f.id_camion.value), id_conductor: Number(f.id_conductor.value), id_perfil_frio: Number(f.id_perfil_frio.value), pedidos } });
  aviso(`Despacho #${r.id_despacho} en ruta`);
  cargarDespachos();
}));

const finalizarDespacho = intentar(async (id) => {
  await api(`/crm/despachos/${id}/finalizar`, { method: 'POST' });
  aviso(`Despacho #${id} finalizado: pedidos entregados`);
  cargarDespachos();
});

// ---------------- Requerimientos IA ----------------
async function contarRequerimientos() {
  const rs = await api('/crm/requerimientos');
  const n = rs.filter((r) => r.estado === 'ABIERTO' && r.prioridad_ia === 'ALTA').length;
  document.getElementById('n-req').textContent = n || '';
}

async function cargarRequerimientos() {
  const rs = await api('/crm/requerimientos');
  document.getElementById('tabla-req').innerHTML = `
    <thead><tr><th>Fecha</th><th>Contacto</th><th>Mensaje</th><th>IA</th><th>Respuesta sugerida</th><th>Estado</th></tr></thead>
    <tbody>${rs.map((r) => `<tr>
      <td class="small">${fecha(r.fecha)}</td>
      <td class="small">${esc(r.cliente || r.nombre_contacto)}<br><span class="text-muted">${esc(r.email_contacto)}</span></td>
      <td class="small" style="max-width:300px">${esc(r.mensaje)}</td>
      <td>${badge(r.categoria_ia)}<br>${badge(r.prioridad_ia)}<div class="small text-muted">${esc(r.motor_ia || '')}</div>
        <button class="btn btn-link btn-sm p-0" onclick="reclasificar(${r.id_requerimiento})">reclasificar</button></td>
      <td class="small" style="max-width:300px">${esc(r.respuesta_sugerida || '')}</td>
      <td><select class="form-select form-select-sm" onchange="estadoReq(${r.id_requerimiento}, this.value)">
        ${['ABIERTO', 'EN_GESTION', 'CERRADO'].map((e) => `<option ${e === r.estado ? 'selected' : ''}>${e}</option>`).join('')}</select></td>
    </tr>`).join('')}</tbody>`;
}

const estadoReq = intentar(async (id, estado) => {
  await api(`/crm/requerimientos/${id}`, { method: 'PATCH', body: { estado } });
  contarRequerimientos();
});

const reclasificar = intentar(async (id) => {
  const r = await api(`/crm/requerimientos/${id}/reclasificar`, { method: 'POST' });
  aviso(`Clasificado como ${r.categoria} (${r.prioridad}) por ${r.motor}`);
  cargarRequerimientos();
});
