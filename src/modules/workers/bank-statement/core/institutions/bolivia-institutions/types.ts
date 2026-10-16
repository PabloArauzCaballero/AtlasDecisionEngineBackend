import type { InstitutionSignalDescriptor } from '../../engine/similarity/institution-signals';

export type InstitutionKind =
  /** Banco múltiple (BMU): la banca universal de la Ley 393. */
  | 'MULTIPLE_BANK'
  /** Banco PYME (BPY). */
  | 'PYME_BANK'
  /** Banco del Estado o con participación mayoritaria del Estado. */
  | 'STATE_BANK'
  /** Banca de segundo piso: financia a otras entidades, no al público. */
  | 'DEVELOPMENT_BANK'
  /** Entidad Financiera de Vivienda (EFV), las antiguas mutuales. */
  | 'HOUSING_ENTITY'
  /** Cooperativa de Ahorro y Crédito abierta o societaria (CAC). */
  | 'COOPERATIVE'
  /** Institución Financiera de Desarrollo (IFD). */
  | 'DEVELOPMENT_IFD';

/**
 * Situación de la licencia.
 *
 * `REVOKED` no se borra del padrón, y ésa es la decisión importante: un extracto
 * de una entidad intervenida es un documento auténtico y su historial sigue
 * siendo cierto, pero quien lo recibe hoy tiene que enterarse de que la entidad
 * ya no opera. Borrarla del padrón convertiría ese caso en «entidad
 * desconocida», que se lee como un fallo del motor y no como el hecho que es.
 */
export type InstitutionLicenseStatus =
  | 'LICENSED'
  | 'SUSPENDED'
  /**
   * Intervenida por el regulador, **sin que conste revocación**.
   *
   * Es un estado propio y no un sinónimo de `REVOKED`, y la diferencia no es
   * terminológica: una intervención no implica revocación automática, y en el
   * corte oficial de servicios complementarios del 31.08.2026 la entidad aparece
   * en la lista de INTERVENCIÓN sin fecha ni resolución de revocación. El corpus
   * lo resuelve en su contradicción C02 con una instrucción literal —conservar
   * el estado observado y dejar la revocación en `null`—, que es lo que impide
   * afirmar en un expediente un hecho jurídico que nadie verificó.
   */
  | 'INTERVENED'
  /** En liquidación voluntaria: deja de operar por decisión propia. */
  | 'VOLUNTARY_LIQUIDATION'
  /** En proceso de quiebra. */
  | 'BANKRUPTCY'
  /**
   * Absorbida y disuelta sin liquidación: sus documentos siguen siendo válidos y
   * su sucesora es quien responde hoy.
   */
  | 'ABSORBED'
  | 'REVOKED';

export interface BoliviaInstitution {
  /** Sigla ASFI. Es la clave con la que el regulador nombra a la entidad. */
  readonly code: string;
  readonly name: string;
  readonly kind: InstitutionKind;
  readonly licenseStatus: InstitutionLicenseStatus;
  /**
   * Si capta depósitos del público y por tanto emite extractos de cuenta.
   *
   * Es informativo, **no** un motivo de rechazo: una IFD emite estados de cuenta
   * de crédito y la banca de segundo piso no atiende ventanilla, pero un
   * documento suyo sigue siendo de una entidad supervisada. Lo que hace es
   * explicar por qué un documento atribuido al BDP merece una mirada.
   */
  readonly retailDeposits: boolean;
  /** Lo que, impreso en la carátula, atribuye el documento a esta entidad. */
  readonly markers: readonly RegExp[];
  /**
   * Lo que ANULA la atribución aunque un marcador coincida.
   *
   * Existe por un falso positivo real del grupo financiero: la póliza de «BISA
   * Seguros y Reaseguros S.A.» lleva la palabra BISA en la carátula y se
   * atribuía al Banco BISA, con lo que una póliza entraba en el motor como si
   * fuera un extracto de su banco hermano. El apellido de la filial es lo único
   * que las distingue.
   */
  readonly exclusions?: readonly RegExp[];
  /** Por qué la entidad no está vigente, cuando no lo está. */
  readonly note?: string;
  /**
   * Las señales que un extracto suyo debería traer, contra las que se mide el
   * parecido de cada documento.
   *
   * Opcional y ausente en la nómina compilada a propósito: describir cómo son los
   * extractos de sesenta y ocho entidades es trabajo de calibración con documentos
   * reales, no algo que se pueda escribir de memoria. Sin descriptor, la medida de
   * parecido devuelve `NO_DESCRIPTOR` y no afecta a nada.
   */
  readonly expectedSignals?: InstitutionSignalDescriptor;
}
