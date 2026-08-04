import type { PrismaClient } from '@prisma/client';

/**
 * Catálogo mínimo del worker semántico (ADR-0026).
 *
 * Sin categorías sembradas el worker responde `UNKNOWN` a todo, y eso no es un
 * fallo sino su comportamiento correcto: se niega a clasificar contra un
 * catálogo vacío. Pero deja la pantalla sin nada que enseñar, así que un
 * despliegue nuevo necesita un punto de partida.
 *
 * Son categorías de **atención al cliente financiero**, que es el dominio del
 * motor. Cada una trae contraejemplos, y esos pesan tanto como los ejemplos
 * positivos: son los que evitan que «me cobraron de más» y «quiero cancelar mi
 * tarjeta» caigan en el mismo sitio.
 *
 * El umbral de aceptación es **por categoría** a propósito. Equivocarse en
 * `FRAUDE_SOSPECHADO` cuesta mucho más que en `CONSULTA_GENERAL`: la primera
 * dispara una revisión y la segunda sólo enruta, así que la primera exige más
 * confianza para aceptarse.
 */

const TENANT_ID = 1n;

interface SemanticCategorySeed {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly positiveExamples: readonly string[];
  readonly counterExamples: readonly string[];
  readonly restrictions: readonly string[];
  readonly relatedCategoryCodes: readonly string[];
  readonly acceptanceThreshold: number;
}

export const semanticCategoryCatalog: readonly SemanticCategorySeed[] = [
  {
    code: 'COBRO_NO_RECONOCIDO',
    name: 'Cobro no reconocido',
    description:
      'La persona no reconoce un cargo aplicado a su cuenta o tarjeta y pide explicación o devolución.',
    positiveExamples: [
      'Hay un cargo en mi tarjeta que yo no hice.',
      'Me debitaron un monto que no reconozco del mes pasado.',
      'Aparece un consumo en mi extracto que nunca autoricé.',
    ],
    counterExamples: [
      // Reconoce el cargo: discute el importe, no su existencia.
      'El cobro es correcto pero me parece caro.',
      // Es una consulta de saldo, no una disputa.
      'Quiero saber cuánto debo este mes.',
    ],
    restrictions: ['Debe referirse a un cargo ya aplicado, no a uno futuro o previsto.'],
    relatedCategoryCodes: ['FRAUDE_SOSPECHADO', 'DEVOLUCION_SOLICITADA'],
    acceptanceThreshold: 0.7,
  },
  {
    code: 'FRAUDE_SOSPECHADO',
    name: 'Fraude sospechado',
    description:
      'La persona afirma o sugiere que un tercero usó sus medios de pago o sus datos sin autorización.',
    positiveExamples: [
      'Creo que alguien clonó mi tarjeta y está comprando con ella.',
      'Me robaron el celular y vi transferencias que no hice.',
      'Recibí un mensaje pidiéndome mis claves y creo que entraron a mi cuenta.',
    ],
    counterExamples: [
      // Un cargo propio olvidado no es fraude.
      'Olvidé que había hecho esa compra, ya la reconocí.',
      'Mi hijo usó la tarjeta con mi permiso.',
    ],
    restrictions: [
      'Requiere indicio de intervención de un tercero no autorizado, no sólo desconocimiento del cargo.',
    ],
    relatedCategoryCodes: ['COBRO_NO_RECONOCIDO', 'BLOQUEO_SOLICITADO'],
    // El umbral más alto del catálogo: activa una revisión antifraude, y un
    // falso positivo bloquea a un cliente que no hizo nada.
    acceptanceThreshold: 0.82,
  },
  {
    code: 'DEVOLUCION_SOLICITADA',
    name: 'Devolución solicitada',
    description: 'La persona pide que se le reintegre un importe ya cobrado.',
    positiveExamples: [
      'Solicito la devolución del importe cobrado por un servicio que cancelé.',
      'Quiero que me reintegren lo que pagué de más.',
      'Pido reembolso porque el producto nunca llegó.',
    ],
    counterExamples: [
      'Sólo quiero saber por qué me cobraron eso.',
      'Quiero reclamar pero todavía no pido nada concreto.',
    ],
    restrictions: ['Debe haber una petición explícita de reintegro.'],
    relatedCategoryCodes: ['COBRO_NO_RECONOCIDO'],
    acceptanceThreshold: 0.72,
  },
  {
    code: 'BLOQUEO_SOLICITADO',
    name: 'Bloqueo solicitado',
    description: 'La persona pide bloquear, suspender o dar de baja una tarjeta o una cuenta.',
    positiveExamples: [
      'Por favor bloqueen mi tarjeta, la perdí.',
      'Quiero suspender mi cuenta hasta nuevo aviso.',
      'Necesito dar de baja la tarjeta adicional.',
    ],
    counterExamples: [
      // Es lo contrario: pide reactivar.
      'Mi tarjeta está bloqueada y quiero volver a usarla.',
    ],
    restrictions: ['Debe pedir una acción sobre el instrumento, no sólo informar de una pérdida.'],
    relatedCategoryCodes: ['FRAUDE_SOSPECHADO'],
    acceptanceThreshold: 0.75,
  },
  {
    code: 'CONSULTA_GENERAL',
    name: 'Consulta general',
    description:
      'La persona pide información sin reclamar nada: saldos, condiciones, plazos o cómo hacer una gestión.',
    positiveExamples: [
      '¿Cuál es mi saldo disponible?',
      '¿Qué documentos necesito para abrir una cuenta?',
      '¿Hasta qué día puedo pagar sin recargo?',
    ],
    counterExamples: [
      'Me cobraron mal y quiero que lo corrijan.',
      'Alguien usó mi tarjeta sin permiso.',
    ],
    restrictions: [],
    relatedCategoryCodes: [],
    // El umbral más bajo: es la categoría de destino cuando no hay reclamo, y
    // enrutar una consulta al sitio equivocado apenas cuesta nada.
    acceptanceThreshold: 0.6,
  },
];

