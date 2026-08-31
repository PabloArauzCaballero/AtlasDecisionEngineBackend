/**
 * El descriptor de SEÑALES ESPERADAS de una entidad: qué tiene que traer un
 * extracto suyo para parecerse a los suyos.
 *
 * ## Qué pregunta contesta, y por qué no la contestaba nadie
 *
 * El motor tenía tres preguntas sobre el documento —con qué se produjo, si es un
 * estado de cuenta, y quién lo firma— y las tres se contestan con UN indicio. La
 * atribución de entidad, en concreto, se resuelve con que un marcador coincida
 * en la carátula: basta escribir «BANCO NACIONAL DE BOLIVIA S.A.» en un
 * documento para que el motor diga que es del BNB.
 *
 * Este descriptor contesta la cuarta: **¿se parece a los extractos que ESA
 * entidad emite de verdad?** No es una compuerta más, es una medida — y por eso
 * devuelve un porcentaje y no un sí o un no. Un documento que trae la razón
 * social, las siete columnas en su orden, el aviso de ASFI al pie, el formato de
 * fecha correcto y el mismo generador de informes que usa el banco no está
 * «atribuido»: está corroborado por cinco caminos independientes.
 *
 * ## Por qué la evidencia se pondera y no se cuenta
 *
 * Porque no todas las señales cuestan lo mismo de falsificar. La razón social se
 * copia y se pega; el generador que declara el archivo —`iText`, `JasperReports`—
 * hay que producirlo con esa herramienta. Contarlas todas igual haría que un
 * documento compuesto en Word con la carátula copiada puntuara casi como el
 * original, que es exactamente el fallo que este descriptor existe para no
 * repetir.
 *
 * ## Por qué `provenance` gobierna qué se puede hacer con el resultado
 *
 * Un descriptor escrito a mano es una hipótesis sobre cómo son los extractos de
 * un banco; uno medido sobre documentos reales es un hecho. Los dos producen un
 * porcentaje y sólo el segundo puede usarse para RESCATAR un documento —dejar
 * pasar algo que otra compuerta habría parado—. Sin esa distinción, una hipótesis
 * mal escrita se convertiría en una puerta trasera: bastaría declarar señales
 * laxas para que cualquier cosa las cumpliera.
 */

import { isPotentiallyCatastrophic } from '../../../../../../common/validation/safe-regex';

/** De dónde sale el descriptor, que es lo que determina cuánta autoridad tiene. */
export type DescriptorProvenance =
  /** Escrito a mano a partir de lo que se sabe de la entidad. Sólo mide. */
  | 'DECLARED'
  /** Derivado de documentos reales de la entidad. Puede corroborar. */
  | 'MEASURED';

/** Dónde se busca una señal. Separarlo evita cruces sin sentido. */
export type SignalScope =
  /** La carátula: los primeros renglones, donde el banco se identifica. */
  | 'COVER'
  /** El texto completo del documento, incluidos pies y avisos legales. */
  | 'DOCUMENT'
  /** Los encabezados de la tabla de movimientos. */
  | 'COLUMNS'
  /** Lo que el CONTENEDOR declara: productor y creador del PDF. */
  | 'PRODUCER';

export interface ExpectedSignal {
  /** Identificador corto y estable. Sale en el informe de coincidencias. */
  readonly id: string;
  readonly scope: SignalScope;
  /** El patrón, ya compilado y sin distinguir mayúsculas. */
  readonly pattern: RegExp;
  /**
   * Cuánto pesa encontrarla, en la misma escala para todas las entidades.
   *
   * La guía es cuánto cuesta FALSIFICARLA, no cuán visible es: una razón social
   * pesa poco porque se copia y se pega; un generador institucional pesa mucho
   * porque hay que producir el archivo con esa herramienta.
   */
  readonly weight: number;
  /**
   * Si su ausencia invalida el parecido entero, por alta que sea la suma.
   *
   * Se usa con cuentagotas y para lo que la entidad imprime SIEMPRE. Una señal
   * obligatoria mal elegida convierte el descriptor en un rechazo encubierto de
   * todos los extractos de ese banco.
   */
  readonly required?: boolean;
}

export interface InstitutionSignalDescriptor {
  /** Versión del descriptor. Sube cuando el banco cambia su maqueta. */
  readonly version: number;
  /** Sigla ASFI de la entidad a la que describe. */
  readonly institutionCode: string;
  readonly provenance: DescriptorProvenance;
  /**
   * Cuántos documentos reales lo sostienen. Cero en los declarados.
   *
   * Viaja porque un porcentaje sin denominador no se puede interpretar: «coincide
   * al 90 % con el patrón medido sobre dos documentos» y «sobre doscientos» son
   * dos afirmaciones distintas y se leen igual.
   */
  readonly sampleSize: number;
  readonly signals: readonly ExpectedSignal[];
  /** Orden de fecha que imprime la entidad, si es constante. */
  readonly dateOrder?: 'DMY' | 'MDY' | 'YMD';
  /** Nota para quien administre el padrón: de dónde salió esto. */
  readonly note?: string;
}

export class InvalidSignalDescriptorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSignalDescriptorError';
  }
}

const SCOPES: readonly SignalScope[] = ['COVER', 'DOCUMENT', 'COLUMNS', 'PRODUCER'];
const PROVENANCES: readonly DescriptorProvenance[] = ['DECLARED', 'MEASURED'];

