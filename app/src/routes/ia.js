const express = require('express');
const { pool } = require('../db');
const { clasificarRequerimiento, responderAsistente } = require('../services/ia');
const { listaDelCliente, sqlPrecio } = require('./catalogo');

const router = express.Router();

// Formulario de contacto de la web: se guarda como requerimiento clasificado por IA.
router.post('/contacto', async (req, res) => {
  const { nombre, email, mensaje } = req.body || {};
  if (!nombre || !email || !mensaje || String(mensaje).trim().length < 5) {
    return res.status(400).json({ error: 'Completa nombre, correo y mensaje' });
  }
  const ia = await clasificarRequerimiento(String(mensaje));
  // Si el remitente ya es cliente (por sesión o por correo), se asocia a su ficha.
  let idCliente = req.usuario?.id_cliente || null;
  if (!idCliente) {
    const [c] = await pool.query('SELECT id_cliente FROM cliente WHERE email = ? LIMIT 1', [String(email).toLowerCase()]);
    idCliente = c[0]?.id_cliente || null;
  }
  const [r] = await pool.query(
    `INSERT INTO requerimiento (id_cliente, nombre_contacto, email_contacto, mensaje, categoria_ia, prioridad_ia, respuesta_sugerida, motor_ia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [idCliente, nombre, String(email).toLowerCase(), String(mensaje).slice(0, 1000), ia.categoria, ia.prioridad, ia.respuesta, ia.motor]
  );
  res.status(201).json({ id_requerimiento: r.insertId, ...ia });
});

// Asistente virtual de la tienda.
router.post('/asistente', async (req, res) => {
  const pregunta = String(req.body?.pregunta || '').trim();
  if (!pregunta) return res.status(400).json({ error: 'Escribe una pregunta' });
  const lista = await listaDelCliente(req.usuario?.id_cliente);
  const precio = sqlPrecio(lista);
  const [productos] = await pool.query(
    `SELECT p.nombre, p.unidad, p.stock, ${precio.expr} AS precio, c.nombre AS categoria, f.nombre AS perfil_frio
       FROM producto p JOIN categoria c ON c.id_categoria = p.id_categoria
       JOIN perfil_frio f ON f.id_perfil_frio = c.id_perfil_frio ${precio.join}
      WHERE p.activo = TRUE`, precio.params);
  res.json(await responderAsistente(pregunta, productos));
});

module.exports = { router };
