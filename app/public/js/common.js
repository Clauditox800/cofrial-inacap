// Utilidades compartidas por todas las páginas.
const Sesion = {
  get token() { try { return localStorage.getItem('cofrial_token'); } catch { return null; } },
  get usuario() { try { return JSON.parse(localStorage.getItem('cofrial_usuario') || 'null'); } catch { return null; } },
  guardar(token, usuario) {
    try { localStorage.setItem('cofrial_token', token); localStorage.setItem('cofrial_usuario', JSON.stringify(usuario)); } catch { /* sin almacenamiento */ }
  },
  cerrar() {
    try { localStorage.removeItem('cofrial_token'); localStorage.removeItem('cofrial_usuario'); } catch { /* nada */ }
    location.href = '/';
  },
  esStaff() { return ['ADMIN', 'VENDEDOR', 'DESPACHADOR'].includes(this.usuario?.rol); },
  esCliente() { return ['CLIENTE_B2B', 'CLIENTE_B2C'].includes(this.usuario?.rol); },
};

async function api(ruta, opciones = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (Sesion.token) headers.Authorization = `Bearer ${Sesion.token}`;
  const resp = await fetch(`/api${ruta}`, {
    method: opciones.method || 'GET',
    headers,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const datos = await resp.json().catch(() => ({}));
  if (resp.status === 401 && Sesion.token && !ruta.startsWith('/auth')) {
    Sesion.cerrar();
  }
  if (!resp.ok) throw new Error(datos.error || `Error ${resp.status}`);
  return datos;
}

const clp = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL');
const fecha = (f) => (f ? new Date(f).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const COLOR_ESTADO = {
  PENDIENTE: 'warning', CONFIRMADO: 'info', EN_PREPARACION: 'primary', DESPACHADO: 'secondary',
  ENTREGADO: 'success', CANCELADO: 'danger', ABIERTO: 'warning', EN_GESTION: 'info', CERRADO: 'success',
  EN_RUTA: 'primary', FINALIZADO: 'success', PROGRAMADO: 'secondary',
  ALTA: 'danger', MEDIA: 'warning', BAJA: 'secondary',
};
const badge = (txt) => `<span class="badge text-bg-${COLOR_ESTADO[txt] || 'light'}">${esc(String(txt).replace('_', ' '))}</span>`;

function aviso(mensaje, tipo = 'success') {
  let cont = document.getElementById('avisos');
  if (!cont) {
    cont = document.createElement('div');
    cont.id = 'avisos';
    cont.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    document.body.appendChild(cont);
  }
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${tipo} border-0`;
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(mensaje)}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  cont.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: 4000 });
  t.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

// Barra de navegación según el rol del usuario.
function renderNav(activa) {
  const u = Sesion.usuario;
  const link = (href, txt, id) => `<li class="nav-item"><a class="nav-link ${activa === id ? 'active' : ''}" href="${href}">${txt}</a></li>`;
  let links = link('/', 'Tienda', 'tienda');
  if (Sesion.esCliente()) links += link('/mis-pedidos', 'Mis pedidos', 'pedidos');
  if (Sesion.esStaff()) links += link('/crm', 'CRM', 'crm') + link('/dashboard', 'Dashboard BI', 'bi');
  const derecha = u
    ? `<span class="navbar-text me-3 small">${esc(u.nombre)} · <span class="badge text-bg-light">${esc(u.rol.replace('CLIENTE_', ''))}</span></span>
       <button class="btn btn-outline-light btn-sm" onclick="Sesion.cerrar()">Salir</button>`
    : `<a class="btn btn-outline-light btn-sm" href="/login">Iniciar sesión</a>`;
  document.getElementById('nav').innerHTML = `
  <nav class="navbar navbar-expand-md navbar-dark bg-cofrial">
    <div class="container-fluid">
      <a class="navbar-brand fw-semibold" href="/">❄️ Cofrial</a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#menu"><span class="navbar-toggler-icon"></span></button>
      <div class="collapse navbar-collapse" id="menu">
        <ul class="navbar-nav me-auto">${links}</ul>
        <div class="d-flex align-items-center">${derecha}</div>
      </div>
    </div>
  </nav>`;
}

// Protege páginas internas.
function exigirRol(...roles) {
  if (!Sesion.usuario || !roles.includes(Sesion.usuario.rol)) {
    location.href = '/login?volver=' + encodeURIComponent(location.pathname);
    return false;
  }
  return true;
}
