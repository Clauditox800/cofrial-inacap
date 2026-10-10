const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { requiere, STAFF } = require('../auth');

const router = express.Router();

// Token de cada dispositivo = HMAC-SHA256(IOT_SECRET, camion_id). Un camión no puede enviar datos de otro.
function tokenDispositivo(camionId) {
  return crypto.createHmac('sha256', process.env.IOT_SECRET || '').update(camionId).digest('hex');
}

function tokenValido(camionId, token) {
  const esperado = Buffer.from(tokenDispositivo(camionId));
  const recibido = Buffer.from(String(token || ''));
  return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
}

// Ingesta de telemetría desde los contenedores IoT.
router.post('/telemetria', async (req, res) => {
  const b = req.body || {};
  const camionId = String(b.camion_id || '');
  if (!tokenValido(camionId, req.headers['x-device-token'])) return res.status(401).json({ error: 'Dispositivo no autorizado' });

  const temp = Number(b.temp_camara), lat = Number(b.lat), lng = Number(b.long ?? b.lng), comb = Number(b.combustible_pct);
  if (![temp, lat, lng].every(Number.isFinite) || !Number.isInteger(comb) || comb < 0 || comb > 100) {
    return res.status(400).json({ error: 'Formato inválido: se espera temp_camara (float), lat/long (float), combustible_pct (0-100)' });
  }

  const [[camion]] = await pool.query(
    `SELECT c.id_camion, d.id_despacho, f.temp_min, f.temp_max
       FROM camion c
       LEFT JOIN despacho d    ON d.id_camion = c.id_camion AND d.estado = 'EN_RUTA'
       LEFT JOIN perfil_frio f ON f.id_perfil_frio = d.id_perfil_frio
      WHERE c.codigo = ? AND c.activo`, [camionId]);
  if (!camion) return res.status(404).json({ error: `Camión ${camionId} no registrado` });

  // La API recalcula la alerta con el rango del despacho en curso; se respeta además la alerta del dispositivo.
  const fueraDeRango = camion.temp_min != null && (temp < camion.temp_min || temp > camion.temp_max);
  const alerta = fueraDeRango || b.alerta_ruptura_frio === true;

  await pool.query(
    `INSERT INTO lectura_telemetria (id_camion, id_despacho, temp_camara, lat, lng, combustible_pct, alerta_ruptura_frio)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [camion.id_camion, camion.id_despacho, temp, lat, lng, comb, alerta]);
  res.status(201).json({ ok: true, alerta_ruptura_frio: alerta });
});

// Última posición y estado de cada camión (mapa de flota).
router.get('/flota', requiere(...STAFF), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT c.codigo AS camion_id, c.patente, t.fecha_hora, t.temp_camara, t.lat, t.lng, t.combustible_pct,
            t.alerta_ruptura_frio, d.id_despacho, f.nombre AS perfil_frio, f.temp_min, f.temp_max, co.nombre AS conductor
       FROM camion c
       LEFT JOIN lectura_telemetria t ON t.id_lectura = (
              SELECT t2.id_lectura FROM lectura_telemetria t2 WHERE t2.id_camion = c.id_camion
               ORDER BY t2.fecha_hora DESC LIMIT 1)
       LEFT JOIN despacho d    ON d.id_camion = c.id_camion AND d.estado = 'EN_RUTA'
       LEFT JOIN perfil_frio f ON f.id_perfil_frio = d.id_perfil_frio
       LEFT JOIN conductor co  ON co.id_conductor = d.id_conductor
      WHERE c.activo AND t.id_lectura IS NOT NULL ORDER BY c.codigo`);
  res.json(rows);
});

module.exports = { router, tokenDispositivo };
