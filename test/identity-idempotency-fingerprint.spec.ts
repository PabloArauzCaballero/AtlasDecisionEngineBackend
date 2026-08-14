import { validateIdentityUpload } from '../src/modules/workers/identity-verification/identity-verification-input';
import { IDENTITY_PIPELINE_VERSION } from '../src/modules/workers/identity-verification/identity-pipeline-version';

/**
 * La clave de idempotencia y las TRES cosas de las que depende un veredicto.
 *
 * Un veredicto es función de las imágenes, de la calibración y **del código que
 * las lee**. La clave cubría las dos primeras, y la tercera costó cara: al
 * arreglar el lector de la MRZ, reenviar las mismas fotos seguía devolviendo el
 * veredicto guardado con el lector viejo. Desde la pantalla eso es
 * indistinguible de un arreglo que no funcionó — y se concluyó justamente eso,
 * dos veces.
 *
 * Estas pruebas fijan las dos mitades del contrato: que un canal nuevo obliga a
 * releer, y que sin cambios NO se relee, que es el ahorro por el que la caché
 * existe.
 */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('mismas-imagenes-en-todos-los-casos'),
]);

const FILES = {
  document: { originalname: 'cedula.png', buffer: PNG },
  documentBack: { originalname: 'reverso.png', buffer: PNG },
  selfie: { originalname: 'selfie.png', buffer: PNG },
};

const MAX = 10 * 1024 * 1024;
const CALIBRACION = 'perfil-real|0.6367|0.4556|tesseract|human|human';
const huella = (reglas: string, clave?: string): string =>
  validateIdentityUpload(FILES, MAX, clave, reglas).inputHash;

describe('clave de idempotencia de una verificación', () => {
  it('las mismas imágenes bajo las mismas reglas NO se vuelven a leer', () => {
    // El ahorro: volver a leer y volver a comparar no cambiaría el veredicto.
    expect(huella(`canal-v2|${CALIBRACION}`)).toBe(huella(`canal-v2|${CALIBRACION}`));
  });

  it('subir la versión del canal obliga a releer las mismas imágenes', () => {
    expect(huella(`canal-v1|${CALIBRACION}`)).not.toBe(huella(`canal-v2|${CALIBRACION}`));
  });

  it('recalibrar obliga a releer, como ya estaba', () => {
    expect(huella(`canal-v2|${CALIBRACION}`)).not.toBe(
      huella('canal-v2|otro-perfil|0.9|0.8|tesseract|human|human'),
    );
  });

  it('la clave explícita fuerza una lectura nueva sin tocar nada más', () => {
    // Es la vía de escape que la consola usa con «Forzar una verificación nueva».
    expect(huella(`canal-v2|${CALIBRACION}`)).not.toBe(
      huella(`canal-v2|${CALIBRACION}`, 'clave-nueva'),
    );
  });

  it('la versión del canal es un entero que sólo sube', () => {
    // Bajarla reviviría claves ya usadas y devolvería veredictos de un lector
    // anterior: la caché no distingue «versión nueva» de «versión repetida».
    expect(Number.isInteger(IDENTITY_PIPELINE_VERSION)).toBe(true);
    expect(IDENTITY_PIPELINE_VERSION).toBeGreaterThanOrEqual(2);
  });
});
