const express = require('express');
const { pool } = require('../db');
const { requiere } = require('../auth');

const router = express.Router();
const q = (sql, params = []) => pool.query(sql, params).then(([r]) => r);

// Un solo endpoint que el dashboard consulta cada pocos segundos.
// Cruza métricas comerciales (ventas, canales, pipeline) con las operativas (cadena de frío IoT).
router.get('/resumen', requiere('ADMIN', 'VENDEDOR', 'DESPACHADOR'), async (_req, res) => {
  const [
    [kpi], [frio], ventasDia, canales, topProductos, alertasCamion, temperaturas, enRiesgo, pipeline, tickets,
  ] = await Promise.all([
    q(`SELECT
         COALESCE(SUM(CASE WHEN fecha >= CURDATE() THEN total END), 0) AS ventas_hoy,
         COALESCE(SUM(total), 0) AS ventas_30d,
         COUNT(*) AS pedidos_30d,
         COALESCE(ROUND(AVG(total)), 0) AS ticket_promedio,
         SUM(estado IN ('PENDIENTE','CONFIRMADO','EN_PREPARACION')) AS pedidos_por_despachar
       FROM v_pedido_total WHERE estado <> 'CANCELADO' AND fecha >= NOW() - INTERVAL 30 DAY`),
    q(`SELECT
         (SELECT COUNT(*) FROM lectura_telemetria WHERE alerta_ruptura_frio AND fecha_hora >= NOW() - INTERVAL 24 HOUR) AS alertas_24h,
         (SELECT COUNT(*) FROM lectura_telemetria WHERE fecha_hora >= NOW() - INTERVAL 24 HOUR) AS lecturas_24h,
         (SELECT COUNT(*) FROM despacho WHERE estado = 'EN_RUTA') AS camiones_en_ruta`),
    q(`SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS dia, segmento, SUM(total) AS total
         FROM v_pedido_total WHERE estado <> 'CANCELADO' AND fecha >= CURDATE() - INTERVAL 13 DAY
        GROUP BY dia, segmento ORDER BY dia`),
    q(`SELECT canal, segmento, COUNT(*) AS pedidos, SUM(total) AS total
         FROM v_pedido_total WHERE estado <> 'CANCELADO' AND fecha >= NOW() - INTERVAL 30 DAY
        GROUP BY canal, segmento`),
    q(`SELECT pr.nombre, SUM(d.cantidad * d.precio_unitario) AS total
         FROM detalle_pedido d JOIN pedido p ON p.id_pedido = d.id_pedido JOIN producto pr ON pr.id_producto = d.id_producto
        WHERE p.estado <> 'CANCELADO' AND p.fecha >= NOW() - INTERVAL 30 DAY
        GROUP BY pr.id_producto, pr.nombre ORDER BY total DESC LIMIT 6`),
    q(`SELECT c.codigo AS camion_id, COUNT(t.id_lectura) AS alertas
         FROM camion c LEFT JOIN lectura_telemetria t
           ON t.id_camion = c.id_camion AND t.alerta_ruptura_frio AND t.fecha_hora >= NOW() - INTERVAL 24 HOUR
        WHERE c.activo AND EXISTS (SELECT 1 FROM lectura_telemetria x
                                    WHERE x.id_camion = c.id_camion AND x.fecha_hora >= NOW() - INTERVAL 24 HOUR)
        GROUP BY c.codigo ORDER BY c.codigo`),
    q(`SELECT c.codigo AS camion_id, t.fecha_hora, t.temp_camara
         FROM lectura_telemetria t JOIN camion c ON c.id_camion = t.id_camion
        WHERE t.fecha_hora >= NOW() - INTERVAL 20 MINUTE ORDER BY t.fecha_hora`),
    // Cruce comercial-operativo: pedidos que viajan en un camión con ruptura de frío en la última hora.
    q(`SELECT p.id_pedido, cl.nombre AS cliente, cl.segmento, v.total, c.codigo AS camion_id,
              MAX(t.temp_camara) AS temp_max_registrada, f.temp_max AS temp_limite, MAX(t.fecha_hora) AS ultima_alerta
         FROM despacho d
         JOIN despacho_pedido dp ON dp.id_despacho = d.id_despacho
         JOIN pedido p           ON p.id_pedido = dp.id_pedido
         JOIN v_pedido_total v   ON v.id_pedido = p.id_pedido
         JOIN cliente cl         ON cl.id_cliente = p.id_cliente
         JOIN camion c           ON c.id_camion = d.id_camion
         JOIN perfil_frio f      ON f.id_perfil_frio = d.id_perfil_frio
         JOIN lectura_telemetria t ON t.id_despacho = d.id_despacho AND t.alerta_ruptura_frio
                                  AND t.fecha_hora >= NOW() - INTERVAL 60 MINUTE
        WHERE d.estado = 'EN_RUTA'
        GROUP BY p.id_pedido, cl.nombre, cl.segmento, v.total, c.codigo, f.temp_max
        ORDER BY ultima_alerta DESC`),
    q(`SELECT e.nombre AS etapa, e.orden, COUNT(o.id_oportunidad) AS cantidad, COALESCE(SUM(o.monto_estimado), 0) AS monto
         FROM etapa_pipeline e LEFT JOIN oportunidad o ON o.id_etapa = e.id_etapa
        GROUP BY e.id_etapa, e.nombre, e.orden ORDER BY e.orden`),
    q(`SELECT categoria_ia, COUNT(*) AS cantidad FROM requerimiento WHERE estado <> 'CERRADO' GROUP BY categoria_ia`),
  ]);

  const montoEnRiesgo = enRiesgo.reduce((s, r) => s + Number(r.total), 0);
  res.json({
    generado: new Date().toISOString(),
    kpi: { ...kpi, ...frio, pedidos_en_riesgo: enRiesgo.length, monto_en_riesgo: montoEnRiesgo },
    ventasDia, canales, topProductos, alertasCamion, temperaturas, enRiesgo, pipeline, tickets,
  });
});

module.exports = { router };
