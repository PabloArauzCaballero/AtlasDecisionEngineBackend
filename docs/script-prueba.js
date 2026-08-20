// @atlas-contract
// { "contractVersion": "1",
//   "primaryOutputId": "clasificacion",
//   "inputs": [
//     { "id": "monto", "name": "Monto solicitado", "type": "NUMBER", "required": true },
//     { "id": "cliente", "name": "Nombre del cliente", "type": "STRING", "required": false },
//     { "id": "nivelRiesgo", "name": "Nivel de riesgo", "type": "INTEGER", "required": false }
//   ],
//   "outputs": [
//     { "id": "aprobado", "name": "Aprobado", "type": "BOOLEAN", "required": true },
//     { "id": "clasificacion", "name": "Clasificacion", "type": "STRING", "required": true },
//     { "id": "limiteSugerido", "name": "Limite sugerido", "type": "INTEGER", "required": false },
//     { "id": "mensaje", "name": "Mensaje", "type": "STRING", "required": true }
//   ] }

// Script de prueba para un nodo RESULT (modo SCRIPT, lenguaje JAVASCRIPT).
//
// Contrato del ejecutor (ScriptNodeRunnerService):
//  - Recibe los objetos globales `variables`, `decision` y `output`.
//  - Debe RETORNAR un objeto JSON-serializable (no un arreglo, no null).
//  - Es determinista: Math.random y Date están deshabilitados.
//
// Entrada de ejemplo:  { "monto": 1500, "cliente": "Cliente de prueba", "nivelRiesgo": 3 }
// Salida de ejemplo:   { "aprobado": true, "clasificacion": "RIESGO_MEDIO", ... }

var monto = variables.monto;
var nivelRiesgo = variables.nivelRiesgo;
var cliente = variables.cliente;

// Validación simple: el error se refleja en la salida (manejo controlado), no se lanza.
if (typeof monto !== 'number' || monto <= 0) {
  return {
    aprobado: false,
    clasificacion: 'RECHAZADO',
    mensaje: 'El monto es obligatorio y debe ser mayor a cero.',
  };
}

// Operación numérica: clasificación y límite sugerido según el nivel de riesgo.
var nivel = typeof nivelRiesgo === 'number' ? nivelRiesgo : 5;
var factor = nivel <= 2 ? 1.5 : nivel <= 3 ? 1.0 : 0.5;
var limiteSugerido = Math.round(monto * factor);
var clasificacion = nivel <= 2 ? 'RIESGO_BAJO' : nivel <= 3 ? 'RIESGO_MEDIO' : 'RIESGO_ALTO';
var aprobado = nivel <= 3;

// Operación con texto.
var nombre = typeof cliente === 'string' && cliente.length > 0 ? cliente : 'Cliente';
var mensaje = aprobado
  ? nombre + ': la solicitud puede continuar con revisión adicional.'
  : nombre + ': la solicitud requiere garantías adicionales.';

return {
  aprobado: aprobado,
  clasificacion: clasificacion,
  limiteSugerido: limiteSugerido,
  mensaje: mensaje,
};
