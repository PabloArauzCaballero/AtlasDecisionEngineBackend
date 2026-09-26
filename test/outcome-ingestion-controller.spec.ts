/**
 * El controlador que escribe evidencia regulatoria, que no tenía ninguna prueba.
 *
 * `v1/outcomes` es donde entra el desenlace observado de cada crédito: el dato con el que
 * después se mide si el modelo se degrada, se calcula el impacto adverso y se sostienen las
 * afirmaciones de la revisión LGPD/ECOA. Una auditoría encontró cero ficheros de `test/` que lo
 * mencionaran — junto a `semantic-category`, `pdf-catalog`, `pdf-generation` y
 * `pdf-template-admin`.
 *
 * Lo que se fija aquí es la CAPA DE CONTROL, no la lógica de ingesta —que vive en el servicio y
 * sí tiene pruebas—: qué roles pueden llamar a cada operación, que el tenant y el principal
 * llegan al servicio sin manipular, y que la respuesta es la del servicio y no una traducción
 * que pudiera perder información por el camino.
 *
 * Los roles importan más que el resto: quien CARGA un desenlace no debería ser quien lo AUDITA,
 * y las dos listas están a un carácter de distancia en el decorador. Sin esta prueba, añadir
 * `AUDITOR` a la carga por lote —o quitar `COMPLIANCE`— no rompe nada visible.
 */
import 'reflect-metadata';
import { REQUIRED_ROLES } from '../src/common/security/security.decorators';
import { OutcomeIngestionController } from '../src/modules/outcome-ingestion/outcome-ingestion.controller';
import type { OutcomeIngestionService } from '../src/modules/outcome-ingestion/outcome-ingestion.service';
import type { VintageService } from '../src/modules/outcome-ingestion/vintage.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

const TENANT = 7n;
const PRINCIPAL = {
  actorId: 'operador-1',
  roles: ['OPERATIONS'],
} as unknown as AuthenticatedPrincipal;

function rolesDe(metodo: keyof OutcomeIngestionController): readonly string[] {
  const roles = Reflect.getMetadata(
    REQUIRED_ROLES,
    OutcomeIngestionController.prototype[metodo] as object,
  ) as string[] | undefined;
  return roles ?? [];
}

describe('OutcomeIngestionController · autorización', () => {
  /*
   * La regla de fondo: LEER la evidencia es más amplio que ESCRIBIRLA.
   *
   * Un auditor tiene que poder mirar la cola de ventanas vencidas y la matriz de cosechas —es su
   * trabajo—, y no tiene que poder cargar desenlaces, porque entonces audita lo que él mismo
   * escribió. Es la misma separación de funciones que el resto del motor aplica a aprobar y
   * desplegar, y aquí no estaba afirmada por nada.
   */
  it('la escritura excluye a AUDITOR', () => {
    expect(rolesDe('registerFacilities')).not.toContain('AUDITOR');
    expect(rolesDe('recordBatch')).not.toContain('AUDITOR');
  });

  it('la lectura sí incluye a AUDITOR', () => {
    expect(rolesDe('pending')).toContain('AUDITOR');
    expect(rolesDe('vintage')).toContain('AUDITOR');
  });

  it('el alta de créditos la hacen OPERATIONS y RISK_ANALYST, nadie más', () => {
    // Es la conciliación diaria con el sistema de cartera, no una persona tecleando.
    expect([...rolesDe('registerFacilities')].sort()).toEqual(['OPERATIONS', 'RISK_ANALYST']);
  });

  it('la carga por lote admite además a COMPLIANCE', () => {
    expect([...rolesDe('recordBatch')].sort()).toEqual([
      'COMPLIANCE',
      'OPERATIONS',
      'RISK_ANALYST',
    ]);
  });

  it('ninguna operación queda sin roles declarados', () => {
    // Una operación sin `@Roles` pasa el guardia de autenticación y luego no restringe nada:
    // cualquiera con sesión válida escribiría evidencia regulatoria.
    for (const metodo of ['registerFacilities', 'recordBatch', 'pending', 'vintage'] as const) {
      expect(rolesDe(metodo).length).toBeGreaterThan(0);
    }
  });
});

describe('OutcomeIngestionController · delegación', () => {
  const ingestion = {
    registerFacilities: jest.fn(),
    recordBatch: jest.fn(),
  } as unknown as jest.Mocked<OutcomeIngestionService>;
  const vintages = {
    pending: jest.fn(),
    vintage: jest.fn(),
  } as unknown as jest.Mocked<VintageService>;
  const controller = new OutcomeIngestionController(ingestion, vintages);

  beforeEach(() => jest.clearAllMocks());

  it('pasa el tenant y el principal SIN tocarlos al registrar créditos', async () => {
    // El tenant llega del guardia, no del cuerpo. Que el controlador lo reenvíe tal cual es lo
    // que impide que una petición escriba en la cartera de otra organización.
    const dto = { facilities: [] } as never;
    (ingestion.registerFacilities as jest.Mock).mockResolvedValue({ rows: [] });

    await controller.registerFacilities(TENANT, PRINCIPAL, dto);

    expect(ingestion.registerFacilities).toHaveBeenCalledWith(TENANT, dto, PRINCIPAL);
  });

  it('devuelve el veredicto por fila del servicio, sin reducirlo a un conteo', async () => {
    /*
     * La respuesta lleva el resultado de CADA fila a propósito: un 200 con «1.998 aceptadas»
     * deja al operador sin saber cuáles fueron las dos que no, y la reacción natural a eso es
     * reenviar el archivo entero y esperar que cuele — sobre una tabla de evidencia que
     * justamente no se debe reescribir a mano.
     */
    const respuesta = {
      rows: [
        { reference: 'CRED-1', status: 'RECORDED' },
        { reference: 'CRED-2', status: 'REJECTED', reason: 'FACILITY_NOT_FOUND' },
      ],
    };
    (ingestion.recordBatch as jest.Mock).mockResolvedValue(respuesta);

    const salida = await controller.recordBatch(TENANT, PRINCIPAL, { outcomes: [] } as never);

    // `toBe` y no `toEqual`: se exige la MISMA referencia. Con `toEqual` pasaría también un
    // controlador que reconstruyera la respuesta por el camino, que es justo donde se pierden
    // los campos que nadie recuerda copiar.
    expect(salida).toBe(respuesta);
    expect(respuesta.rows).toHaveLength(2);
  });

  it('la cola de pendientes y la matriz van al servicio de cosechas, con su consulta', async () => {
    const consulta = { limit: 50 } as never;
    (vintages.pending as jest.Mock).mockResolvedValue({ windows: [] });
    (vintages.vintage as jest.Mock).mockResolvedValue({ cells: [] });

    await controller.pending(TENANT, consulta);
    await controller.vintage(TENANT, consulta);

    expect(vintages.pending).toHaveBeenCalledWith(TENANT, consulta);
    expect(vintages.vintage).toHaveBeenCalledWith(TENANT, consulta);
  });

  it('no inventa un tenant por omisión si el guardia no lo puso', async () => {
    // Defensa en profundidad: si algún día el decorador dejara de resolverlo, el controlador
    // debe propagar el vacío y que falle el servicio, no sustituirlo por 1n y escribir en la
    // organización equivocada.
    (vintages.pending as jest.Mock).mockResolvedValue({ windows: [] });

    await controller.pending(undefined as unknown as bigint, { limit: 10 } as never);

    expect(vintages.pending).toHaveBeenCalledWith(undefined, { limit: 10 });
  });
});
