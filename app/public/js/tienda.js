renderNav('tienda');

let productos = [];
let categoriaActiva = '';
let carrito = cargarCarrito();

function cargarCarrito() {
  try { return JSON.parse(localStorage.getItem('cofrial_carrito') || '[]'); } catch { return []; }
}
function guardarCarrito() {
  try { localStorage.setItem('cofrial_carrito', JSON.stringify(carrito)); } catch { /* sin almacenamiento */ }
  renderCarrito();
}

async function cargarCategorias() {
  const cats = await api('/categorias');
  const cont = document.getElementById('categorias');
  const pill = (id, txt) => `<button class="btn btn-sm ${String(categoriaActiva) === String(id) ? 'btn-cofrial' : 'btn-outline-secondary'}" data-cat="${id}">${esc(txt)}</button>`;
  cont.innerHTML = pill('', 'Todos') + cats.map((c) => pill(c.id_categoria, c.nombre)).join('');
  cont.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    categoriaActiva = b.dataset.cat;
    cargarCategorias();
    cargarProductos();
  }));
}

async function cargarProductos() {
  const params = new URLSearchParams();
  if (categoriaActiva) params.set('categoria', categoriaActiva);
  const q = document.getElementById('buscar').value.trim();
  if (q) params.set('q', q);
  const datos = await api('/productos?' + params);
  productos = datos.productos;

  const u = Sesion.usuario;
  const cajaSegmento = document.getElementById('segmento-aviso');
  if (datos.lista) {
    cajaSegmento.innerHTML = `<div class="alert alert-success py-2">Perfil <b>B2B</b>: estás viendo los precios de tu <b>${esc(datos.lista)}</b>.</div>`;
  } else if (u?.rol === 'CLIENTE_B2C') {
    cajaSegmento.innerHTML = `<div class="alert alert-light border py-2">Perfil <b>B2C</b>: precios de lista para público general.</div>`;
  } else if (!u) {
    cajaSegmento.innerHTML = `<div class="alert alert-light border py-2 small">¿Compras para una institución? <a href="/login">Inicia sesión como cliente B2B</a> para ver tus precios de convenio. Público general: compra con precio de lista.</div>`;
  } else cajaSegmento.innerHTML = '';

  // Actualiza precios del carrito (cambian al iniciar sesión como B2B).
  carrito.forEach((it) => {
    const p = productos.find((x) => x.id_producto === it.id_producto);
    if (p) it.precio = p.precio;
  });
  guardarCarrito();

  document.getElementById('productos').innerHTML = productos.map((p) => `
    <div class="col-6 col-md-4 col-lg-3">
      <div class="card h-100 producto-card">
        <div class="card-body d-flex flex-column">
          <div class="producto-icono mb-2">${esc(p.imagen_url || '📦')}</div>
          <div class="small text-muted">${esc(p.categoria)} · ${p.perfil_frio === 'CONGELADO' ? '❄️ Congelado' : '🧊 Refrigerado'}</div>
          <h3 class="h6 mt-1">${esc(p.nombre)}</h3>
          <p class="small text-muted flex-grow-1">${esc(p.descripcion || '')}</p>
          <div>
            ${p.precio < p.precio_lista ? `<span class="precio-tachado">${clp(p.precio_lista)}</span> ` : ''}
            <span class="fw-semibold">${clp(p.precio)}</span> <span class="small text-muted">/ ${esc(p.unidad)}</span>
          </div>
          <div class="small ${p.stock < 50 ? 'text-danger' : 'text-muted'} mb-2">Stock: ${p.stock} ${esc(p.unidad)}</div>
          <div class="input-group input-group-sm">
            <input type="number" min="1" max="${p.stock}" value="1" class="form-control" id="cant-${p.id_producto}">
            <button class="btn btn-cofrial" onclick="agregar(${p.id_producto})" ${p.stock ? '' : 'disabled'}>Agregar</button>
          </div>
        </div>
      </div>
    </div>`).join('') || '<p class="text-muted">No hay productos que coincidan.</p>';
}

function agregar(id) {
  const p = productos.find((x) => x.id_producto === id);
  const cant = Math.max(1, parseInt(document.getElementById(`cant-${id}`).value, 10) || 1);
  const it = carrito.find((x) => x.id_producto === id);
  if (it) it.cantidad += cant;
  else carrito.push({ id_producto: id, nombre: p.nombre, precio: p.precio, unidad: p.unidad, cantidad: cant });
  guardarCarrito();
  aviso(`${p.nombre} agregado al carrito`);
}

function cambiarCantidad(id, valor) {
  const it = carrito.find((x) => x.id_producto === id);
  it.cantidad = Math.max(0, parseInt(valor, 10) || 0);
  carrito = carrito.filter((x) => x.cantidad > 0);
  guardarCarrito();
}

async function renderCarrito() {
  document.getElementById('carrito-n').textContent = carrito.length;
  const total = carrito.reduce((s, it) => s + it.precio * it.cantidad, 0);
  document.getElementById('carrito-total').textContent = clp(total);
  document.getElementById('carrito-items').innerHTML = carrito.length
    ? carrito.map((it) => `
      <div class="d-flex align-items-center gap-2 border-bottom py-2">
        <div class="flex-grow-1"><div>${esc(it.nombre)}</div><small class="text-muted">${clp(it.precio)} / ${esc(it.unidad)}</small></div>
        <input type="number" min="0" value="${it.cantidad}" class="form-control form-control-sm" style="width:72px"
               onchange="cambiarCantidad(${it.id_producto}, this.value)">
        <div style="width:90px" class="text-end">${clp(it.precio * it.cantidad)}</div>
      </div>`).join('')
    : '<p class="text-muted">Tu carrito está vacío.</p>';
}

