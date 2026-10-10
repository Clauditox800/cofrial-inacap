const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, transaccion } = require('./db');

const ROLES = { ADMIN: 1, VENDEDOR: 2, DESPACHADOR: 3, CLIENTE_B2B: 4, CLIENTE_B2C: 5 };
const STAFF = ['ADMIN', 'VENDEDOR', 'DESPACHADOR'];

function firmar(usuario) {
  return jwt.sign(
    { id: usuario.id_usuario, rol: usuario.rol, id_cliente: usuario.id_cliente, nombre: usuario.nombre },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

// Lee el token si viene; no exige sesión.
function sesionOpcional(req, _res, next) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try { req.usuario = jwt.verify(h.slice(7), process.env.JWT_SECRET); } catch { /* token inválido: anónimo */ }
  }
  next();
}

// Exige sesión y, opcionalmente, uno de los roles indicados.
function requiere(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'Debes iniciar sesión' });
    if (roles.length && !roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const [rows] = await pool.query(
    `SELECT u.id_usuario, u.nombre, u.password_hash, u.id_cliente, u.activo, r.nombre AS rol
       FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.email = ?`,
    [String(email || '').trim().toLowerCase()]
  );
  const u = rows[0];
  if (!u || !u.activo || !(await bcrypt.compare(String(password || ''), u.password_hash))) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }
  res.json({ token: firmar(u), usuario: { id: u.id_usuario, nombre: u.nombre, rol: u.rol, id_cliente: u.id_cliente } });
});

// Registro de clientes B2C desde la tienda. Las cuentas B2B las crea un vendedor en el CRM.
router.post('/registro', async (req, res) => {
  const { nombre, rut, email, telefono, password, direccion } = req.body || {};
  if (!nombre || !rut || !email || !password || String(password).length < 6) {
    return res.status(400).json({ error: 'Completa nombre, RUT, correo y una contraseña de al menos 6 caracteres' });
  }
  const correo = String(email).trim().toLowerCase();
  try {
    const usuario = await transaccion(async (c) => {
      const [cli] = await c.query(
        `INSERT INTO cliente (segmento, rut, nombre, email, telefono, es_prospecto) VALUES ('B2C', ?, ?, ?, ?, TRUE)`,
        [rut, nombre, correo, telefono || null]
      );
      const hash = await bcrypt.hash(String(password), 10);
      const [usr] = await c.query(
        `INSERT INTO usuario (email, password_hash, nombre, id_rol, id_cliente) VALUES (?, ?, ?, ?, ?)`,
        [correo, hash, nombre, ROLES.CLIENTE_B2C, cli.insertId]
      );
      if (direccion && direccion.calle && direccion.id_comuna) {
        await c.query(
          `INSERT INTO direccion (id_cliente, calle, numero, id_comuna) VALUES (?, ?, ?, ?)`,
          [cli.insertId, direccion.calle, direccion.numero || 'S/N', direccion.id_comuna]
        );
      }
      return { id_usuario: usr.insertId, nombre, rol: 'CLIENTE_B2C', id_cliente: cli.insertId };
    });
    res.status(201).json({ token: firmar(usuario), usuario: { id: usuario.id_usuario, nombre, rol: usuario.rol, id_cliente: usuario.id_cliente } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una cuenta con ese correo o RUT' });
    throw err;
  }
});

router.get('/yo', requiere(), (req, res) => res.json(req.usuario));

module.exports = { router, sesionOpcional, requiere, ROLES, STAFF };
