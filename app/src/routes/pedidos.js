const express = require('express');
const { pool, transaccion } = require('../db');
const { requiere } = require('../auth');
const { listaDelCliente, sqlPrecio } = require('./catalogo');

const router = express.Router();
const esCliente = requiere('CLIENTE_B2B', 'CLIENTE_B2C');

// Transiciones válidas del ciclo de vida del pedido.
const TRANSICIONES = {
  PENDIENTE: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['EN_PREPARACION', 'CANCELADO'],
  EN_PREPARACION: ['DESPACHADO'],
  DESPACHADO: ['ENTREGADO'],
  ENTREGADO: [],
  CANCELADO: [],
};

// Crea un pedido: valida stock, congela precios y descuenta inventario en una sola transacción.
async function crearPedido({ idCliente, idDireccion, items, canal, observacion, idUsuario }) {
  if (!Array.isArray(items) || !items.length) throw httpError(400, 'El carrito está vacío');
  const cantidades = new Map();
  for (const it of items) {
    const id = Number(it.id_producto), cant = Number(it.cantidad);
    if (!Number.isInteger(id) || !Number.isInteger(cant) || cant <= 0) throw httpError(400, 'Cantidad inválida');
    cantidades.set(id, (cantidades.get(id) || 0) + cant);
  }

  return transaccion(async (c) => {
    const [dir] = await c.query('SELECT id_direccion FROM direccion WHERE id_direccion = ? AND id_cliente = ?', [idDireccion, idCliente]);
    if (!dir.length) throw httpError(400, 'Selecciona una dirección de despacho válida');

    const lista = await listaDelCliente(idCliente, c);
    const precio = sqlPrecio(lista);
    const ids = [...cantidades.keys()];
    const [prods] = await c.query(
      `SELECT p.id_producto, p.nombre, p.stock, ${precio.expr} AS precio
         FROM producto p ${precio.join}
        WHERE p.id_producto IN (?) AND p.activo = TRUE FOR UPDATE`,
      [...precio.params, ids]
    );
    if (prods.length !== ids.length) throw httpError(400, 'Uno de los productos ya no está disponible');
    for (const p of prods) {
      if (p.stock < cantidades.get(p.id_producto)) {
        throw httpError(409, `Stock insuficiente de ${p.nombre} (quedan ${p.stock})`);
      }
    }

    const [ped] = await c.query(
      'INSERT INTO pedido (id_cliente, id_direccion, canal, observacion) VALUES (?, ?, ?, ?)',
      [idCliente, idDireccion, canal, observacion || null]
    );
    const idPedido = ped.insertId;
    for (const p of prods) {
      const cant = cantidades.get(p.id_producto);
      await c.query('INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
        [idPedido, p.id_producto, cant, p.precio]);
      await c.query('UPDATE producto SET stock = stock - ? WHERE id_producto = ?', [cant, p.id_producto]);
    }
    await c.query('INSERT INTO historial_pedido (id_pedido, estado, id_usuario, comentario) VALUES (?, ?, ?, ?)',
      [idPedido, 'PENDIENTE', idUsuario, `Pedido creado por canal ${canal}`]);
    // Un prospecto que compra pasa a ser cliente.
    await c.query('UPDATE cliente SET es_prospecto = FALSE WHERE id_cliente = ?', [idCliente]);
    const total = prods.reduce((s, p) => s + p.precio * cantidades.get(p.id_producto), 0);
    return { id_pedido: idPedido, total };
  });
}

// Cambia el estado respetando las transiciones; al cancelar devuelve el stock.
async function cambiarEstado(idPedido, nuevo, idUsuario, comentario) {
  return transaccion(async (c) => {
    const [rows] = await c.query('SELECT estado FROM pedido WHERE id_pedido = ? FOR UPDATE', [idPedido]);
    if (!rows.length) throw httpError(404, 'Pedido no encontrado');
    const actual = rows[0].estado;
    if (!TRANSICIONES[actual]?.includes(nuevo)) throw httpError(400, `No se puede pasar de ${actual} a ${nuevo}`);
    if (nuevo === 'CANCELADO') {
      await c.query(
        `UPDATE producto p JOIN detalle_pedido d ON d.id_producto = p.id_producto
            SET p.stock = p.stock + d.cantidad WHERE d.id_pedido = ?`, [idPedido]);
    }
    await c.query('UPDATE pedido SET estado = ? WHERE id_pedido = ?', [nuevo, idPedido]);
    await c.query('INSERT INTO historial_pedido (id_pedido, estado, id_usuario, comentario) VALUES (?, ?, ?, ?)',
      [idPedido, nuevo, idUsuario, comentario || null]);
  });
}

function httpError(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// ---------- Endpoints del cliente ----------

router.get('/direcciones', esCliente, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT d.id_direccion, d.calle, d.numero, co.nombre AS comuna
       FROM direccion d JOIN comuna co ON co.id_comuna = d.id_comuna
      WHERE d.id_cliente = ? ORDER BY d.id_direccion`, [req.usuario.id_cliente]);
  res.json(rows);
});

router.post('/direcciones', esCliente, async (req, res) => {
  const { calle, numero, id_comuna } = req.body || {};
  if (!calle || !id_comuna) return res.status(400).json({ error: 'Indica calle y comuna' });
  const [r] = await pool.query('INSERT INTO direccion (id_cliente, calle, numero, id_comuna) VALUES (?, ?, ?, ?)',
    [req.usuario.id_cliente, calle, numero || 'S/N', id_comuna]);
  res.status(201).json({ id_direccion: r.insertId });
});

router.post('/pedidos', esCliente, async (req, res) => {
  const { items, id_direccion, observacion } = req.body || {};
  const r = await crearPedido({
    idCliente: req.usuario.id_cliente, idDireccion: id_direccion, items, canal: 'WEB',
    observacion, idUsuario: req.usuario.id,
  });
  res.status(201).json(r);
});

router.get('/pedidos/mios', esCliente, async (req, res) => {
  const [pedidos] = await pool.query(
    `SELECT v.id_pedido, v.estado, v.fecha, v.total, CONCAT(d.calle, ' ', d.numero, ', ', co.nombre) AS direccion
       FROM v_pedido_total v
       JOIN pedido p     ON p.id_pedido = v.id_pedido
       JOIN direccion d  ON d.id_direccion = p.id_direccion
       JOIN comuna co    ON co.id_comuna = d.id_comuna
      WHERE v.id_cliente = ? ORDER BY v.fecha DESC LIMIT 50`, [req.usuario.id_cliente]);
  if (pedidos.length) {
    const ids = pedidos.map((p) => p.id_pedido);
    const [det] = await pool.query(
      `SELECT d.id_pedido, pr.nombre, d.cantidad, d.precio_unitario, pr.unidad
         FROM detalle_pedido d JOIN producto pr ON pr.id_producto = d.id_producto WHERE d.id_pedido IN (?)`, [ids]);
    const [hist] = await pool.query(
      'SELECT id_pedido, estado, fecha, comentario FROM historial_pedido WHERE id_pedido IN (?) ORDER BY fecha', [ids]);
    for (const p of pedidos) {
      p.detalle = det.filter((d) => d.id_pedido === p.id_pedido);
      p.historial = hist.filter((h) => h.id_pedido === p.id_pedido);
    }
  }
  res.json(pedidos);
});

module.exports = { router, crearPedido, cambiarEstado, httpError, TRANSICIONES };
