const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// Lista de precio del cliente conectado (solo B2B tiene convenio).
async function listaDelCliente(idCliente, conn = pool) {
  if (!idCliente) return null;
  const [rows] = await conn.query(
    `SELECT c.segmento, l.id_lista_precio, l.nombre, l.descuento_pct
       FROM cliente c LEFT JOIN lista_precio l ON l.id_lista_precio = c.id_lista_precio
      WHERE c.id_cliente = ?`,
    [idCliente]
  );
  const r = rows[0];
  return r && r.segmento === 'B2B' && r.id_lista_precio ? r : null;
}

// SQL que calcula el precio final: precio pactado > descuento del convenio > precio lista.
function sqlPrecio(lista) {
  if (!lista) return { expr: 'p.precio_lista', join: '', params: [] };
  return {
    expr: `COALESCE(pe.precio, ROUND(p.precio_lista * (1 - ? / 100)))`,
    join: 'LEFT JOIN precio_especial pe ON pe.id_producto = p.id_producto AND pe.id_lista_precio = ?',
    params: [lista.descuento_pct, lista.id_lista_precio],
  };
}

router.get('/categorias', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT c.id_categoria, c.nombre, f.nombre AS perfil_frio, f.temp_min, f.temp_max
       FROM categoria c JOIN perfil_frio f ON f.id_perfil_frio = c.id_perfil_frio ORDER BY c.nombre`
  );
  res.json(rows);
});

router.get('/productos', async (req, res) => {
  const lista = await listaDelCliente(req.usuario?.id_cliente);
  const precio = sqlPrecio(lista);
  const filtros = ['p.activo = TRUE'];
  const params = [...precio.params]; // orden: descuento (SELECT), lista (JOIN), luego filtros
  if (req.query.categoria) { filtros.push('p.id_categoria = ?'); params.push(Number(req.query.categoria)); }
  if (req.query.q) { filtros.push('(p.nombre LIKE ? OR p.descripcion LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const [rows] = await pool.query(
    `SELECT p.id_producto, p.sku, p.nombre, p.descripcion, p.unidad, p.stock, p.imagen_url,
            p.precio_lista, ${precio.expr} AS precio, c.nombre AS categoria, f.nombre AS perfil_frio
       FROM producto p
       JOIN categoria c   ON c.id_categoria = p.id_categoria
       JOIN perfil_frio f ON f.id_perfil_frio = c.id_perfil_frio
       ${precio.join}
      WHERE ${filtros.join(' AND ')}
      ORDER BY c.nombre, p.nombre`,
    params
  );
  res.json({ lista: lista ? lista.nombre : null, productos: rows });
});

router.get('/comunas', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT co.id_comuna, co.nombre, r.nombre AS region
       FROM comuna co JOIN region r ON r.id_region = co.id_region ORDER BY co.nombre`
  );
  res.json(rows);
});

module.exports = { router, listaDelCliente, sqlPrecio };