/**
 * Valida y compila un descriptor escrito en JSON.
 *
 * Se valida al LEERLO y no al usarlo, igual que los perfiles de formato: un
 * patrón inválido tiene que fallar donde alguien lo escribió —al guardar la fila
 * del padrón— y no a mitad del análisis de un extracto, donde el error se leería
 * como un defecto del documento.
 */
export function parseSignalDescriptor(raw: unknown): InstitutionSignalDescriptor {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InvalidSignalDescriptorError('Un descriptor de señales debe ser un objeto.');
  }
  const source = raw as Record<string, unknown>;

  const institutionCode = source['institutionCode'];
  if (typeof institutionCode !== 'string' || institutionCode.trim() === '') {
    throw new InvalidSignalDescriptorError('Un descriptor necesita `institutionCode`.');
  }

  const provenance = source['provenance'];
  if (typeof provenance !== 'string' || !PROVENANCES.includes(provenance as DescriptorProvenance)) {
    throw new InvalidSignalDescriptorError(
      `El descriptor de ${institutionCode} necesita \`provenance\` DECLARED o MEASURED.`,
    );
  }

  const version = positiveInteger(source['version'], `${institutionCode}.version`, 1);
  const sampleSize = positiveInteger(source['sampleSize'], `${institutionCode}.sampleSize`, 0);

  /*
   * Un descriptor MEDIDO sin muestra es una contradicción, y es la que más daño
   * haría: `MEASURED` es exactamente lo que autoriza a rescatar documentos, así
   * que dejarlo pasar convertiría «lo escribí a mano y puse MEASURED» en una
   * puerta trasera con permiso.
   */
  if (provenance === 'MEASURED' && sampleSize < 1) {
    throw new InvalidSignalDescriptorError(
      `El descriptor de ${institutionCode} dice ser MEASURED con muestra ${String(sampleSize)}: ` +
        'un descriptor medido tiene que declarar sobre cuántos documentos se midió.',
    );
  }

  const rawSignals = source['signals'];
  if (!Array.isArray(rawSignals) || rawSignals.length === 0) {
    throw new InvalidSignalDescriptorError(
      `El descriptor de ${institutionCode} necesita al menos una señal.`,
    );
  }

  const signals = rawSignals.map((signal, index) =>
    parseSignal(signal, `${institutionCode}.signals[${String(index)}]`),
  );

  const identifiers = new Set<string>();
  for (const signal of signals) {
    if (identifiers.has(signal.id)) {
      throw new InvalidSignalDescriptorError(
        `El descriptor de ${institutionCode} repite la señal ${signal.id}.`,
      );
    }
    identifiers.add(signal.id);
  }

  return {
    version,
    institutionCode,
    provenance: provenance as DescriptorProvenance,
    sampleSize,
    signals,
    dateOrder: optionalDateOrder(source['dateOrder'], institutionCode),
    note: optionalString(source['note'], `${institutionCode}.note`),
  };
}

function parseSignal(raw: unknown, path: string): ExpectedSignal {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InvalidSignalDescriptorError(`\`${path}\` debe ser un objeto.`);
  }
  const source = raw as Record<string, unknown>;

  const id = source['id'];
  if (typeof id !== 'string' || id.trim() === '') {
    throw new InvalidSignalDescriptorError(`\`${path}\` necesita un \`id\` no vacío.`);
  }

  const scope = source['scope'];
  if (typeof scope !== 'string' || !SCOPES.includes(scope as SignalScope)) {
    throw new InvalidSignalDescriptorError(
      `\`${path}.scope\` debe ser uno de ${SCOPES.join(', ')}.`,
    );
  }

  const weight = source['weight'];
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 100) {
    throw new InvalidSignalDescriptorError(`\`${path}.weight\` debe estar entre 1 y 100.`);
  }

  return {
    id,
    scope: scope as SignalScope,
    pattern: compile(source['pattern'], `${path}.pattern`),
    weight,
    required: optionalBoolean(source['required'], `${path}.required`) ?? false,
  };
}

/**
 * Compila un patrón que vendrá de la base de datos.
 *
 * El control anti-ReDoS es el mismo que aplican los perfiles de formato y por el
 * mismo motivo: estos patrones se ejecutan contra el texto de un PDF —entrada
 * externa de longitud arbitraria— y uno con retroceso catastrófico bloquearía el
 * hilo del worker. Quien administra el padrón puede escribirlo sin saberlo.
 */
function compile(value: unknown, path: string): RegExp {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidSignalDescriptorError(`\`${path}\` debe ser una cadena no vacía.`);
  }
  if (isPotentiallyCatastrophic(value)) {
    throw new InvalidSignalDescriptorError(`\`${path}\` tiene retroceso catastrófico: ${value}`);
  }
  try {
    return new RegExp(value, 'i');
  } catch {
    throw new InvalidSignalDescriptorError(`\`${path}\` no es una expresión regular válida.`);
  }
}

function positiveInteger(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new InvalidSignalDescriptorError(`\`${path}\` debe ser un entero no negativo.`);
  }
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new InvalidSignalDescriptorError(`\`${path}\` debe ser booleano.`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new InvalidSignalDescriptorError(`\`${path}\` debe ser una cadena.`);
  }
  return value;
}

function optionalDateOrder(value: unknown, code: string): 'DMY' | 'MDY' | 'YMD' | undefined {
  if (value === undefined || value === null) return undefined;
  if (value !== 'DMY' && value !== 'MDY' && value !== 'YMD') {
    throw new InvalidSignalDescriptorError(
      `El descriptor de ${code} usa un \`dateOrder\` no admitido: ${JSON.stringify(value)}`,
    );
  }
  return value;
}
