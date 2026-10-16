/**
 * El padrón de entidades de intermediación financiera de Bolivia.
 *
 * ## De dónde sale
 *
 * De la nómina oficial de ASFI «Entidades de Intermediación Financiera con
 * Licencia de Funcionamiento», actualizada al **30 de abril de 2026**: 11 bancos
 * múltiples, 2 bancos PYME, 2 entidades del Estado, 3 entidades financieras de
 * vivienda, 41 cooperativas de ahorro y crédito —abiertas y societarias— y 8
 * instituciones financieras de desarrollo. Son 67 con licencia vigente, más las
 * que la perdieron y siguen apareciendo en documentos reales.
 *
 * Los códigos NO son inventados: son las siglas con las que ASFI identifica a
 * cada entidad, de modo que `institutionCode` se puede cruzar con
 * cualquier reporte del regulador sin una tabla de traducción.
 *
 * ## Por qué está completo y no sólo con los bancos que se saben leer
 *
 * Reconocer la entidad y saber leer su formato son dos preguntas distintas, y
 * confundirlas producía la peor respuesta posible: un extracto de una
 * cooperativa se trataba como «entidad desconocida», que es lo mismo que se
 * responde a una factura de electricidad. Con el padrón completo el motor puede
 * afirmar «esto lo emitió una entidad con licencia de ASFI y todavía no tengo
 * analizador para su plantilla» —accionable, revisable— y separarlo de «esto no
 * lo emitió ninguna entidad financiera boliviana», que es un rechazo.
 *
 * ## Qué es la fuente de la verdad en tiempo de ejecución
 *
 * Este catálogo es la SEMILLA. En el motor desplegado el padrón vive en
 * `decision_financial_institution` y se administra desde el portal, porque una
 * licencia se revoca por resolución de ASFI y esperar a un despliegue para
 * dejar de aceptar los documentos de una entidad intervenida sería exactamente
 * el fallo que este módulo existe para impedir. Cuando nadie inyecta un padrón
 * —pruebas, uso embebido, arranque en frío— se usa éste.
 */
export type { BoliviaInstitution, InstitutionKind, InstitutionLicenseStatus } from './types';
export { BOLIVIA_INSTITUTIONS, countMarkerHits } from './registry';
