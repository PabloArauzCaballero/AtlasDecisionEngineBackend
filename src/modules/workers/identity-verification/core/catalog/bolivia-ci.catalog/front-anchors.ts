import { AnclajeDeCatalogo } from './types';

export const ESTADO_EMISOR: AnclajeDeCatalogo = {
  id: 'estado-emisor',
  cara: 'ANVERSO',
  patron: /ESTADO\s+PLURINACIONAL\s+DE\s+BOLIVIA/u,
  grafias: ['ESTADO PLURINACIONAL DE BOLIVIA', 'PLURINACIONAL', 'DE BOLIVIA'],
  peso: 0.1,
  obligatorio: true,
  descripcion: 'El rótulo del Estado emisor, en la cabecera del anverso.',
};

export const AUTORIDAD_SEGIP: AnclajeDeCatalogo = {
  id: 'autoridad-segip',
  cara: 'ANVERSO',
  patron: /SERVICIO\s+GENERAL\s+DE\s+IDENTIFICACION\s+PERSONAL|\bSEGIP\b/u,
  grafias: ['SERVICIO GENERAL DE IDENTIFICACION PERSONAL', 'IDENTIFICACION PERSONAL', 'SEGIP'],
  peso: 0.1,
  obligatorio: true,
  descripcion: 'La autoridad emisora: SEGIP, por su nombre completo o su sigla.',
};

export const ROTULO_CEDULA: AnclajeDeCatalogo = {
  id: 'rotulo-cedula',
  cara: 'ANVERSO',
  patron: /CEDULA\s+DE\s+IDENTIDAD/u,
  grafias: ['CEDULA DE IDENTIDAD', 'IDENTIDAD', 'CEDULA'],
  peso: 0.08,
  obligatorio: true,
  descripcion: 'El nombre del documento.',
};

/*
 * NOMBRES y APELLIDOS ya NO son obligatorios, y el cambio está medido.
 *
 * Lo eran porque toda cédula los imprime —lo cual es cierto— pero «obligatorio»
 * en este catálogo no significa «la tarjeta lo lleva» sino «que no aparezca ya es
 * motivo de sospecha», y eso resultó ser falso. Los dos rótulos van impresos en
 * gris claro, a cuerpo minúsculo, PEGADOS AL RETRATO, que es la peor vecindad
 * posible para un reconocedor. Medido sobre una cédula boliviana auténtica del
 * DS 4924 fotografiada con un móvil, a cuatro resoluciones distintas y con la
 * tarjeta derecha y enfocada, el reconocedor devolvió en su lugar `CMI`, `Priti`
 * y `PrELLI`: NINGUNA de las cuatro lecturas contenía los rótulos, y en las
 * cuatro los VALORES —`PABLO`, `ARAUZ CABALLERO`— salieron perfectos.
 *
 * O sea que su ausencia no discrimina nada: aparece en la cédula legítima con
 * la misma facilidad que aparecería en una falsificación. Mantenerlos como
 * obligatorios convertía cada foto real en `TEMPLATE_REQUIRED_FIELDS_MISSING`,
 * que es una acusación de plantilla incompleta contra el documento auténtico.
 *
 * Siguen en el catálogo y siguen pesando: encontrarlos suma, porque cuando el
 * reconocedor SÍ los lee, están. Lo que ya no hacen es acusar por faltar.
 */
export const CAMPO_NOMBRES: AnclajeDeCatalogo = {
  id: 'campo-nombres',
  cara: 'ANVERSO',
  patron: /\bNOMBRES?\b/u,
  grafias: ['NOMBRES'],
  peso: 0.07,
  obligatorio: false,
  descripcion: 'El rótulo NOMBRES del anverso.',
};

export const CAMPO_APELLIDOS: AnclajeDeCatalogo = {
  id: 'campo-apellidos',
  cara: 'ANVERSO',
  patron: /\bAPELLIDOS?\b/u,
  grafias: ['APELLIDOS'],
  peso: 0.07,
  obligatorio: false,
  descripcion: 'El rótulo APELLIDOS del anverso.',
};

export const CAMPO_NACIMIENTO: AnclajeDeCatalogo = {
  id: 'campo-fecha-nacimiento',
  cara: 'ANVERSO',
  patron: /FECHA\s+DE\s+NACIMIENTO|NACID[OA]\s+EL/u,
  grafias: ['FECHA DE NACIMIENTO', 'NACIMIENTO', 'NACIDO EL', 'NACIDA EL'],
  peso: 0.07,
  obligatorio: true,
  descripcion: 'La fecha de nacimiento, rotulada o en la redacción del formato antiguo.',
};

export const CAMPO_EXPIRACION: AnclajeDeCatalogo = {
  id: 'campo-fecha-expiracion',
  cara: 'ANVERSO',
  patron: /FECHA\s+DE\s+(?:EXPIRACION|VENCIMIENTO|CADUCIDAD)|VALID[AO]\s+HASTA/u,
  grafias: ['FECHA DE EXPIRACION', 'EXPIRACION', 'VENCIMIENTO', 'CADUCIDAD', 'VALIDA HASTA'],
  peso: 0.07,
  obligatorio: true,
  descripcion: 'La caducidad impresa. Sin ella no se puede afirmar que el documento esté vigente.',
};

export const CAMPO_EMISION: AnclajeDeCatalogo = {
  id: 'campo-fecha-emision',
  cara: 'ANVERSO',
  patron: /FECHA\s+DE\s+(?:EMISION|EXPEDICION)/u,
  grafias: ['FECHA DE EMISION', 'EMISION', 'EXPEDICION'],
  peso: 0.04,
  obligatorio: false,
  descripcion: 'La fecha de emisión. El formato antiguo no siempre la rotula.',
};

