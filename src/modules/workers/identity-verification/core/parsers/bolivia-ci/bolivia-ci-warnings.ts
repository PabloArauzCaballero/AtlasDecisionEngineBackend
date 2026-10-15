/** Códigos de aviso que este analizador puede levantar. */
export const BOLIVIA_CI_WARNINGS = {
  documentNumberNotFound: 'DOCUMENT_NUMBER_NOT_FOUND',
  nameNotFound: 'NAME_NOT_FOUND',
  dateOfBirthNotFound: 'DATE_OF_BIRTH_NOT_FOUND',
  expiryNotFound: 'DOCUMENT_EXPIRY_NOT_FOUND',
  unparsableDateOfBirth: 'DATE_OF_BIRTH_UNPARSABLE',
  unparsableExpiry: 'DOCUMENT_EXPIRY_UNPARSABLE',
  nameSplitHeuristic: 'NAME_SPLIT_HEURISTIC',
  /** El anverso y la MRZ del reverso no dicen lo mismo. */
  mrzMismatch: 'DOCUMENT_MRZ_MISMATCH',
  /** El nombre impreso y el de la MRZ no son el mismo nombre. */
  nameMrzMismatch: 'NAME_MRZ_MISMATCH',
  /** El rótulo del nombre se leyó, pero lo que había debajo no era un nombre. */
  printedNameUnusable: 'PRINTED_NAME_UNUSABLE',
  /** La MRZ se leyó, pero su control compuesto no cuadra. */
  mrzCheckFailed: 'DOCUMENT_MRZ_CHECK_FAILED',
  /**
   * Las FECHAS impresas no coinciden con las de la MRZ, pero el número y el
   * nombre sí.
   *
   * Es deliberadamente un aviso distinto de `DOCUMENT_MRZ_MISMATCH`, y la
   * diferencia es de qué acusa cada uno. El número y el nombre identifican a la
   * persona: que el anverso y el reverso digan personas distintas es un montaje.
   * Las fechas, en cambio, van en el cuerpo más pequeño del anverso y sobre el
   * guilloché, que es donde el reconocedor falla — medido sobre una cédula
   * auténtica, `13/01/2031` volvió como `13/04/2034`.
   *
   * Un falsificador que acierte el número y el nombre y falle las dos fechas no
   * existe; un OCR que haga eso es lo normal. Mantenerlos bajo la misma marca
   * hacía que una cédula legítima llegara al análisis de fraude con la señal más
   * grave que este analizador puede levantar.
   */
  mrzDateMismatch: 'DOCUMENT_MRZ_DATE_MISMATCH',
  /**
   * La tarjeta declara que NO caduca. No es un campo ausente ni un fallo de
   * lectura: es lo que el SEGIP imprime, y sin distinguirlo el expediente
   * quedaba igual que el de una cédula cuya caducidad no se pudo leer.
   */
  expiryIndefinite: 'DOCUMENT_EXPIRY_INDEFINITE',
} as const;
