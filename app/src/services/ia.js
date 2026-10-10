// Integración de IA a costo cero: API de Google Gemini (capa gratuita)
// con un clasificador por reglas como respaldo si no hay clave, cuota o conexión.

const CATEGORIAS = ['PEDIDO', 'RECLAMO', 'COTIZACION', 'CONSULTA', 'OTRO'];
const PRIORIDADES = ['ALTA', 'MEDIA', 'BAJA'];

async function llamarGemini(prompt, { json = false } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Sin GEMINI_API_KEY');
  const modelo = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, ...(json ? { responseMimeType: 'application/json' } : {}) },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Gemini respondió ${resp.status}`);
  const data = await resp.json();
  const texto = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  if (!texto) throw new Error('Respuesta vacía de Gemini');
  return texto;
}

// ---------- Respaldo por reglas ----------
const REGLAS = [
  { cat: 'RECLAMO', palabras: ['reclamo', 'tibio', 'caliente', 'descongel', 'mal estado', 'podrido', 'olor', 'roto', 'no lleg', 'atras', 'tarde', 'devoluc', 'molest', 'pésimo', 'pesimo', 'cadena de frío', 'cadena de frio'] },
  { cat: 'COTIZACION', palabras: ['cotiza', 'presupuesto', 'precio por volumen', 'convenio', 'licitaci', 'mayorista', 'por mayor'] },
  { cat: 'PEDIDO', palabras: ['pedido', 'comprar', 'necesito', 'quiero', 'encargar', 'despacho', 'enviar', 'orden'] },
  { cat: 'CONSULTA', palabras: ['consulta', 'horario', 'cómo', 'como', 'dónde', 'donde', 'tienen', 'stock', 'información', 'informacion', '?'] },
];
const URGENTE = ['urgente', 'hoy', 'inmediato', 'hospital', 'tibio', 'descongel', 'mal estado', 'riesgo', 'paciente'];

function clasificarPorReglas(mensaje) {
  const t = mensaje.toLowerCase();
  const regla = REGLAS.find((r) => r.palabras.some((p) => t.includes(p)));
  const categoria = regla ? regla.cat : 'OTRO';
  const urgente = URGENTE.some((p) => t.includes(p));
  const prioridad = categoria === 'RECLAMO' || urgente ? 'ALTA' : categoria === 'CONSULTA' || categoria === 'OTRO' ? 'BAJA' : 'MEDIA';
  const respuestas = {
    RECLAMO: 'Lamentamos lo ocurrido. Revisaremos el registro de temperatura de su despacho y un ejecutivo lo contactará hoy para gestionar la reposición.',
    COTIZACION: 'Gracias por su interés. Un ejecutivo comercial le enviará una cotización con precios por volumen en las próximas 24 horas.',
    PEDIDO: 'Puede realizar su pedido directamente en nuestra tienda en línea. Si necesita ayuda, un ejecutivo lo contactará a la brevedad.',
    CONSULTA: 'Gracias por escribirnos. Un ejecutivo responderá su consulta a la brevedad.',
    OTRO: 'Hemos recibido su mensaje. Un ejecutivo lo revisará y le responderá pronto.',
  };
  return { categoria, prioridad, respuesta: respuestas[categoria], motor: 'reglas' };
}

// Clasifica un requerimiento de cliente y propone una respuesta.
async function clasificarRequerimiento(mensaje) {
  const prompt = `Eres el asistente de atención de Cofrial SpA, frigorífico y distribuidor de carnes y alimentos refrigerados en La Araucanía, Chile.
Clasifica el siguiente mensaje de un cliente y redacta una respuesta breve, cordial y en español de Chile (máximo 3 frases).
Responde SOLO con JSON con esta forma:
{"categoria": uno de ${JSON.stringify(CATEGORIAS)}, "prioridad": uno de ${JSON.stringify(PRIORIDADES)}, "respuesta": "texto"}
Criterios: RECLAMO si hay problema con un producto o entrega (prioridad ALTA si afecta la cadena de frío o a un hospital);
COTIZACION si pide precios o volumen; PEDIDO si quiere comprar; CONSULTA si pregunta información.
Mensaje: """${mensaje.slice(0, 1500)}"""`;
  try {
    const r = JSON.parse(await llamarGemini(prompt, { json: true }));
    if (!CATEGORIAS.includes(r.categoria) || !PRIORIDADES.includes(r.prioridad)) throw new Error('Formato inesperado');
    return { categoria: r.categoria, prioridad: r.prioridad, respuesta: String(r.respuesta || '').slice(0, 1000), motor: 'gemini' };
  } catch (err) {
    console.warn('[IA] usando reglas:', err.message);
    return clasificarPorReglas(mensaje);
  }
}

// Asistente de la tienda: responde preguntas usando el catálogo como contexto.
async function responderAsistente(pregunta, productos) {
  const catalogo = productos
    .map((p) => `- ${p.nombre} (${p.categoria}, ${p.perfil_frio}): $${p.precio}/${p.unidad}, stock ${p.stock}`)
    .join('\n');
  const prompt = `Eres el asistente virtual de la tienda en línea de Cofrial SpA (Temuco, Chile).
Responde en español de Chile, en máximo 4 frases, usando solo la información del catálogo.
Si preguntan por algo que no está en el catálogo, dilo y sugiere el formulario de contacto.
Catálogo actual:
${catalogo}

Pregunta del cliente: """${pregunta.slice(0, 800)}"""`;
  try {
    return { respuesta: (await llamarGemini(prompt)).trim(), motor: 'gemini' };
  } catch (err) {
    console.warn('[IA] asistente sin Gemini:', err.message);
    const t = pregunta.toLowerCase();
    const encontrados = productos.filter((p) => t.split(/\W+/).some((w) => w.length > 3 && p.nombre.toLowerCase().includes(w)));
    if (encontrados.length) {
      return {
        respuesta: encontrados.slice(0, 4).map((p) => `${p.nombre}: $${p.precio.toLocaleString('es-CL')} por ${p.unidad} (stock ${p.stock}).`).join(' '),
        motor: 'reglas',
      };
    }
    return { respuesta: 'Puedo ayudarte con precios y stock de nuestros productos. Escribe el nombre de un producto, por ejemplo "pollo" o "salmón".', motor: 'reglas' };
  }
}

module.exports = { clasificarRequerimiento, responderAsistente, clasificarPorReglas };
