/**
 * Contratos HTTP de los workers adicionales (ADR-0026).
 *
 * Comparten archivo porque comparten el ciclo de vida —estado, progreso,
 * intentos, correlación— y el frontend pinta todas las vistas con el mismo
 * código. Lo que NO comparten (la entrada y el resultado) vive en clases
 * separadas: mezclarlo habría producido un DTO con la mitad de los campos
 * opcionales, que no valida nada.
 */
export * from './dto/worker-catalog.dto';
export * from './dto/worker-metrics.dto';
export * from './dto/semantic-run.dto';
export * from './dto/bank-statement-run.dto';
export * from './dto/identity-run.dto';
export * from './dto/audio-tts-run.dto';
