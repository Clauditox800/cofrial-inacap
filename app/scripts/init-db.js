// Crea el esquema y carga datos de demostración.
// Uso: npm run db:init   (BORRA y vuelve a crear todas las tablas)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const PASSWORD_DEMO = 'Cofrial2026';

// Generador pseudoaleatorio con semilla: los datos de prueba salen iguales en cada carga.
let semilla = 20261104;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const elegir = (arr) => arr[Math.floor(azar() * arr.length)];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    multipleStatements: true, timezone: 'Z',
  });
  const archivoEsquema = [
    path.join(__dirname, '..', '..', 'database', 'schema.sql'),
    path.join(__dirname, '..', 'database', 'schema.sql'),
  ].find((f) => fs.existsSync(f));
  if (!archivoEsquema) throw new Error('No se encontró database/schema.sql');
  console.log('Creando esquema desde', archivoEsquema);
  await conn.query(fs.readFileSync(archivoEsquema, 'utf8'));
  await conn.query(`USE \`${process.env.DB_NAME || 'cofrial'}\``);

  const ins = async (tabla, filas) => {
    if (!filas.length) return;
    const cols = Object.keys(filas[0]);
    await conn.query(`INSERT INTO ${tabla} (${cols.join(',')}) VALUES ?`, [filas.map((f) => cols.map((c) => f[c]))]);
  };

  // ---------- Catálogos base ----------
  await ins('rol', [
    { id_rol: 1, nombre: 'ADMIN' }, { id_rol: 2, nombre: 'VENDEDOR' }, { id_rol: 3, nombre: 'DESPACHADOR' },
    { id_rol: 4, nombre: 'CLIENTE_B2B' }, { id_rol: 5, nombre: 'CLIENTE_B2C' },
  ]);
  await ins('lista_precio', [
    { id_lista_precio: 1, nombre: 'Convenio Salud', descuento_pct: 12 },
    { id_lista_precio: 2, nombre: 'Convenio Retail', descuento_pct: 8 },
    { id_lista_precio: 3, nombre: 'Convenio Casinos', descuento_pct: 10 },
  ]);
  await ins('region', [{ id_region: 9, nombre: 'La Araucanía' }]);
  const comunas = [
    ['Temuco', -38.7397, -72.5984], ['Padre Las Casas', -38.7656, -72.5953], ['Villarrica', -39.2857, -72.2279],
    ['Pucón', -39.2724, -71.9776], ['Angol', -37.7959, -72.7164], ['Victoria', -38.2329, -72.3328],
    ['Lautaro', -38.5297, -72.4363], ['Nueva Imperial', -38.7447, -72.9505], ['Pitrufquén', -38.9853, -72.6436],
    ['Carahue', -38.7111, -73.1647],
  ];
  await ins('comuna', comunas.map(([nombre], i) => ({ id_comuna: i + 1, nombre, id_region: 9 })));
  await ins('perfil_frio', [
    { id_perfil_frio: 1, nombre: 'CONGELADO', temp_min: -25, temp_max: -15 },
    { id_perfil_frio: 2, nombre: 'REFRIGERADO', temp_min: 0, temp_max: 5 },
  ]);
  await ins('categoria', [
    { id_categoria: 1, nombre: 'Vacuno congelado', id_perfil_frio: 1 },
    { id_categoria: 2, nombre: 'Cerdo y aves congelados', id_perfil_frio: 1 },
    { id_categoria: 3, nombre: 'Pescados y mariscos', id_perfil_frio: 1 },
    { id_categoria: 4, nombre: 'Carnes frescas', id_perfil_frio: 2 },
    { id_categoria: 5, nombre: 'Lácteos y quesos', id_perfil_frio: 2 },
    { id_categoria: 6, nombre: 'Cecinas', id_perfil_frio: 2 },
  ]);
  const productos = [
    ['VAC-001', 'Lomo vetado congelado', 'Corte premium envasado al vacío, caja de 10 kg aprox.', 'kg', 12990, 1, '🥩'],
    ['VAC-002', 'Posta negra congelada', 'Ideal para guisos y cazuelas institucionales.', 'kg', 8990, 1, '🥩'],
    ['VAC-003', 'Carne molida 10% grasa', 'Bolsa de 1 kg, congelado IQF.', 'kg', 6490, 1, '🥩'],
    ['AVE-001', 'Pollo entero congelado', 'Pollo nacional de 2,2 kg promedio.', 'kg', 3490, 2, '🍗'],
    ['AVE-002', 'Pechuga de pollo deshuesada', 'Caja de 10 kg, porciones IQF.', 'kg', 5990, 2, '🍗'],
    ['CER-001', 'Chuleta de cerdo congelada', 'Corte centro, caja de 10 kg.', 'kg', 5490, 2, '🥓'],
    ['PES-001', 'Salmón filete congelado', 'Salmón del sur de Chile, filete con piel.', 'kg', 15990, 3, '🐟'],
    ['PES-002', 'Merluza austral en filete', 'Filete sin espinas, bloque de 5 kg.', 'kg', 7990, 3, '🐟'],
    ['PES-003', 'Chorito cocido congelado', 'Bolsa de 1 kg, sin concha.', 'kg', 4290, 3, '🦪'],
    ['FRE-001', 'Asado de tira fresco', 'Vacuno nacional, cadena de frío 0-5 °C.', 'kg', 9990, 4, '🥩'],
    ['FRE-002', 'Trutro de pollo fresco', 'Bandeja de 1 kg.', 'kg', 3290, 4, '🍗'],
    ['FRE-003', 'Costillar de cerdo fresco', 'Pieza entera de 2 kg aprox.', 'kg', 6990, 4, '🥓'],
    ['LAC-001', 'Queso gouda laminado', 'Formato institucional de 1 kg.', 'kg', 8990, 5, '🧀'],
    ['LAC-002', 'Leche entera 1 L', 'Caja de 12 unidades.', 'caja', 11490, 5, '🥛'],
    ['LAC-003', 'Yogurt natural 1 kg', 'Pote familiar.', 'unidad', 2490, 5, '🥛'],
    ['CEC-001', 'Jamón de pierna laminado', 'Paquete de 1 kg.', 'kg', 7490, 6, '🥪'],
    ['CEC-002', 'Longaniza artesanal', 'Paquete de 1 kg, receta sureña.', 'kg', 5990, 6, '🌭'],
    ['CEC-003', 'Vienesas de ave', 'Paquete de 20 unidades.', 'unidad', 2990, 6, '🌭'],
  ];
  await ins('producto', productos.map(([sku, nombre, descripcion, unidad, precio, cat, icono], i) => ({
    id_producto: i + 1, sku, nombre, descripcion, unidad, precio_lista: precio, stock: entre(300, 2000),
    imagen_url: icono, id_categoria: cat,
  })));
  // Precios pactados del convenio de salud (mejor que el descuento general en productos clave).
  await ins('precio_especial', [
    { id_lista_precio: 1, id_producto: 1, precio: 11490 },
    { id_lista_precio: 1, id_producto: 4, precio: 3190 },
    { id_lista_precio: 1, id_producto: 13, precio: 8290 },
    { id_lista_precio: 2, id_producto: 7, precio: 14490 },
  ]);

  // ---------- Usuarios internos ----------
  const hash = await bcrypt.hash(PASSWORD_DEMO, 10);
  await ins('usuario', [
    { id_usuario: 1, email: 'admin@cofrial.cl', password_hash: hash, nombre: 'Gerencia Cofrial', id_rol: 1, id_cliente: null },
    { id_usuario: 2, email: 'vendedor@cofrial.cl', password_hash: hash, nombre: 'Camila Rojas', id_rol: 2, id_cliente: null },
    { id_usuario: 3, email: 'vendedor2@cofrial.cl', password_hash: hash, nombre: 'Diego Muñoz', id_rol: 2, id_cliente: null },
    { id_usuario: 4, email: 'despacho@cofrial.cl', password_hash: hash, nombre: 'Jorge Paillalef', id_rol: 3, id_cliente: null },
  ]);

  // ---------- Clientes (datos ficticios) ----------
  const clientes = [
    // segmento, rut, nombre, email, lista, vendedor, prospecto, comuna
    ['B2B', '76.111.111-1', 'Hospital Clínico del Sur', 'compras@hospitalsur.cl', 1, 2, false, 1],
    ['B2B', '76.222.222-2', 'Supermercados Los Aromos', 'compras@losaromos.cl', 2, 2, false, 3],
    ['B2B', '76.333.333-3', 'Casino Industrial Ñielol', 'abastecimiento@casinonielol.cl', 3, 3, false, 1],
    ['B2B', '76.444.444-4', 'Clínica Los Volcanes', 'compras@clinicavolcanes.cl', 1, 3, false, 4],
    ['B2B', '76.555.555-5', 'Distribuidora Feria Cautín', 'pedidos@feriacautin.cl', 2, 2, false, 2],
    ['B2B', '76.666.666-6', 'Colegio Bicentenario Malleco', 'administracion@cbmalleco.cl', 3, 3, true, 5],
    ['B2B', '76.777.777-7', 'Restaurante Fogón del Sur', 'contacto@fogondelsur.cl', null, 2, true, 7],
    ['B2C', '12.345.678-5', 'María González', 'maria.gonzalez@correo.cl', null, null, false, 1],
    ['B2C', '13.456.789-6', 'Pedro Soto', 'pedro.soto@correo.cl', null, null, false, 2],
    ['B2C', '14.567.890-7', 'Ana Huenchul', 'ana.huenchul@correo.cl', null, null, false, 9],
  ];
  await ins('cliente', clientes.map(([segmento, rut, nombre, email, lista, vend, prosp], i) => ({
    id_cliente: i + 1, segmento, rut, nombre, email, telefono: `+56 9 ${entre(5000, 9999)} ${entre(1000, 9999)}`,
    es_prospecto: prosp, id_lista_precio: lista, id_vendedor: vend,
  })));
  const calles = ['Av. Alemania', 'Av. Caupolicán', 'Calle Prat', 'Av. San Martín', 'Calle Bulnes', 'Av. Pedro de Valdivia', 'Calle Lagos'];
  await ins('direccion', clientes.map((c, i) => {
    const [, lat, lng] = comunas[c[7] - 1];
    return { id_direccion: i + 1, id_cliente: i + 1, calle: elegir(calles), numero: String(entre(100, 2500)),
      id_comuna: c[7], lat: lat + (azar() - 0.5) * 0.02, lng: lng + (azar() - 0.5) * 0.02 };
  }));
  // Cuentas del portal: 2 B2B y 1 B2C.
  await ins('usuario', [
    { email: 'compras@hospitalsur.cl', password_hash: hash, nombre: 'Hospital Clínico del Sur', id_rol: 4, id_cliente: 1 },
    { email: 'compras@losaromos.cl', password_hash: hash, nombre: 'Supermercados Los Aromos', id_rol: 4, id_cliente: 2 },
    { email: 'maria.gonzalez@correo.cl', password_hash: hash, nombre: 'María González', id_rol: 5, id_cliente: 8 },
  ]);

  // ---------- Pedidos históricos (30 días) ----------
  const precioPara = (idCli, idProd) => {
    const lista = clientes[idCli - 1][4];
    const base = productos[idProd - 1][4];
    if (!lista) return base;
    const especial = { '1-1': 11490, '1-4': 3190, '1-13': 8290, '2-7': 14490 }[`${lista}-${idProd}`];
    const desc = { 1: 12, 2: 8, 3: 10 }[lista];
    return especial || Math.round(base * (1 - desc / 100));
  };
  const compradores = [1, 2, 3, 4, 5, 8, 9, 10];
  const ahora = Date.now();
  const flujo = ['PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'DESPACHADO', 'ENTREGADO'];
  let idPedido = 0;
  const pedidos = [], detalles = [], historial = [];
  const nuevoPedido = (idCli, fecha, estadoFinal, canal) => {
    idPedido += 1;
    pedidos.push({ id_pedido: idPedido, id_cliente: idCli, id_direccion: idCli, canal, estado: estadoFinal, fecha });
    const b2b = clientes[idCli - 1][0] === 'B2B';
    const usados = new Set();
    for (let k = 0; k < entre(1, 4); k++) {
      const prod = entre(1, productos.length);
      if (usados.has(prod)) continue;
      usados.add(prod);
      detalles.push({ id_pedido: idPedido, id_producto: prod, cantidad: b2b ? entre(10, 80) : entre(1, 5), precio_unitario: precioPara(idCli, prod) });
    }
    const pasos = estadoFinal === 'CANCELADO' ? ['PENDIENTE', 'CANCELADO'] : flujo.slice(0, flujo.indexOf(estadoFinal) + 1);
    pasos.forEach((estado, j) => historial.push({
      id_pedido: idPedido, estado, fecha: new Date(fecha.getTime() + j * 3 * 3600e3), id_usuario: j === 0 ? null : 2,
      comentario: j === 0 ? `Pedido creado por canal ${canal}` : null,
    }));
    return idPedido;
  };
  for (let n = 0; n < 80; n++) {
    const dias = azar() * 30;
    const fecha = new Date(ahora - dias * 86400e3);
    const idCli = elegir(compradores);
    const canal = clientes[idCli - 1][0] === 'B2B' && azar() < 0.35 ? 'CRM' : 'WEB';
    let estado = 'ENTREGADO';
    if (azar() < 0.06) estado = 'CANCELADO';
    else if (dias < 1) estado = elegir(['PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION']);
    nuevoPedido(idCli, fecha, estado, canal);
  }
  // Pedidos listos para que el despachador arme un despacho en la demo.
  for (let n = 0; n < 4; n++) nuevoPedido(elegir([1, 2, 3, 4, 5]), new Date(ahora - entre(2, 6) * 3600e3), 'EN_PREPARACION', 'WEB');

  // ---------- Flota: 50 camiones, 8 conductores ----------
  await ins('camion', Array.from({ length: 50 }, (_, i) => ({
    id_camion: i + 1, codigo: `CAM-${String(i + 1).padStart(3, '0')}`,
    patente: `${elegir(['KHTR', 'LBPS', 'JXWZ', 'HGFD', 'RTKL'])}${String(10 + i).padStart(2, '0')}`,
    capacidad_kg: elegir([3500, 5000, 8000]),
  })));
  const conductores = ['Luis Catrileo', 'Carlos Painemal', 'Rodrigo Fuentes', 'Héctor Millapán', 'Francisco Vera', 'Patricio Lagos', 'Manuel Ancamil', 'Sergio Toledo'];
  await ins('conductor', conductores.map((nombre, i) => ({ id_conductor: i + 1, rut: `${10 + i}.${entre(100, 999)}.${entre(100, 999)}-${entre(1, 9)}`, nombre, telefono: `+56 9 ${entre(5000, 9999)} ${entre(1000, 9999)}` })));

  // 5 despachos en ruta (los 5 camiones que simula Docker): 3 congelados y 2 refrigerados, 2 pedidos cada uno.
  const despachos = [], despachoPedidos = [];
  for (let i = 1; i <= 5; i++) {
    const salida = new Date(ahora - entre(1, 3) * 3600e3);
    despachos.push({ id_despacho: i, id_camion: i, id_conductor: i, id_perfil_frio: i <= 3 ? 1 : 2, estado: 'EN_RUTA', fecha_salida: salida });
    for (let k = 0; k < 2; k++) {
      const idp = nuevoPedido(elegir([1, 2, 3, 4, 5]), new Date(salida.getTime() - 12 * 3600e3), 'DESPACHADO', 'WEB');
      despachoPedidos.push({ id_despacho: i, id_pedido: idp });
    }
  }
  await ins('pedido', pedidos);
  await ins('detalle_pedido', detalles);
  await ins('historial_pedido', historial);
  await ins('despacho', despachos);
  await ins('despacho_pedido', despachoPedidos);

  // Telemetría de las últimas 24 h (una lectura cada 10 min por camión), con algunos episodios de ruptura.
  const lecturas = [];
  const base = [[-38.7397, -72.5984], [-38.7397, -72.5984], [-38.7397, -72.5984], [-38.7397, -72.5984], [-38.7397, -72.5984]];
  for (let i = 1; i <= 5; i++) {
    const congelado = i <= 3;
    const despacho = despachos[i - 1];
    for (let m = 24 * 60; m > 0; m -= 10) {
      const fecha = new Date(ahora - m * 60e3);
      const falla = (i === 2 && m < 300 && m > 240) || (i === 5 && m < 900 && m > 860);
      const temp = congelado ? (falla ? -12 + azar() * 3 : -19 + azar() * 3) : (falla ? 6.5 + azar() * 2 : 2 + azar() * 2);
      const enRuta = fecha >= despacho.fecha_salida;
      lecturas.push({
        id_camion: i, id_despacho: enRuta ? i : null, fecha_hora: fecha, temp_camara: Number(temp.toFixed(2)),
        lat: base[i - 1][0] + (azar() - 0.5) * 0.3, lng: base[i - 1][1] + (azar() - 0.5) * 0.3,
        combustible_pct: Math.max(15, 95 - Math.floor((24 * 60 - m) / 25)), alerta_ruptura_frio: falla,
      });
    }
  }
  await ins('lectura_telemetria', lecturas);

  // ---------- CRM ----------
  await ins('etapa_pipeline', [
    { id_etapa: 1, nombre: 'Prospecto', orden: 1, es_cierre: false },
    { id_etapa: 2, nombre: 'Contactado', orden: 2, es_cierre: false },
    { id_etapa: 3, nombre: 'Cotización enviada', orden: 3, es_cierre: false },
    { id_etapa: 4, nombre: 'Negociación', orden: 4, es_cierre: false },
    { id_etapa: 5, nombre: 'Ganado', orden: 5, es_cierre: true },
    { id_etapa: 6, nombre: 'Perdido', orden: 6, es_cierre: true },
  ]);
  await ins('oportunidad', [
    { id_cliente: 6, id_vendedor: 3, id_etapa: 1, titulo: 'Abastecimiento casino escolar 2027', monto_estimado: 1200000 },
    { id_cliente: 7, id_vendedor: 2, id_etapa: 2, titulo: 'Proveedor de carnes para parrilla', monto_estimado: 900000 },
    { id_cliente: 4, id_vendedor: 3, id_etapa: 3, titulo: 'Ampliación convenio Clínica Los Volcanes', monto_estimado: 3500000 },
    { id_cliente: 2, id_vendedor: 2, id_etapa: 4, titulo: 'Pescados para 3 sucursales', monto_estimado: 5200000 },
    { id_cliente: 1, id_vendedor: 2, id_etapa: 5, titulo: 'Convenio anual Hospital Clínico del Sur', monto_estimado: 8100000 },
    { id_cliente: 3, id_vendedor: 3, id_etapa: 5, titulo: 'Menú semanal casino industrial', monto_estimado: 2400000 },
    { id_cliente: 5, id_vendedor: 2, id_etapa: 6, titulo: 'Lácteos para feria', monto_estimado: 700000 },
  ]);
  await ins('interaccion', [
    { id_cliente: 6, id_usuario: 3, tipo: 'LLAMADA', descripcion: 'Primer contacto con administración. Piden catálogo y precios por volumen.' },
    { id_cliente: 7, id_usuario: 2, tipo: 'VISITA', descripcion: 'Visita al local. Interés en asado de tira y longaniza.' },
    { id_cliente: 4, id_usuario: 3, tipo: 'CORREO', descripcion: 'Se envía cotización con 12% de descuento.' },
    { id_cliente: 2, id_usuario: 2, tipo: 'REUNION', descripcion: 'Negociación de despacho a 3 sucursales con frecuencia semanal.' },
  ]);
  await ins('requerimiento', [
    { id_cliente: 1, nombre_contacto: 'Unidad de Alimentación', email_contacto: 'compras@hospitalsur.cl', mensaje: 'El pedido de ayer llegó con el pollo blando, parece descongelado. Necesitamos reposición urgente para los pacientes.', categoria_ia: 'RECLAMO', prioridad_ia: 'ALTA', respuesta_sugerida: 'Lamentamos lo ocurrido. Revisaremos el registro de temperatura de su despacho y un ejecutivo lo contactará hoy para gestionar la reposición.', motor_ia: 'reglas' },
    { id_cliente: null, nombre_contacto: 'Javiera Cárcamo', email_contacto: 'jcarcamo@correo.cl', mensaje: 'Quisiera cotizar 200 kg mensuales de posta negra para un restaurante en Pucón.', categoria_ia: 'COTIZACION', prioridad_ia: 'MEDIA', respuesta_sugerida: 'Gracias por su interés. Un ejecutivo comercial le enviará una cotización con precios por volumen en las próximas 24 horas.', motor_ia: 'reglas' },
    { id_cliente: 9, nombre_contacto: 'Pedro Soto', email_contacto: 'pedro.soto@correo.cl', mensaje: '¿Hacen despacho a Padre Las Casas los fines de semana?', categoria_ia: 'CONSULTA', prioridad_ia: 'BAJA', respuesta_sugerida: 'Gracias por escribirnos. Un ejecutivo responderá su consulta a la brevedad.', motor_ia: 'reglas' },
  ]);

  await conn.end();
  console.log(`Base cargada: ${productos.length} productos, ${clientes.length} clientes, ${pedidos.length} pedidos, ${lecturas.length} lecturas IoT.`);
  console.log(`Usuarios de prueba (contraseña ${PASSWORD_DEMO}): admin@cofrial.cl, vendedor@cofrial.cl, despacho@cofrial.cl, compras@hospitalsur.cl (B2B), maria.gonzalez@correo.cl (B2C)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
