import type { Revision } from './revision';

export function revisarCapturaDePantalla(revision: Revision): void {
  const { textoCompleto, fallos } = revision;

  // --- 6. Rastros de que la imagen es una captura de pantalla --------------
  /*
   * Una cédula fotografiada no lleva reloj ni barra de batería. Estos rótulos
   * salen del CROMO de un teléfono, y encontrarlos significa que lo que se subió
   * es la foto de la pantalla de otro dispositivo: el vector más común del
   * fraude de identidad barato, porque no hace falta tener la tarjeta, sólo una
   * imagen de ella.
   */
  if (
    /\b(?:CAPTURA\s+DE\s+PANTALLA|SCREENSHOT|WHATSAPP|TELEGRAM|MESSENGER)\b/u.test(textoCompleto)
  ) {
    fallos.push({
      codigo: 'SCREEN_CAPTURE_ARTIFACTS',
      detalle:
        'El texto leído contiene rótulos de la interfaz de una aplicación, no del documento.',
      peso: 0.3,
    });
  }
}