async function renderCheckout() {
  const cont = document.getElementById('checkout');
  if (!Sesion.usuario) {
    cont.innerHTML = `<a class="btn btn-cofrial w-100" href="/login?volver=/">Inicia sesión o regístrate para comprar</a>`;
    return;
  }
  if (!Sesion.esCliente()) {
    cont.innerHTML = `<div class="alert alert-info small">Los usuarios internos ingresan pedidos desde el CRM.</div>`;
    return;
  }
  const [dirs, comunas] = await Promise.all([api('/direcciones'), api('/comunas')]);
  cont.innerHTML = `
    <label class="form-label small">Dirección de despacho</label>
    <select id="dir" class="form-select form-select-sm mb-2">
      ${dirs.map((d) => `<option value="${d.id_direccion}">${esc(d.calle)} ${esc(d.numero)}, ${esc(d.comuna)}</option>`).join('')}
      <option value="nueva">+ Agregar nueva dirección…</option>
    </select>
    <div id="nueva-dir" class="row g-1 mb-2 ${dirs.length ? 'd-none' : ''}">
      <div class="col-7"><input id="nd-calle" class="form-control form-control-sm" placeholder="Calle"></div>
      <div class="col-5"><input id="nd-num" class="form-control form-control-sm" placeholder="Número"></div>
      <div class="col-12"><select id="nd-comuna" class="form-select form-select-sm">${comunas.map((c) => `<option value="${c.id_comuna}">${esc(c.nombre)}</option>`).join('')}</select></div>
    </div>
    <textarea id="obs" class="form-control form-control-sm mb-2" rows="2" placeholder="Observaciones (horario de recepción, etc.)"></textarea>
    <button id="btn-confirmar" class="btn btn-cofrial w-100">Confirmar orden</button>`;
  const sel = document.getElementById('dir');
  if (!dirs.length) sel.value = 'nueva';
  sel.addEventListener('change', () => document.getElementById('nueva-dir').classList.toggle('d-none', sel.value !== 'nueva'));
  document.getElementById('btn-confirmar').addEventListener('click', confirmar);
}

async function confirmar() {
  if (!carrito.length) return aviso('Tu carrito está vacío', 'warning');
  const btn = document.getElementById('btn-confirmar');
  btn.disabled = true;
  try {
    let idDir = document.getElementById('dir').value;
    if (idDir === 'nueva') {
      const calle = document.getElementById('nd-calle').value.trim();
      if (!calle) throw new Error('Ingresa la calle de la nueva dirección');
      const r = await api('/direcciones', { method: 'POST', body: {
        calle, numero: document.getElementById('nd-num').value.trim(), id_comuna: Number(document.getElementById('nd-comuna').value) } });
      idDir = r.id_direccion;
    }
    const r = await api('/pedidos', { method: 'POST', body: {
      id_direccion: Number(idDir), observacion: document.getElementById('obs').value,
      items: carrito.map((it) => ({ id_producto: it.id_producto, cantidad: it.cantidad })) } });
    carrito = [];
    guardarCarrito();
    bootstrap.Offcanvas.getInstance(document.getElementById('carrito'))?.hide();
    aviso(`¡Orden #${r.id_pedido} creada por ${clp(r.total)}! Puedes seguirla en "Mis pedidos".`);
    cargarProductos();
  } catch (e) {
    aviso(e.message, 'danger');
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('carrito').addEventListener('show.bs.offcanvas', renderCheckout);
let tBuscar;
document.getElementById('buscar').addEventListener('input', () => { clearTimeout(tBuscar); tBuscar = setTimeout(cargarProductos, 300); });

// Formulario de contacto con clasificación por IA
document.getElementById('form-contacto').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const btn = f.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Analizando con IA…';
  try {
    const r = await api('/contacto', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
    document.getElementById('contacto-resultado').innerHTML = `
      <div class="card border-success">
        <div class="card-body">
          <h3 class="h6">Recibimos tu mensaje (#${r.id_requerimiento})</h3>
          <p class="mb-2">${badge(r.categoria)} ${badge(r.prioridad)} <small class="text-muted">clasificado por ${r.motor === 'gemini' ? 'Gemini (IA)' : 'reglas automáticas'}</small></p>
          <p class="mb-0">${esc(r.respuesta)}</p>
        </div>
      </div>`;
    f.reset();
  } catch (e) {
    aviso(e.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar';
  }
});

// Asistente virtual
document.getElementById('chat-btn').addEventListener('click', () => {
  const p = document.getElementById('chat-panel');
  p.style.display = p.style.display === 'block' ? 'none' : 'block';
});
document.getElementById('chat-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = document.getElementById('chat-input');
  const pregunta = input.value.trim();
  if (!pregunta) return;
  const log = document.getElementById('chat-log');
  log.insertAdjacentHTML('beforeend', `<div class="msg-yo"><span>${esc(pregunta)}</span></div>`);
  input.value = '';
  log.insertAdjacentHTML('beforeend', `<div class="msg-bot" id="pensando"><span class="pulso">…</span></div>`);
  log.scrollTop = log.scrollHeight;
  try {
    const r = await api('/asistente', { method: 'POST', body: { pregunta } });
    document.getElementById('pensando').outerHTML = `<div class="msg-bot"><span>${esc(r.respuesta)}</span></div>`;
    document.getElementById('chat-motor').textContent = r.motor === 'gemini' ? '· Gemini' : '· reglas';
  } catch (e) {
    document.getElementById('pensando').outerHTML = `<div class="msg-bot"><span>${esc(e.message)}</span></div>`;
  }
  log.scrollTop = log.scrollHeight;
});

renderCarrito();
cargarCategorias();
cargarProductos();
