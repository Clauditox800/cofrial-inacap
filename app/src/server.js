require('dotenv').config();
const path = require('path');
const express = require('express');
const { pool } = require('./db');
const auth = require('./auth');

if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en el archivo .env');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(auth.sesionOpcional);

app.get('/api/salud', async (_req, res) => {
  const [[r]] = await pool.query('SELECT NOW() AS hora_bd');
  res.json({ ok: true, hora_bd: r.hora_bd, ia: process.env.GEMINI_API_KEY ? 'gemini' : 'reglas' });
});

app.use('/api/auth', auth.router);
app.use('/api', require('./routes/catalogo').router);
app.use('/api', require('./routes/pedidos').router);
app.use('/api', require('./routes/telemetria').router);
app.use('/api', require('./routes/ia').router);
app.use('/api/crm', require('./routes/crm').router);
app.use('/api/bi', require('./routes/bi').router);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// Errores: los creados con status se muestran al usuario; el resto se registra.
app.use((err, _req, res, _next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Cofrial escuchando en http://localhost:${port}`));