/** Alias de entidades bolivianas que el resolutor debe reconocer. */
export const semanticEntityAliasCatalog: readonly {
  alias: string;
  canonicalName: string;
  entityType: string;
}[] = [
  { alias: 'BNB', canonicalName: 'Banco Nacional de Bolivia', entityType: 'INSTITUCION' },
  {
    alias: 'Banco Nacional',
    canonicalName: 'Banco Nacional de Bolivia',
    entityType: 'INSTITUCION',
  },
  { alias: 'BCP', canonicalName: 'Banco de Crédito de Bolivia', entityType: 'INSTITUCION' },
  { alias: 'Banco Ganadero', canonicalName: 'Banco Ganadero', entityType: 'INSTITUCION' },
  { alias: 'BancoSol', canonicalName: 'Banco Solidario', entityType: 'INSTITUCION' },
  { alias: 'Banco Unión', canonicalName: 'Banco Unión', entityType: 'INSTITUCION' },
  { alias: 'Mercantil', canonicalName: 'Banco Mercantil Santa Cruz', entityType: 'INSTITUCION' },
  { alias: 'Bs', canonicalName: 'Boliviano', entityType: 'MONEDA' },
  { alias: 'bolivianos', canonicalName: 'Boliviano', entityType: 'MONEDA' },
  { alias: 'USD', canonicalName: 'Dólar estadounidense', entityType: 'MONEDA' },
];

/**
 * Siembra el catálogo. Idempotente por `(tenant, code)`: reejecutar actualiza en
 * vez de duplicar, que es lo que permite correrlo en cada arranque.
 */
export async function seedSemanticCatalog(
  prisma: PrismaClient,
): Promise<{ categories: number; aliases: number }> {
  for (const seed of semanticCategoryCatalog) {
    const data = {
      name: seed.name,
      description: seed.description,
      positiveExamples: [...seed.positiveExamples],
      counterExamples: [...seed.counterExamples],
      restrictions: [...seed.restrictions],
      relatedCategoryCodes: [...seed.relatedCategoryCodes],
      acceptanceThreshold: seed.acceptanceThreshold,
      isActive: true,
    };
    await prisma.semanticCategory.upsert({
      where: { tenantId_code: { tenantId: TENANT_ID, code: seed.code } },
      create: { tenantId: TENANT_ID, code: seed.code, ...data },
      // La versión NO se toca al actualizar: la sube quien cambie el significado
      // de la categoría, no una reejecución de la semilla. Si subiera sola, la
      // auditoría diría que la categoría cambió cada vez que arranca el motor.
      update: data,
    });
  }

  for (const alias of semanticEntityAliasCatalog) {
    await prisma.semanticEntityAlias.upsert({
      where: {
        tenantId_entityType_alias: {
          tenantId: TENANT_ID,
          entityType: alias.entityType,
          alias: alias.alias,
        },
      },
      create: { tenantId: TENANT_ID, ...alias, isActive: true },
      update: { canonicalName: alias.canonicalName, isActive: true },
    });
  }

  return {
    categories: semanticCategoryCatalog.length,
    aliases: semanticEntityAliasCatalog.length,
  };
}
