const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, transaccion } = require('../db');
const { requiere, ROLES, STAFF } = require('../auth');
const { crearPedido, cambiarEstado, httpError } = require('./pedidos');
const { clasificarRequerimiento } = require('../services/ia');

const router = express.Router();
router.use(requiere(...STAFF));
const comercial = requiere('ADMIN', 'VENDEDOR');
const logistica = requiere('ADMIN', 'DESPACHADOR');

// ---------- Tablas de apoyo para los formularios ----------
router.get('/catalogos', async (_req, res) => {
  const q = (sql) => pool.query(sql).then(([r]) => r);
  const [listas, vendedores, etapas, camiones, conductores, perfiles, comunas] = await Promise.all([
    q('SELECT id_lista_precio, nombre, descuento_pct FROM lista_precio ORDER BY nombre'),
    q(`SELECT u.id_usuario, u.nombre FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
        WHERE r.nombre IN ('VENDEDOR','ADMIN') AND u.activo ORDER BY u.nombre`),
    q('SELECT id_etapa, nombre, orden, es_cierre FROM etapa_pipeline ORDER BY orden'),
    q(`SELECT c.id_camion, c.codigo, c.patente,
              EXISTS (SELECT 1 FROM despacho d WHERE d.id_camion = c.id_camion AND d.estado = 'EN_RUTA') AS en_ruta
         FROM camion c WHERE c.activo ORDER BY c.codigo`),
    q('SELECT id_conductor, nombre FROM conductor ORDER BY nombre'),
    q('SELECT id_perfil_frio, nombre, temp_min, temp_max FROM perfil_frio'),
    q('SELECT id_comuna, nombre FROM comuna ORDER BY nombre'),
  ]);
  res.json({ listas, vendedores, etapas, camiones, conductores, perfiles, comunas });
});

// ---------- Clientes y prospectos ----------
router.get('/clientes', async (req, res) => {
  const params = [];
  let filtro = '';
  if (req.query.q) {
    filtro = 'WHERE c.nombre LIKE ? OR c.rut LIKE ? OR c.email LIKE ?';
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
  }
  const [rows] = await pool.query(
    `SELECT c.id_cliente, c.segmento, c.rut, c.nombre, c.email, c.telefono, c.es_prospecto,
            l.nombre AS lista, u.nombre AS vendedor,
            (SELECT COUNT(*) FROM pedido p WHERE p.id_cliente = c.id_cliente AND p.estado <> 'CANCELADO') AS pedidos,
            (SELECT COALESCE(SUM(v.total), 0) FROM v_pedido_total v WHERE v.id_cliente = c.id_cliente AND v.estado <> 'CANCELADO') AS total_compras,
            (SELECT MAX(p.fecha) FROM pedido p WHERE p.id_cliente = c.id_cliente) AS ultima_compra
       FROM cliente c
       LEFT JOIN lista_precio l ON l.id_lista_precio = c.id_lista_precio
       LEFT JOIN usuario u      ON u.id_usuario = c.id_vendedor
       ${filtro}
      ORDER BY c.nombre`, params);
  res.json(rows);
});

