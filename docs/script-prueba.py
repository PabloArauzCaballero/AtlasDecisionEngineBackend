# Script de prueba para un nodo RESULT (modo SCRIPT, lenguaje PYTHON).
#
# Contrato del ejecutor (ScriptNodeRunnerService):
#  - Recibe los diccionarios globales `variables`, `decision` y `output`.
#  - Debe asignar un objeto (dict) a la variable `result`.
#  - Solo builtins seguros: abs, bool, dict, enumerate, float, int, len, list,
#    max, min, range, round, str, sum, tuple, zip. NO hay import, try, class,
#    isinstance ni atributos dunder.
#
# Entrada de ejemplo:  {"monto": 1500, "cliente": "Cliente de prueba", "nivelRiesgo": 3}
# Salida de ejemplo:   {"aprobado": true, "clasificacion": "RIESGO_MEDIO", ...}

monto = variables.get('monto')
nivel_riesgo = variables.get('nivelRiesgo')
cliente = variables.get('cliente')

# Validación simple: sin isinstance/try, se comprueba ausencia y valor no positivo.
if monto is None or monto <= 0:
    result = {
        'aprobado': False,
        'clasificacion': 'RECHAZADO',
        'mensaje': 'El monto es obligatorio y debe ser mayor a cero.',
    }
else:
    nivel = nivel_riesgo if nivel_riesgo is not None else 5
    factor = 1.5 if nivel <= 2 else 1.0 if nivel <= 3 else 0.5
    limite_sugerido = round(monto * factor)
    clasificacion = 'RIESGO_BAJO' if nivel <= 2 else 'RIESGO_MEDIO' if nivel <= 3 else 'RIESGO_ALTO'
    aprobado = nivel <= 3

    # Operación con texto.
    nombre = str(cliente) if cliente else 'Cliente'
    if aprobado:
        mensaje = nombre + ': la solicitud puede continuar con revisión adicional.'
    else:
        mensaje = nombre + ': la solicitud requiere garantías adicionales.'

    result = {
        'aprobado': aprobado,
        'clasificacion': clasificacion,
        'limiteSugerido': limite_sugerido,
        'mensaje': mensaje,
    }
