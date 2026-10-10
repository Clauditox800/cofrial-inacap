// Muestra el token de un camión. Uso: npm run token -- CAM-001
require('dotenv').config();
const { tokenDispositivo } = require('../src/routes/telemetria');

const id = process.argv[2] || 'CAM-001';
console.log(`${id}: ${tokenDispositivo(id)}`);