router.post('/clientes', comercial, async (req, res) => {
  const b = req.body || {};
  if (!b.nombre || !b.rut || !b.email || !['B2B', 'B2C'].includes(b.segmento)) {
    return res.status(400).json({ error: 'Completa segmento, RUT, nombre y correo' });
  }
  try {
    const id = await transaccion(async (c) => {
      const [r] = await c.query(
        `INSERT INTO cliente (segmento, rut, nombre, email, telefono, es_prospecto, id_lista_precio, id_vendedor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [b.segmento, b.rut, b.nombre, b.email.toLowerCase(), b.telefono || null, b.es_prospecto !== false,
          b.segmento === 'B2B' ? b.id_lista_precio || null : null, b.id_vendedor || req.usuario.id]);
      if (b.direccion?.calle && b.direccion?.id_comuna) {
        await c.query('INSERT INTO direccion (id_cliente, calle, numero, id_comuna) VALUES (?, ?, ?, ?)',
          [r.insertId, b.direccion.calle, b.direccion.numero || 'S/N', b.direccion.id_comuna]);
      }
      // Todo cliente nuevo entra al pipeline como prospecto.
      if (b.es_prospecto !== false) {
        await c.query(`INSERT INTO oportunidad (id_cliente, id_vendedor, id_etapa, titulo, monto_estimado) VALUES (?, ?, 1, ?, ?)`,
          [r.insertId, b.id_vendedor || req.usuario.id, b.oportunidad || `Primer pedido de ${b.nombre}`, Number(b.monto_estimado) || 0]);
      }
      return r.insertId;
    });
    res.status(201).json({ id_cliente: id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un cliente con ese RUT' });
    throw err;
  }
});

router.get('/clientes/:id', async (req, res) => {
  const id = Number(req.params.id);
  const [[cliente]] = await pool.query(
    `SELECT c.*, l.nombre AS lista, u.nombre AS vendedor,
            (SELECT email FROM usuario WHERE id_cliente = c.id_cliente LIMIT 1) AS acceso_portal
       FROM cliente c LEFT JOIN lista_precio l ON l.id_lista_precio = c.id_lista_precio
       LEFT JOIN usuario u ON u.id_usuario = c.id_vendedor WHERE c.id_cliente = ?`, [id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  const q = (sql) => pool.query(sql, [id]).then(([r]) => r);
  const [direcciones, pedidos, oportunidades, interacciones, requerimientos] = await Promise.all([
    q(`SELECT d.id_direccion, d.calle, d.numero, co.nombre AS comuna FROM direccion d
         JOIN comuna co ON co.id_comuna = d.id_comuna WHERE d.id_cliente = ?`),
    q('SELECT id_pedido, canal, estado, fecha, total FROM v_pedido_total WHERE id_cliente = ? ORDER BY fecha DESC LIMIT 20'),
    q(`SELECT o.id_oportunidad, o.titulo, o.monto_estimado, e.nombre AS etapa FROM oportunidad o
         JOIN etapa_pipeline e ON e.id_etapa = o.id_etapa WHERE o.id_cliente = ? ORDER BY o.fecha_creacion DESC`),
    q(`SELECT i.tipo, i.descripcion, i.fecha, u.nombre AS usuario FROM interaccion i
         JOIN usuario u ON u.id_usuario = i.id_usuario WHERE i.id_cliente = ? ORDER BY i.fecha DESC`),
    q(`SELECT id_requerimiento, mensaje, categoria_ia, prioridad_ia, estado, fecha FROM requerimiento
        WHERE id_cliente = ? ORDER BY fecha DESC`),
  ]);
  res.json({ ...cliente, direcciones, pedidos, oportunidades, interacciones, requerimientos });
});

router.post('/clientes/:id/interacciones', async (req, res) => {
  const { tipo, descripcion } = req.body || {};
  if (!tipo || !descripcion) return res.status(400).json({ error: 'Indica tipo y descripción' });
  await pool.query('INSERT INTO interaccion (id_cliente, id_usuario, tipo, descripcion) VALUES (?, ?, ?, ?)',
    [Number(req.params.id), req.usuario.id, tipo, descripcion]);
  res.status(201).json({ ok: true });
});

// Crea la cuenta del portal para un cliente (así se habilitan los B2B).
router.post('/clientes/:id/acceso', comercial, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6) return res.status(400).json({ error: 'Correo y contraseña (mín. 6) requeridos' });
  const [[c]] = await pool.query('SELECT segmento, nombre FROM cliente WHERE id_cliente = ?', [Number(req.params.id)]);
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
  try {
    await pool.query('INSERT INTO usuario (email, password_hash, nombre, id_rol, id_cliente) VALUES (?, ?, ?, ?, ?)',
      [email.toLowerCase(), await bcrypt.hash(password, 10), c.nombre,
        c.segmento === 'B2B' ? ROLES.CLIENTE_B2B : ROLES.CLIENTE_B2C, Number(req.params.id)]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese correo ya tiene una cuenta' });
    throw err;
  }
  res.status(201).json({ ok: true });
});

// ---------- Pipeline comercial ----------
router.get('/oportunidades', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT o.id_oportunidad, o.titulo, o.monto_estimado, o.id_etapa, o.fecha_creacion, o.fecha_cierre,
            c.id_cliente, c.nombre AS cliente, c.segmento, u.nombre AS vendedor
       FROM oportunidad o JOIN cliente c ON c.id_cliente = o.id_cliente
       JOIN usuario u ON u.id_usuario = o.id_vendedor
      ORDER BY o.fecha_creacion DESC`);
  res.json(rows);
});

router.post('/oportunidades', comercial, async (req, res) => {
  const { id_cliente, titulo, monto_estimado } = req.body || {};
  if (!id_cliente || !titulo) return res.status(400).json({ error: 'Cliente y título requeridos' });
  const [r] = await pool.query('INSERT INTO oportunidad (id_cliente, id_vendedor, id_etapa, titulo, monto_estimado) VALUES (?, ?, 1, ?, ?)',
    [id_cliente, req.usuario.id, titulo, Number(monto_estimado) || 0]);
  res.status(201).json({ id_oportunidad: r.insertId });
});

router.patch('/oportunidades/:id', comercial, async (req, res) => {
  const idEtapa = Number(req.body?.id_etapa);
  const [[etapa]] = await pool.query('SELECT nombre, es_cierre FROM etapa_pipeline WHERE id_etapa = ?', [idEtapa]);
  if (!etapa) return res.status(400).json({ error: 'Etapa inválida' });
  await transaccion(async (c) => {
    await c.query('UPDATE oportunidad SET id_etapa = ?, fecha_cierre = IF(?, CURDATE(), NULL) WHERE id_oportunidad = ?',
      [idEtapa, etapa.es_cierre, Number(req.params.id)]);
    const [[op]] = await c.query('SELECT id_cliente, titulo FROM oportunidad WHERE id_oportunidad = ?', [Number(req.params.id)]);
    if (!op) throw httpError(404, 'Oportunidad no encontrada');
    // Al ganar, el prospecto pasa a cliente. Cada movimiento queda como interacción.
    if (etapa.nombre === 'Ganado') await c.query('UPDATE cliente SET es_prospecto = FALSE WHERE id_cliente = ?', [op.id_cliente]);
    await c.query(`INSERT INTO interaccion (id_cliente, id_usuario, tipo, descripcion) VALUES (?, ?, 'NOTA', ?)`,
      [op.id_cliente, req.usuario.id, `Oportunidad "${op.titulo}" movida a ${etapa.nombre}`]);
  });
  res.json({ ok: true });
});

// ---------- Pedidos ----------
router.get('/pedidos', async (req, res) => {
  const params = [];
  let filtro = '';
  if (req.query.estado) { filtro = 'WHERE v.estado = ?'; params.push(req.query.estado); }
  const [rows] = await pool.query(
    `SELECT v.id_pedido, v.canal, v.estado, v.fecha, v.total, v.segmento, c.id_cliente, c.nombre AS cliente,
            CONCAT(d.calle, ' ', d.numero, ', ', co.nombre) AS direccion,
            (SELECT dp.id_despacho FROM despacho_pedido dp WHERE dp.id_pedido = v.id_pedido LIMIT 1) AS id_despacho
       FROM v_pedido_total v
       JOIN cliente c   ON c.id_cliente = v.id_cliente
       JOIN pedido p    ON p.id_pedido = v.id_pedido
       JOIN direccion d ON d.id_direccion = p.id_direccion
       JOIN comuna co   ON co.id_comuna = d.id_comuna
       ${filtro}
      ORDER BY v.fecha DESC LIMIT 200`, params);
  res.json(rows);
});

router.get('/pedidos/:id', async (req, res) => {
  const id = Number(req.params.id);
  const [[p]] = await pool.query('SELECT v.*, c.nombre AS cliente FROM v_pedido_total v JOIN cliente c ON c.id_cliente = v.id_cliente WHERE v.id_pedido = ?', [id]);
  if (!p) return res.status(404).json({ error: 'Pedido no encontrado' });
  const [detalle] = await pool.query(
    `SELECT pr.nombre, pr.unidad, d.cantidad, d.precio_unitario FROM detalle_pedido d
       JOIN producto pr ON pr.id_producto = d.id_producto WHERE d.id_pedido = ?`, [id]);
  const [historial] = await pool.query(
    `SELECT h.estado, h.fecha, h.comentario, u.nombre AS usuario FROM historial_pedido h
       LEFT JOIN usuario u ON u.id_usuario = h.id_usuario WHERE h.id_pedido = ? ORDER BY h.fecha`, [id]);
  res.json({ ...p, detalle, historial });
});

// Pedido ingresado por un vendedor (canal CRM), por ejemplo tras una llamada.
router.post('/pedidos', comercial, async (req, res) => {
  const { id_cliente, id_direccion, items, observacion } = req.body || {};
  res.status(201).json(await crearPedido({
    idCliente: Number(id_cliente), idDireccion: Number(id_direccion), items, canal: 'CRM', observacion, idUsuario: req.usuario.id,
  }));
});

router.patch('/pedidos/:id/estado', async (req, res) => {
  const { estado, comentario } = req.body || {};
  // DESPACHADO y ENTREGADO se manejan desde los despachos para mantener la trazabilidad con el camión.
  if (['DESPACHADO', 'ENTREGADO'].includes(estado)) {
    return res.status(400).json({ error: 'Usa la pestaña Despachos para asignar camión o cerrar la entrega' });
  }
  await cambiarEstado(Number(req.params.id), estado, req.usuario.id, comentario);
  res.json({ ok: true });
});

// ---------- Requerimientos clasificados por IA ----------
router.get('/requerimientos', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT r.*, c.nombre AS cliente FROM requerimiento r LEFT JOIN cliente c ON c.id_cliente = r.id_cliente
      ORDER BY r.estado = 'CERRADO', FIELD(r.prioridad_ia, 'ALTA', 'MEDIA', 'BAJA'), r.fecha DESC LIMIT 200`);
  res.json(rows);
});

router.patch('/requerimientos/:id', async (req, res) => {
  const { estado } = req.body || {};
  if (!['ABIERTO', 'EN_GESTION', 'CERRADO'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  await pool.query('UPDATE requerimiento SET estado = ? WHERE id_requerimiento = ?', [estado, Number(req.params.id)]);
  res.json({ ok: true });
});

router.post('/requerimientos/:id/reclasificar', async (req, res) => {
  const [[r]] = await pool.query('SELECT mensaje FROM requerimiento WHERE id_requerimiento = ?', [Number(req.params.id)]);
  if (!r) return res.status(404).json({ error: 'Requerimiento no encontrado' });
  const ia = await clasificarRequerimiento(r.mensaje);
  await pool.query('UPDATE requerimiento SET categoria_ia = ?, prioridad_ia = ?, respuesta_sugerida = ?, motor_ia = ? WHERE id_requerimiento = ?',
    [ia.categoria, ia.prioridad, ia.respuesta, ia.motor, Number(req.params.id)]);
  res.json(ia);
});

// ---------- Despachos (logística) ----------
router.get('/despachos', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT d.id_despacho, d.estado, d.fecha_salida, d.fecha_llegada, c.codigo AS camion, c.patente,
            co.nombre AS conductor, f.nombre AS perfil_frio, f.temp_min, f.temp_max,
            (SELECT GROUP_CONCAT(dp.id_pedido ORDER BY dp.id_pedido) FROM despacho_pedido dp WHERE dp.id_despacho = d.id_despacho) AS pedidos,
            (SELECT COUNT(*) FROM lectura_telemetria t WHERE t.id_despacho = d.id_despacho AND t.alerta_ruptura_frio) AS alertas
       FROM despacho d JOIN camion c ON c.id_camion = d.id_camion
       JOIN conductor co ON co.id_conductor = d.id_conductor
       JOIN perfil_frio f ON f.id_perfil_frio = d.id_perfil_frio
      ORDER BY d.estado = 'FINALIZADO', d.fecha_salida DESC LIMIT 100`);
  res.json(rows);
});

router.post('/despachos', logistica, async (req, res) => {
  const { id_camion, id_conductor, id_perfil_frio, pedidos } = req.body || {};
  if (!id_camion || !id_conductor || !id_perfil_frio || !Array.isArray(pedidos) || !pedidos.length) {
    return res.status(400).json({ error: 'Selecciona camión, conductor, tipo de frío y al menos un pedido' });
  }
  const id = await transaccion(async (c) => {
    const [ocupado] = await c.query(`SELECT 1 FROM despacho WHERE id_camion = ? AND estado = 'EN_RUTA'`, [id_camion]);
    if (ocupado.length) throw httpError(409, 'Ese camión ya está en ruta');
    const [ok] = await c.query(`SELECT id_pedido FROM pedido WHERE id_pedido IN (?) AND estado = 'EN_PREPARACION' FOR UPDATE`, [pedidos]);
    if (ok.length !== pedidos.length) throw httpError(400, 'Solo se pueden despachar pedidos EN_PREPARACION');
    const [d] = await c.query(
      `INSERT INTO despacho (id_camion, id_conductor, id_perfil_frio, estado, fecha_salida) VALUES (?, ?, ?, 'EN_RUTA', NOW())`,
      [id_camion, id_conductor, id_perfil_frio]);
    for (const idPedido of pedidos) {
      await c.query('INSERT INTO despacho_pedido (id_despacho, id_pedido) VALUES (?, ?)', [d.insertId, idPedido]);
      await c.query(`UPDATE pedido SET estado = 'DESPACHADO' WHERE id_pedido = ?`, [idPedido]);
      await c.query(`INSERT INTO historial_pedido (id_pedido, estado, id_usuario, comentario) VALUES (?, 'DESPACHADO', ?, ?)`,
        [idPedido, req.usuario.id, `Despacho #${d.insertId}`]);
    }
    return d.insertId;
  });
  res.status(201).json({ id_despacho: id });
});

router.post('/despachos/:id/finalizar', logistica, async (req, res) => {
  const id = Number(req.params.id);
  await transaccion(async (c) => {
    const [r] = await c.query(`UPDATE despacho SET estado = 'FINALIZADO', fecha_llegada = NOW() WHERE id_despacho = ? AND estado = 'EN_RUTA'`, [id]);
    if (!r.affectedRows) throw httpError(400, 'El despacho no está en ruta');
    const [peds] = await c.query(
      `SELECT p.id_pedido FROM despacho_pedido dp JOIN pedido p ON p.id_pedido = dp.id_pedido
        WHERE dp.id_despacho = ? AND p.estado = 'DESPACHADO'`, [id]);
    for (const p of peds) {
      await c.query(`UPDATE pedido SET estado = 'ENTREGADO' WHERE id_pedido = ?`, [p.id_pedido]);
      await c.query(`INSERT INTO historial_pedido (id_pedido, estado, id_usuario, comentario) VALUES (?, 'ENTREGADO', ?, ?)`,
        [p.id_pedido, req.usuario.id, `Entregado por despacho #${id}`]);
    }
  });
  res.json({ ok: true });
});

module.exports = { router };