/*
 * SERIE y SECCIÓN son el par que casi nadie falsifica bien.
 *
 * Son dos campos administrativos del SEGIP que aparecen juntos en el anverso y
 * que quien copia una cédula de una imagen de internet suele omitir, porque no
 * significan nada evidente para el que la copia. Pesan más que un rótulo
 * cualquiera por eso: no por lo que prueban, sino por lo que su AUSENCIA sugiere
 * cuando el resto de la tarjeta sí está.
 */
export const CAMPO_SERIE: AnclajeDeCatalogo = {
  id: 'campo-serie',
  cara: 'ANVERSO',
  patron: /\bSERIE\b/u,
  grafias: ['SERIE'],
  peso: 0.05,
  obligatorio: false,
  descripcion: 'El campo SERIE del anverso, administrativo del SEGIP.',
};

export const CAMPO_SECCION: AnclajeDeCatalogo = {
  id: 'campo-seccion',
  cara: 'ANVERSO',
  patron: /\bSECCION\b/u,
  grafias: ['SECCION'],
  peso: 0.05,
  obligatorio: false,
  descripcion: 'El campo SECCIÓN del anverso, administrativo del SEGIP.',
};

export const CAMPO_LUGAR_NACIMIENTO: AnclajeDeCatalogo = {
  id: 'campo-lugar-nacimiento',
  cara: 'REVERSO',
  patron: /LUGAR\s+DE\s+NACIMIENTO/u,
  grafias: ['LUGAR DE NACIMIENTO'],
  peso: 0.06,
  obligatorio: false,
  descripcion: 'El lugar de nacimiento del reverso: departamento, provincia y localidad.',
};

export const CAMPO_DOMICILIO: AnclajeDeCatalogo = {
  id: 'campo-domicilio',
  cara: 'REVERSO',
  patron: /\bDOMICILIO\b/u,
  grafias: ['DOMICILIO'],
  peso: 0.05,
  obligatorio: false,
  descripcion: 'El domicilio declarado, en el reverso.',
};

export const CAMPO_ESTADO_CIVIL: AnclajeDeCatalogo = {
  id: 'campo-estado-civil',
  cara: 'REVERSO',
  patron: /ESTADO\s+CIVIL/u,
  grafias: ['ESTADO CIVIL'],
  peso: 0.04,
  obligatorio: false,
  descripcion: 'El estado civil, en el reverso.',
};

export const CAMPO_OCUPACION: AnclajeDeCatalogo = {
  id: 'campo-ocupacion',
  cara: 'REVERSO',
  patron: /PROFESION\s+U\s+OCUPACION|\bOCUPACION\b/u,
  grafias: ['PROFESION U OCUPACION', 'OCUPACION'],
  peso: 0.04,
  obligatorio: false,
  descripcion: 'La profesión u ocupación, en el reverso.',
};

/*
 * Los dos campos que SÓLO existen en la tarjeta del DS 4924.
 *
 * El grupo sanguíneo es opcional para el titular, así que su ausencia no dice
 * nada; su PRESENCIA, en cambio, sitúa la tarjeta en la generación nueva sin
 * ambigüedad. El NPIOC es específico de la normativa boliviana y no aparece en
 * ningún documento de identidad de otro país: es de los anclajes más difíciles
 * de acertar por casualidad.
 */
export const CAMPO_GRUPO_SANGUINEO: AnclajeDeCatalogo = {
  id: 'campo-grupo-sanguineo',
  cara: 'REVERSO',
  patron: /GRUPO\s+SANGUINEO/u,
  grafias: ['GRUPO SANGUINEO'],
  peso: 0.05,
  obligatorio: false,
  descripcion: 'El grupo sanguíneo, opcional para el titular y exclusivo del formato 2023.',
};

export const CAMPO_NPIOC: AnclajeDeCatalogo = {
  id: 'campo-npioc',
  cara: 'REVERSO',
  patron: /NACION\s+O\s+PUEBLO\s+INDIGENA|\bNPIOC\b/u,
  grafias: ['NACION O PUEBLO INDIGENA', 'NPIOC'],
  peso: 0.06,
  obligatorio: false,
  descripcion:
    'La nación o pueblo indígena originario campesino. Exclusivo de la normativa boliviana.',
};

/*
 * ── Anclajes de VALOR ──────────────────────────────────────────────────────
 *
 * Los de arriba buscan RÓTULOS. Éstos buscan lo que la tarjeta imprime GRANDE, y
 * existen porque el reparto de tamaños de una cédula es exactamente el contrario
 * del que un catálogo de rótulos supone: los rótulos van en gris a 1,2 mm y los
 * valores en negro al doble de cuerpo. Medido sobre una cédula real, el
 * reconocedor pierde `NOMBRES` y `SERIE` y en cambio entrega `N° 7689658`,
 * `07/12/2001` y `SANTA CRUZ` sin un solo error a las cuatro resoluciones
 * probadas.
 *
 * No sustituyen a los rótulos: comprueban otra cosa. Un rótulo dice que la
 * PLANTILLA es la del SEGIP; un valor con la forma correcta dice que lo escrito
 * encima de esa plantilla también lo es. Los dos juntos son lo que un montaje
 * tiene que acertar a la vez.
 *
 * Pesan poco a propósito, por lo mismo que la proporción ID-1 en
 * `identity-evidence.ts`: una fecha y un número de siete cifras los lleva
 * cualquier papel, así que su valor está en SUMAR sobre una plantilla ya
 * reconocida, nunca en reconocer una por su cuenta.
 */
