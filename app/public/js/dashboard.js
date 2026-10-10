const COLORES = ['#0b4f6c', '#e07a1f', '#2a9d8f', '#8e5bb5', '#c9a227', '#5c6f7b'];
const COLOR_B2B = '#0b4f6c', COLOR_B2C = '#5aa9c9', ROJO = '#d62839';
Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
Chart.defaults.plugins.legend.labels.boxWidth = 12;

const graficos = {};
let mapa, marcadores = {};

function grafico(id, config) {
  if (graficos[id]) {
    graficos[id].data = config.data;
    graficos[id].update('none');
  } else {
    graficos[id] = new Chart(document.getElementById(id), config);
  }
}

const millones = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)} M` : `$${Math.round(v / 1e3)} mil`);

function kpi(titulo, valor, detalle, alerta = false) {
  return `<div class="col-6 col-md-4 col-xl-2"><div class="card kpi ${alerta ? 'alerta' : ''} h-100"><div class="card-body py-2">
    <div class="small text-muted">${titulo}</div><div class="valor ${alerta ? 'text-danger' : ''}">${valor}</div><div class="small text-muted">${detalle}</div>
  </div></div></div>`;
}

async function actualizar() {
  const [r, flota] = await Promise.all([api('/bi/resumen'), api('/flota')]);
  const k = r.kpi;
  document.getElementById('actualizado').textContent = new Date(r.generado).toLocaleTimeString('es-CL');

  document.getElementById('kpis').innerHTML =
    kpi('Ventas hoy', clp(k.ventas_hoy), 'pedidos no cancelados') +
    kpi('Ventas 30 días', millones(k.ventas_30d), `${k.pedidos_30d} pedidos · ticket ${clp(k.ticket_promedio)}`) +
    kpi('Por despachar', k.pedidos_por_despachar, 'pendientes, confirmados o en preparación') +
    kpi('Camiones en ruta', k.camiones_en_ruta, `${k.lecturas_24h} lecturas IoT en 24 h`) +
    kpi('Alertas de frío 24 h', k.alertas_24h, 'lecturas fuera de rango', k.alertas_24h > 0) +
    kpi('Pedidos en riesgo', k.pedidos_en_riesgo, `${clp(k.monto_en_riesgo)} comprometidos`, k.pedidos_en_riesgo > 0);

  // Ventas diarias B2B vs B2C (barras apiladas: suman el total del día).
  const dias = [];
  for (let i = 13; i >= 0; i--) dias.push(new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10));
  const serie = (seg) => dias.map((d) => Number(r.ventasDia.find((v) => String(v.dia).slice(0, 10) === d && v.segmento === seg)?.total || 0));
  grafico('g-ventas', {
    type: 'bar',
    data: { labels: dias.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7)),
      datasets: [{ label: 'B2B', data: serie('B2B'), backgroundColor: COLOR_B2B }, { label: 'B2C', data: serie('B2C'), backgroundColor: COLOR_B2C }] },
    options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: millones } } },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${clp(c.raw)}` } } } },
  });

  // Alertas por camión.
  grafico('g-alertas', {
    type: 'bar',
    data: { labels: r.alertasCamion.map((a) => a.camion_id),
      datasets: [{ label: 'Lecturas con alerta', data: r.alertasCamion.map((a) => a.alertas), backgroundColor: r.alertasCamion.map((a) => (a.alertas ? ROJO : '#c7cdd2')) }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  });

  // Pedidos por canal y segmento.
  const combos = [['WEB', 'B2B'], ['WEB', 'B2C'], ['CRM', 'B2B'], ['CRM', 'B2C']];
  const canal = combos.map(([c, s]) => r.canales.find((x) => x.canal === c && x.segmento === s)?.pedidos || 0);
  grafico('g-canal', {
    type: 'bar',
    data: { labels: combos.map(([c, s]) => `${c} · ${s}`), datasets: [{ data: canal, backgroundColor: combos.map(([, s]) => (s === 'B2B' ? COLOR_B2B : COLOR_B2C)) }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } },
  });

  grafico('g-pipeline', {
    type: 'bar',
    data: { labels: r.pipeline.map((p) => p.etapa),
      datasets: [{ data: r.pipeline.map((p) => p.monto), backgroundColor: r.pipeline.map((p) => (p.etapa === 'Ganado' ? '#2a9d8f' : p.etapa === 'Perdido' ? '#c7cdd2' : COLOR_B2B)) }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => clp(c.raw) } } },
      scales: { x: { ticks: { callback: millones } }, y: { grid: { display: false } } } },
  });

  grafico('g-top', {
    type: 'bar',
    data: { labels: r.topProductos.map((p) => p.nombre), datasets: [{ data: r.topProductos.map((p) => p.total), backgroundColor: COLOR_B2B }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => clp(c.raw) } } },
      scales: { x: { ticks: { callback: millones } }, y: { grid: { display: false } } } },
  });

  // Temperatura por camión (eje X = hora).
  const camiones = [...new Set(r.temperaturas.map((t) => t.camion_id))];
  grafico('g-temp', {
    type: 'line',
    data: { datasets: camiones.map((c, i) => ({
      label: c, borderColor: COLORES[i % COLORES.length], backgroundColor: COLORES[i % COLORES.length], pointRadius: 0, borderWidth: 1.5, tension: 0.2,
      data: r.temperaturas.filter((t) => t.camion_id === c).map((t) => ({ x: new Date(t.fecha_hora).getTime(), y: t.temp_camara })),
    })) },
    options: { maintainAspectRatio: false, animation: false, interaction: { mode: 'nearest', intersect: false },
      scales: { x: { type: 'linear', ticks: { callback: (v) => new Date(v).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }), maxTicksLimit: 6 } },
        y: { title: { display: true, text: '°C' } } } },
  });

  // Tabla de cruce comercial-operativo.
  document.getElementById('tabla-riesgo').innerHTML = r.enRiesgo.length
    ? `<thead><tr><th>Pedido</th><th>Cliente</th><th>Segmento</th><th class="text-end">Monto</th><th>Camión</th><th>Temp. máx. registrada</th><th>Límite</th><th>Última alerta</th></tr></thead>
       <tbody>${r.enRiesgo.map((p) => `<tr><td>#${p.id_pedido}</td><td>${esc(p.cliente)}</td><td>${p.segmento}</td><td class="text-end">${clp(p.total)}</td>
       <td>${p.camion_id}</td><td class="text-danger fw-semibold">${p.temp_max_registrada} °C</td><td>${p.temp_limite} °C</td><td>${fecha(p.ultima_alerta)}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="text-success">Sin pedidos en riesgo en la última hora.</td></tr></tbody>';

  // Mapa de flota.
  if (!mapa) {
    mapa = L.map('mapa').setView([-38.74, -72.6], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(mapa);
  }
  for (const c of flota) {
    const alerta = !!c.alerta_ruptura_frio;
    const html = `<div style="background:${alerta ? ROJO : '#0b4f6c'};color:#fff;border-radius:12px;padding:2px 6px;font-size:11px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.4)" class="${alerta ? 'pulso' : ''}">🚚 ${c.camion_id} · ${Number(c.temp_camara).toFixed(1)}°</div>`;
    const icono = L.divIcon({ html, className: '', iconSize: [96, 20], iconAnchor: [48, 10] });
    const popup = `<b>${c.camion_id}</b> (${esc(c.patente)})<br>${esc(c.conductor || 'sin despacho')} · ${c.perfil_frio || ''}<br>
      Temp: <b>${c.temp_camara} °C</b> ${c.temp_min != null ? `(rango ${c.temp_min} a ${c.temp_max})` : ''}<br>
      Combustible: ${c.combustible_pct}%<br>${fecha(c.fecha_hora)}`;
    if (marcadores[c.camion_id]) {
      marcadores[c.camion_id].setLatLng([c.lat, c.lng]).setIcon(icono).setPopupContent(popup);
    } else {
      marcadores[c.camion_id] = L.marker([c.lat, c.lng], { icon: icono }).addTo(mapa).bindPopup(popup);
    }
  }
}

if (exigirRol('ADMIN', 'VENDEDOR', 'DESPACHADOR')) {
  renderNav('bi');
  const ciclo = () => actualizar().catch((e) => console.error(e));
  ciclo();
  setInterval(ciclo, 5000);
}
