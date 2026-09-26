/**
 * La marca que distingue una decisión SEMBRADA de una decisión tomada.
 *
 * Vive aquí y no dentro del sembrador porque tiene dos lectores con intereses opuestos, y ésa
 * es exactamente la razón de que sea una sola constante:
 *
 *  - **Quien siembra** (`modules/seeding/data/audit-demo.seed.ts`) la usa para ser idempotente
 *    sin tabla de control y para poder BORRAR lo suyo sin llevarse por delante las decisiones
 *    que alguien ejecutó a mano en su máquina.
 *  - **Quien mide** (`modules/model-monitoring/decision-coverage.service.ts`) la usa para poder
 *    decir qué parte de la población medida es inventada.
 *
 * Si cada uno llevara su propia copia, el día que el prefijo cambie el sembrador seguiría
 * borrando bien y el monitoreo empezaría a informar 0 % de siembra sobre una base entera de
 * demostración — el fallo silencioso peor de los dos, porque deja el aviso apagado justo
 * cuando hace falta.
 *
 * NO se importa desde `audit-demo.seed.ts` en sentido contrario: ese archivo arrastra el
 * elenco de casos demo y el firmante HMAC, y el monitoreo no tiene por qué cargarlos para
 * comparar una cadena de texto.
 */

/**
 * Prefijo del `requestId` de toda ejecución sembrada por las semillas de DEMOSTRACIÓN.
 *
 * Es una convención de datos, no de código: identifica filas ya escritas en bases que no se
 * van a volver a sembrar. Cambiarlo NO renombra lo que ya existe — deja huérfana la siembra
 * anterior, que pasa a contarse como real. Si algún día hay que cambiarlo, se migra el dato.
 */
export const DEMO_REQUEST_PREFIX = 'bnpl-cartera-demo';

/** Lo que va delante de cada folio. Se separa para que nadie olvide el guion al comparar. */
export const DEMO_REQUEST_LIKE = `${DEMO_REQUEST_PREFIX}-%`;
