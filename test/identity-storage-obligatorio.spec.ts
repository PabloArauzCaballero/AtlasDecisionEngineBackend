import { HttpStatus } from '@nestjs/common';
import { WorkerInputSource } from '@prisma/client';
import { IdentityVerificationService } from '../src/modules/workers/identity-verification/identity-verification.service';
import { BankStatementService } from '../src/modules/workers/bank-statement/bank-statement.service';
import { DomainException } from '../src/common/errors/domain-exception';

/**
 * Sin sitio donde conservar la evidencia, una subida REAL no se acepta.
 *
 * Esto era una degradación silenciosa: sin almacén configurado, el servicio escribía un aviso en
 * el log y encolaba igual. La ejecución decidía, cerraba, vaciaba las columnas `Bytes` —que es la
 * decisión de privacidad correcta— y la cara, la cédula o el extracto sobre los que se había
 * decidido ya no existían. Medido el 2026-09-11 sobre una cédula boliviana auténtica: tres
 * verificaciones seguidas con las tres claves de objeto en `null`.
 *
 * El daño de esa forma de fallar es que no se nota. Nadie lee un `warn` entre miles de líneas, y
 * la ausencia se descubre semanas más tarde, cuando alguien va a revisar el caso o a contestar una
 * impugnación. Era incoherente además con el orden de escritura del propio servicio, que ya
 * prefiere no dar de alta antes que dar de alta sin evidencia: un fallo AL SUBIR cortaba el alta y
 * no tener almacén no la cortaba.
 *
 * Los ESCENARIOS siguen pasando sin almacén: sus imágenes las genera el motor, no son de nadie.
 * Esa excepción es la que permite correr el motor y estas pruebas sin MinIO.
 */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('bytes-que-nadie-va-a-analizar-en-esta-prueba'),
]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('extracto-de-prueba')]);

const imagen = (
  fileName: string,
): { fileName: string; contentType: 'image/png'; bytes: Buffer } => ({
  fileName,
  contentType: 'image/png',
  bytes: PNG,
});

const ENTRADA_IDENTIDAD = {
  document: imagen('cedula.png'),
  documentBack: imagen('reverso.png'),
  selfie: imagen('selfie.png'),
  inputHash: 'huella-de-prueba',
};

const ENTRADA_EXTRACTO = {
  fileName: 'extracto.pdf',
  contentType: 'application/pdf' as const,
  bytes: PDF,
  inputHash: 'huella-de-extracto',
  sizeBytes: PDF.byteLength,
};

const PRINCIPAL = { id: 'tester', requestId: 'req-1' };

/** Un almacén que declara no estar configurado, que es el escenario que se prueba. */
const SIN_ALMACEN = { isConfigured: (): boolean => false };

/**
 * Prisma que EXPLOTA si alguien lo usa.
 *
 * Es la mitad silenciosa del contrato: no basta con que la llamada falle, tiene que fallar ANTES
 * de crear la fila. Si la guarda se moviera después del `create`, quedaría una ejecución huérfana
 * en la base y esta prueba lo delataría.
 */
const PRISMA_PROHIBIDO = new Proxy(
  {},
  {
    get(): never {
      throw new Error('No se debe tocar la base: la subida tenía que rechazarse antes.');
    },
  },
);

const NADA = {} as never;

describe('sin almacén de objetos no se acepta una subida real', () => {
  it('identidad: la subida se rechaza con 503 y un código propio', async () => {
    const service = new IdentityVerificationService(
      PRISMA_PROHIBIDO as never,
      NADA,
      NADA,
      NADA,
      SIN_ALMACEN as never,
    );

    const fallo = await service
      .createRun(1n, PRINCIPAL as never, ENTRADA_IDENTIDAD as never, WorkerInputSource.UPLOAD, {
        documentCountry: 'BO',
      })
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(DomainException);
    const error = fallo as DomainException;
    expect(error.code).toBe('IDENTITY_IMAGE_STORAGE_NOT_CONFIGURED');
    expect(error.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    // El mensaje nombra lo que falta: un 503 sin eso manda a leer código.
    expect(error.message).toContain('STORAGE_S3_BUCKET');
  });

  it('extractos: el mismo corte, con su propio código', async () => {
    const service = new BankStatementService(
      PRISMA_PROHIBIDO as never,
      NADA,
      NADA,
      NADA,
      SIN_ALMACEN as never,
    );

    const fallo = await service
      .createRun(1n, PRINCIPAL as never, ENTRADA_EXTRACTO as never, WorkerInputSource.UPLOAD)
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(DomainException);
    expect((fallo as DomainException).code).toBe('STATEMENT_FILE_STORAGE_NOT_CONFIGURED');
    expect((fallo as DomainException).status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
