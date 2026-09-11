/**
 * Convierte los dos corpus de `corpus/` en TypeScript tipado.
 *
 *   yarn corpus:generar      reescribe los catálogos derivados
 *   yarn corpus:check        falla si lo escrito no coincide con el corpus
 *
 * ## Por qué se GENERA y no se transcribe
 *
 * Porque transcribir 147 glosas oficiales, 67 fichas de emisor y los rótulos
 * legales de una cédula a mano es garantizar que alguna se desvíe, y una glosa
 * mal copiada no rompe nada: sólo clasifica mal un movimiento de una persona,
 * en silencio, durante meses. El corpus es la fuente y este script su única
 * puerta de entrada; el hash del archivo viaja en lo generado para que la
 * prueba `corpus-catalogos-derivados.spec.ts` pueda demostrar que ninguno de
 * los dos se movió sin el otro.
 *
 * ## Qué NO hace
 *
 * No inventa. Si el corpus dice `null`, lo generado dice `null` —que significa
 * NO VERIFICADO y nunca cero, falso ni ausencia— y el código que lo consume
 * tiene que decidir qué hacer sin ese dato. No se derivan expresiones regulares
 * de glosas que el corpus marca como `match_requires_local_calibration`, no se
 * convierten grids de sensibilidad en políticas y no se promueve ningún umbral
 * sin calibrar a umbral de rechazo. Eso último no es una preferencia de estilo:
 * los dos manifiestos lo prohíben por escrito.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';

const RAIZ = resolve(__dirname, '..', '..');
const MODO_CHECK = process.argv.includes('--check');

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

function leerCorpus(nombre: string): { datos: Json; hash: string } {
  const ruta = join(RAIZ, 'corpus', nombre);
  const bytes = readFileSync(ruta);
  return {
    datos: JSON.parse(bytes.toString('utf8')),
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Un literal de TypeScript a partir de un valor del corpus, sin perder `null`. */
function lit(valor: unknown): string {
  if (valor === null || valor === undefined) return 'null';
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : 'null';
  if (typeof valor === 'boolean') return String(valor);
  if (Array.isArray(valor)) return `[${valor.map(lit).join(', ')}]`;
  if (typeof valor === 'object') {
    const campos = Object.entries(valor as Record<string, unknown>).map(
      ([clave, v]) => `${JSON.stringify(clave)}: ${lit(v)}`,
    );
    return `{ ${campos.join(', ')} }`;
  }
  return JSON.stringify(valor);
}

/**
 * Lo generado pasa por Prettier antes de compararse o escribirse.
 *
 * Sin esto, `yarn format` y `yarn corpus:check` se pelean para siempre: el
 * primero reformatea el archivo generado y el segundo lo declara desincronizado
 * del corpus. Formateando aquí, lo que el generador produce ya es lo que el
 * formateador dejaría, y las dos comprobaciones pueden estar en verde a la vez.
 */
async function formatear(ruta: string, contenido: string): Promise<string> {
  const opciones = await resolveConfig(ruta);
  return format(contenido, { ...opciones, filepath: ruta });
}

async function escribir(rutaRelativa: string, bruto: string): Promise<boolean> {
  const ruta = join(RAIZ, rutaRelativa);
  const contenido = await formatear(ruta, bruto);
  let actual: string | null = null;
  try {
    actual = readFileSync(ruta, 'utf8');
  } catch {
    actual = null;
  }
  if (actual === contenido) return false;
  if (MODO_CHECK) {
    console.error(
      `\n✗ ${rutaRelativa} NO coincide con el corpus.\n` +
        '  El corpus cambió y el catálogo derivado no. Ejecuta `yarn corpus:generar`.',
    );
    process.exitCode = 1;
    return true;
  }
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido);
  console.log(`  escrito ${rutaRelativa}`);
  return true;
}

const CABECERA = (corpus: string, hash: string, version: string) =>
  `/*
 * ARCHIVO GENERADO — no editar a mano.
 *
 * Derivado de \`corpus/${corpus}\` v${version}
 * SHA-256 del corpus: ${hash}
 *
 * Regenerar:  yarn corpus:generar
 * Comprobar:  yarn corpus:check
 */
`;

// ─────────────────────────────────────────────────────────────────────────────
// Corpus de extractos
// ─────────────────────────────────────────────────────────────────────────────

async function generarExtractos(): Promise<void> {
  const { datos, hash } = leerCorpus('corpus-extractos-bo.json');
  const m = datos.modules;
  const partes: string[] = [CABECERA('corpus-extractos-bo.json', hash, datos.manifest.version)];

  partes.push(`
/** El hash del corpus del que salió este archivo. Lo comprueba una prueba. */
export const HASH_DEL_CORPUS_EXTRACTOS = '${hash}';

/**
 * Lo que el corpus dice DE SÍ MISMO, y que gobierna cómo puede usarse.
 *
 * Viaja al código porque las prohibiciones son la parte que se olvida: un padrón
 * con fecha de corte se lee como un padrón vigente en cuanto nadie recuerda que
 * tenía fecha, y un peso aportado por el usuario se lee como un peso calibrado
 * en cuanto pierde su procedencia.
 */
export const PROCEDENCIA_CORPUS_EXTRACTOS = {
  nombre: ${lit(datos.manifest.name)},
  version: ${lit(datos.manifest.version)},
  estado: ${lit(datos.manifest.status)},
  cortes: ${lit(datos.manifest.snapshots)},
  contieneExtractosReales: ${lit(datos.manifest.contains_real_bank_statements)},
  contieneMoraObservada: ${lit(datos.manifest.contains_observed_default_cases)},
  contienePoliticaCalibrada: ${lit(datos.manifest.contains_calibrated_credit_policy)},
  semanticaDeNulos: ${lit(datos.manifest.null_semantics)},
  afirmacionesProhibidas: ${lit(datos.manifest.prohibited_claims)},
  reglasDeImportacion: ${lit(datos.manifest.importer_rules)},
} as const;
`);

  // --- Glosario oficial ------------------------------------------------------
  const glosas = m['04_glosas_bcp'];
  partes.push(`
/** Lado contable que el emisor declara para una glosa. NUNCA sustituye a la columna. */
export type DireccionDeclarada = 'DEBIT' | 'CREDIT' | 'BOTH' | 'UNSPECIFIED';

/** Qué puede hacer la capacidad de pago con el importe de una glosa. */
export type TratamientoDeIngreso =
  | 'DO_NOT_ASSUME_INCOME'
  | 'EXCLUDE_FROM_RECURRING_INCOME'
  | 'SALARY_CANDIDATE_REQUIRES_CREDIT_AND_VERIFICATION';

export interface GlosaOficial {
  /** Identificador estable dentro del corpus (\`BCR_G003\`). */
  readonly id: string;
  /** Sigla ASFI del emisor que publica el glosario. */
  readonly emisor: string;
  /** El literal EXACTO publicado por el emisor, con sus comillas y su ortografía. */
  readonly literal: string;
  /** Las alternativas que el propio literal enumera con «/» o «o». */
  readonly alternativas: readonly string[];
  readonly direccionDeclarada: DireccionDeclarada;
  /** Se permite que la columna contable contradiga la dirección declarada. */
  readonly permiteContradecirDireccion: boolean;
  /** Categoría ANALÍTICA. El corpus la marca \`INFERIDO\`: no es etiqueta del banco. */
  readonly categoria: string;
  readonly tratamientoDeIngreso: TratamientoDeIngreso;
  /** El corpus declara que casar esta glosa exige calibración con documentos reales. */
  readonly requiereCalibracionLocal: boolean;
  /** El significado depende del contexto de la fila, no sólo del literal. */
  readonly sensibleAlContexto: boolean;
  /** Veces que se observó en un extracto real de un cliente. Hoy, cero para todas. */
  readonly observacionesReales: number;
  readonly filaDeOrigen: number;
}

/**
 * El glosario oficial del emisor, tal cual lo publica.
 *
 * Son ${glosas.source_rows} filas con ${glosas.unique_official_glosa_literals ?? glosas.unique_raw_literals} literales distintos: dos filas comparten literal
 * («CERTIFI CADO» es a la vez comisión y certificado) y ésa es una propiedad
 * REAL del glosario, no un defecto de la transcripción. Por eso la consulta
 * devuelve una lista y no un registro.
 *
 * Estado en el corpus: ${glosas.status}.
 */
export const GLOSARIO_OFICIAL: readonly GlosaOficial[] = [`);
  for (const g of glosas.records) {
    partes.push(
      `  { id: ${lit(g.id)}, emisor: ${lit(g.issuer_code)}, literal: ${lit(g.raw_glosa)},` +
        ` alternativas: ${lit(g.explicit_literal_alternatives)},` +
        ` direccionDeclarada: ${lit(g.direction_hint_from_source)},` +
        ` permiteContradecirDireccion: ${lit(g.direction_override_allowed)},` +
        ` categoria: ${lit(g.analytical_category)},` +
        ` tratamientoDeIngreso: ${lit(g.income_treatment)},` +
        ` requiereCalibracionLocal: ${lit(g.match_requires_local_calibration)},` +
        ` sensibleAlContexto: ${lit(g.context_sensitive)},` +
        ` observacionesReales: ${lit(g.real_customer_observation_count)},` +
        ` filaDeOrigen: ${lit(g.source_row)} },`,
    );
  }
  partes.push(`];

/** De dónde sale el glosario y qué NO es. */
export const PROCEDENCIA_DEL_GLOSARIO = {
  emisor: ${lit(glosas.issuer_code)},
  fuente: ${lit(glosas.source)},
  filas: ${lit(glosas.source_rows)},
  literalesUnicos: ${lit(glosas.unique_raw_literals)},
  estado: ${lit(glosas.status)},
  categoriasSonInferidas: true,
} as const;
`);

  // --- Cobertura por emisor --------------------------------------------------
  const fichas = m['05_fichas_formatos_emisores'];
  partes.push(`
/**
 * Qué se sabe del FORMATO de cada emisor, que no es lo mismo que reconocerlo.
 *
 * El corpus entrega ${fichas.records.length} fichas y CERO plantillas verificadas
 * (${fichas.full_pdf_layouts_verified_in_delivery} layouts, ${fichas.official_issuer_glossaries_found} glosario oficial). Su advertencia literal:
 * «${fichas.warning}»
 *
 * Sirve para una frase que el motor no podía decir: «esto lo emitió una entidad
 * con licencia y todavía no tengo plantilla verificada para su formato», que es
 * accionable, en vez de «entidad desconocida», que es un rechazo.
 */
export interface CoberturaDeEmisor {
  readonly codigo: string;
  readonly nombre: string;
  /** \`REGISTRY_ONLY\`, \`PUBLIC_API_DOCS_NOT_PDF_LAYOUT\`, \`OFFICIAL_GLOSSARY_AND_QR_SERVICE\`… */
  readonly estadoDeCobertura: string;
  readonly plantillaVerificada: boolean;
  readonly tieneGlosarioOficial: boolean;
  /** Cómo se verifica un documento suyo, cuando se sabe. \`null\` = no verificado. */
  readonly verificacion: { readonly tipo: string | null; readonly firmaCriptografica: boolean | null };
  readonly camposDesconocidos: readonly string[];
}

export const COBERTURA_POR_EMISOR: readonly CoberturaDeEmisor[] = [`);
  for (const f of fichas.records) {
    partes.push(
      `  { codigo: ${lit(f.code)}, nombre: ${lit(f.name)},` +
        ` estadoDeCobertura: ${lit(f.coverage_status)},` +
        ` plantillaVerificada: ${lit(f.local_template_verified)},` +
        ` tieneGlosarioOficial: ${lit(Object.keys(f.glossary ?? {}).length > 0)},` +
        ` verificacion: { tipo: ${lit(f.verification?.kind ?? null)}, firmaCriptografica: ${lit(
          f.verification?.cryptographic_signature_confirmed ?? null,
        )} },` +
        ` camposDesconocidos: ${lit(f.unknown_fields ?? [])} },`,
    );
  }
  partes.push(`];
`);

  // --- Historial de entidades ------------------------------------------------
  const historial = m['03_historial_entidades'];
  partes.push(`
/**
 * Entidades que ya no están donde estaban.
 *
 * Un extracto de una entidad intervenida es un documento AUTÉNTICO y su
 * historial sigue siendo cierto: el corpus lo dice con todas las letras —«no
 * atribuir licencia operativa actual ni fraude sólo por el emisor»—. Lo que hay
 * que poder decir es el estado, no negar el documento.
 *
 * Ojo a la contradicción C02 del corpus: intervención NO implica revocación, y
 * por eso la fecha de revocación llega en \`null\` en vez de inventada.
 */
export interface EntidadHistorica {
  readonly nombre: string;
  readonly codigo: string | null;
  readonly estado: string;
  readonly fechaDelCorte: string | null;
  readonly fechaDelEvento: string | null;
  readonly sucesor: string | null;
  readonly tratamiento: string | null;
}

export const HISTORIAL_DE_ENTIDADES: readonly EntidadHistorica[] = [`);
  for (const h of historial.records) {
    partes.push(
      `  { nombre: ${lit(h.name)}, codigo: ${lit(h.code)}, estado: ${lit(h.status)},` +
        ` fechaDelCorte: ${lit(h.snapshot_date)}, fechaDelEvento: ${lit(h.event_date ?? null)},` +
        ` sucesor: ${lit(h.successor_code ?? null)}, tratamiento: ${lit(h.treatment_proposal ?? null)} },`,
    );
  }
  partes.push(`];

/** El corpus NO afirma tener la cronología completa: ${lit(historial.exhaustive_last_five_years)}. */
export const HISTORIAL_ES_EXHAUSTIVO = ${lit(historial.exhaustive_last_five_years)};
`);

  // --- Servicios complementarios (no captan depósitos, y aun así emiten papel) -
  const servicios = m['02_servicios_complementarios'];
  const relevantes = servicios.records.filter((r: Json) =>
    ['MOBILE_PAYMENT', 'CREDIT_BUREAU', 'CLEARING_HOUSE', 'CARD_ADMINISTRATOR', 'REMITTANCE'].includes(
      r.kind,
    ),
  );
  const marcas = m['06_billeteras_y_acceso_emisor'].brands;
  partes.push(`
/**
 * Las entidades de servicios financieros complementarios que aparecen en un
 * documento de una persona.
 *
 * Se quedan fuera las 200 casas de cambio del padrón: no emiten extractos de
 * cuenta y sólo añadirían ruido a la resolución de emisor.
 *
 * La razón de ser de esta lista es una confusión concreta y cara: **la marca no
 * es el operador**. «Tigo Money» lo opera E-FECTIVO ESPM S.A., que es una
 * empresa de servicio de pago móvil con licencia; excluir el documento por
 * llevar la palabra TIGO —como si fuera una factura de telefonía— descarta un
 * estado de cuenta admisible. El corpus lo formaliza en el caso de regresión
 * \`TIGO_DISTINCTION\`.
 */
export interface ServicioComplementario {
  readonly codigo: string;
  readonly nombre: string;
  readonly tipo: string;
  readonly licencia: string;
  readonly fechaDelCorte: string;
}

export const SERVICIOS_COMPLEMENTARIOS: readonly ServicioComplementario[] = [`);
  for (const s of relevantes) {
    partes.push(
      `  { codigo: ${lit(s.code)}, nombre: ${lit(s.name)}, tipo: ${lit(s.kind)},` +
        ` licencia: ${lit(s.license_status)}, fechaDelCorte: ${lit(s.status_as_of)} },`,
    );
  }
  partes.push(`];

/** Marca comercial → operador con licencia. La marca sola no resuelve nada. */
export interface MarcaDeBilletera {
  readonly marca: string;
  readonly operador: string | null;
  readonly estado: string;
  readonly admisionComoEvidencia: string | null;
}

export const MARCAS_DE_BILLETERA: readonly MarcaDeBilletera[] = [`);
  for (const b of marcas) {
    partes.push(
      `  { marca: ${lit(b.brand)}, operador: ${lit(b.issuer_code ?? b.issuer_code_candidate ?? null)},` +
        ` estado: ${lit(b.status)}, admisionComoEvidencia: ${lit(b.income_evidence_admission ?? null)} },`,
    );
  }
  partes.push(`];
`);

  // --- Tipos de documento ----------------------------------------------------
  const tipos = m['13_tipos_documento'];
  partes.push(`
/**
 * Qué clase de documento llegó y a dónde va.
 *
 * La ruta NO es un veredicto de fraude. «Esto es un comprobante de una
 * transferencia» y «esto es falso» son respuestas distintas, y confundirlas hace
 * que quien subió el archivo equivocado reciba una acusación en vez de una
 * instrucción.
 */
export interface TipoDeDocumento {
  readonly id: string;
  readonly descripcion: string;
  readonly ruta: string;
  readonly cuidado: string;
}

export const TIPOS_DE_DOCUMENTO: readonly TipoDeDocumento[] = [`);
  for (const t of tipos.records) {
    partes.push(
      `  { id: ${lit(t.id)}, descripcion: ${lit(t.conceptual_description)},` +
        ` ruta: ${lit(t.route)}, cuidado: ${lit(t.caution)} },`,
    );
  }
  partes.push(`];
`);

  // --- Parámetros de capacidad de pago ---------------------------------------
  const capacidad = m['08_capacidad_pago'];
  partes.push(`
/**
 * Los ocho parámetros que gobiernan la capacidad de pago, con su procedencia.
 *
 * Ninguno está calibrado contra mora observada —\`calibrado: false\` en los ocho—
 * y el corpus entrega para cada uno la rejilla de sensibilidad con la que habría
 * que medirlo. **La rejilla no es una política**: el propio corpus lo marca con
 * \`grid_is_not_policy\`, y ésa es la diferencia entre «estos son los valores que
 * hay que probar» y «estos son los valores que hay que poner».
 *
 * Que esto llegue al código no es documentación: es lo que permite que la
 * evaluación PUBLIQUE que sus umbrales no están calibrados, en vez de entregar
 * un número que parece medido.
 */
export interface ParametroDeCapacidad {
  readonly id: string;
  readonly valorActual: number;
  readonly unidad: string;
  readonly procedencia: string;
  readonly calibradoConMora: boolean;
  /** Valor verificado que debería sustituirlo. Hoy \`null\` en los ocho. */
  readonly sustitutoVerificado: number | null;
  readonly hallazgo: string;
  readonly rejillaDeSensibilidad: readonly number[];
  readonly errorPotencial: string;
  readonly errorMedidoDelValorActual: number | null;
}

export const PARAMETROS_DE_CAPACIDAD: readonly ParametroDeCapacidad[] = [`);
  for (const p of capacidad.parameter_audit) {
    partes.push(
      `  { id: ${lit(p.id)}, valorActual: ${lit(p.current_value)}, unidad: ${lit(p.current_unit)},` +
        ` procedencia: ${lit(p.current_value_provenance)}, calibradoConMora: ${lit(
          p.calibrated_on_observed_arrears,
        )},` +
        ` sustitutoVerificado: ${lit(p.verified_replacement_value)}, hallazgo: ${lit(p.finding)},` +
        ` rejillaDeSensibilidad: ${lit(p.experiment?.sensitivity_grid ?? [])},` +
        ` errorPotencial: ${lit(p.potential_error)},` +
        ` errorMedidoDelValorActual: ${lit(p.measured_error_of_current_value)} },`,
    );
  }
  partes.push(`];

/** Ratios de otras jurisdicciones, con su naturaleza. Ninguno es «el ratio de ASFI». */
export interface RatioComparado {
  readonly id: string;
  readonly jurisdiccion: string;
  readonly valor: number | null;
  readonly denominador: string | null;
  readonly estado: string;
  readonly vinculanteHoy: boolean | null;
}

export const RATIOS_COMPARADOS: readonly RatioComparado[] = [`);
  for (const r of capacidad.ratio_comparisons) {
    const vinculante =
      r.binding_currently ?? r.binding_currently_verified ?? (typeof r.binding === 'boolean' ? r.binding : null);
    partes.push(
      `  { id: ${lit(r.id)}, jurisdiccion: ${lit(r.jurisdiction)}, valor: ${lit(
        r.value ?? null,
      )}, denominador: ${lit(r.denominator ?? null)}, estado: ${lit(r.status)}, vinculanteHoy: ${lit(
        vinculante,
      )} },`,
    );
  }
  partes.push(`];

/** Reglas de medición del ingreso que el corpus fija y el motor tiene que respetar. */
export const REGLAS_DE_INGRESO = {
  unAbonoNoEsIngreso: ${lit(capacidad.income_methods.ledger_credit_is_not_income)},
  traspasoPropioExigeEvidenciaDeTitularidad: ${lit(
    capacidad.income_methods.own_transfer_requires_ownership_evidence,
  )},
  desembolsosNoSonIngreso: ${lit(capacidad.income_methods.credit_disbursements_are_not_income)},
  abonosRecurrentesSinIdentificar: ${lit(capacidad.income_methods.unidentified_recurring_credits)},
  mesSinIngreso: ${lit(capacidad.income_methods.zero_month_rule)},
  ingresoDeNegocio: ${lit(capacidad.income_methods.business_income)},
  efectivo: ${lit(capacidad.income_methods.cash_rule)},
  mediaRecortadaConTresMeses: ${lit(capacidad.income_methods.trimmed_mean_minimum_sample)},
} as const;

/** Subsistencia: lo verificado, y lo que NO puede deducirse de ello. */
export const SUBSISTENCIA = {
  salarioMinimo2026Bob: ${lit(capacidad.subsistence.minimum_wage_2026_bob)},
  salarioMinimoEsSubsistencia: ${lit(capacidad.subsistence.minimum_wage_is_subsistence)},
  lineaDePobreza2026Verificada: ${lit(capacidad.subsistence.verified_2026_poverty_line_bob)},
  entradasNecesarias: ${lit(capacidad.subsistence.needed_inputs)},
  incertidumbre: ${lit(capacidad.subsistence.uncertainty)},
} as const;

/** El papel del motor, en las palabras del corpus. */
export const PAPEL_DEL_MOTOR = ${lit(capacidad.engine_role)};
`);

  // --- Fraude defensivo ------------------------------------------------------
  const fraude = m['09_fraude_defensivo'];
  partes.push(`
/**
 * Las señales de fraude documental, con el peso que traía el motor y lo que el
 * corpus dice de él.
 *
 * \`calibrado: false\` en las diez. El peso que viaja aquí es el que el encargo
 * declaró, no uno medido: el corpus devuelve \`recommended_numeric_weight: null\`
 * en todas y lo dice explícitamente —«no hay probabilidad del 85 % ni peso
 * transferible verificado»—.
 *
 * El \`eje\` es la corrección de arquitectura más importante del módulo:
 * seguridad del archivo y procedencia del documento son preguntas
 * INDEPENDIENTES, y por eso un productor conocido (peso negativo) no puede
 * cancelar un fallo de seguridad. Es el caso de regresión \`SECURITY_AXIS\`.
 */
export interface SenalDeFraudeDocumental {
  readonly id: string;
  readonly pesoDeclarado: number | null;
  readonly eje: 'security' | 'provenance';
  readonly lectura: string;
  readonly calibrado: boolean;
  readonly tasaDeDeteccionPublicada: number | null;
  readonly tasaDeFalsoPositivoPublicada: number | null;
}

export const SENALES_DE_FRAUDE_DOCUMENTAL: readonly SenalDeFraudeDocumental[] = [`);
  for (const s of fraude.signals) {
    partes.push(
      `  { id: ${lit(s.id)}, pesoDeclarado: ${lit(s.current_user_weight)}, eje: ${lit(s.axis)},` +
        ` lectura: ${lit(s.assessment)}, calibrado: ${lit(s.calibrated)},` +
        ` tasaDeDeteccionPublicada: ${lit(s.published_detection_rate)},` +
        ` tasaDeFalsoPositivoPublicada: ${lit(s.published_false_positive_rate)} },`,
    );
  }
  partes.push(`];

/** Familias de alteración, con sus confusores legítimos. */
export interface FamiliaDeFraude {
  readonly id: string;
  readonly descripcion: string;
  readonly evidencia: readonly string[];
  readonly confusoresLegitimos: string;
  readonly limite: string;
}

export const FAMILIAS_DE_FRAUDE: readonly FamiliaDeFraude[] = [`);
  for (const f of fraude.families) {
    partes.push(
      `  { id: ${lit(f.id)}, descripcion: ${lit(f.description)}, evidencia: ${lit(
        f.defensive_evidence,
      )}, confusoresLegitimos: ${lit(f.legitimate_confounders)}, limite: ${lit(f.limitation)} },`,
    );
  }
  partes.push(`];

/** La arquitectura que el corpus propone, y que el gate de autenticidad aplica. */
export const ARQUITECTURA_DEFENSIVA = {
  ejesIndependientes: ${lit(fraude.architecture_proposal.independent_axes)},
  productorConocidoNoCompensaSeguridad: ${lit(
    fraude.architecture_proposal.never_offset_security_failure_with_known_producer,
  )},
  ausenciaDeFirmaNoEsRechazo: ${lit(fraude.architecture_proposal.absence_of_signature_is_not_rejection)},
  rutaSoloImagen: ${lit(fraude.architecture_proposal.image_only_routing)},
  rutaPaginaMixta: ${lit(fraude.architecture_proposal.mixed_page_routing)},
  prohibidoMutarElPdfAntesDeLaForense: ${lit(
    fraude.architecture_proposal.raw_pdf_mutation_forbidden_before_forensics,
  )},
  motivoParaElCliente: ${lit(fraude.architecture_proposal.reason_exposure.client)},
} as const;

/** Comprobaciones numéricas, con lo que cada una NO demuestra. */
export const COMPROBACIONES_NUMERICAS = [
${fraude.numeric_checks
  .map(
    (c: Json) =>
      `  { id: ${lit(c.id)}, formula: ${lit(c.formula)}, uso: ${lit(c.use ?? null)},` +
      ` confusoresLegitimos: ${lit(c.legitimate_confounders ?? null)}, restricciones: ${lit(
        c.restrictions ?? null,
      )} },`,
  )
  .join('\n')}
] as const;
`);

  // --- Impuestos -------------------------------------------------------------
  const normativa = m['07_normativa_y_tributos'];
  const porId = (id: string): Json => normativa.records.find((r: Json) => r.id === id);
  const itf = porId('BO_ITF_ABROGATION');
  const rciva = porId('BO_RCIVA_INTEREST');
  const iue = porId('BO_IUE_INTEREST');
  const smn = porId('BO_SMN_2026');
  partes.push(`
/**
 * Impuestos bolivianos que aparecen en un extracto, VERSIONADOS por hecho.
 *
 * El ITF está abrogado por la Ley ${itf.law} (promulgada el ${itf.law_promulgation_date}, reglamento
 * ${itf.regulation}) y sin embargo sigue en el glosario oficial del banco y sigue
 * apareciendo en filas reales: reversos, regularizaciones y hechos anteriores al
 * corte. El corpus resuelve la contradicción C04 así —«el vocabulario puede ser
 * histórico; no inferir vigencia normativa desde una glosa ni fraude automático
 * desde un ajuste posterior»— y por eso el campo que importa aquí no es la
 * alícuota sino \`fraudeAutomatico: false\`.
 *
 * La fecha exacta de corte operativo NO se verificó (\`${itf.exact_operational_cutoff_date}\`), así que el
 * motor no puede decidir por fecha si una fila «debía» llevar ITF.
 */
export const IMPUESTOS_BOLIVIA = {
  itf: {
    estado: ${lit(itf.status)},
    ley: ${lit(itf.law)},
    promulgacion: ${lit(itf.law_promulgation_date)},
    reglamento: ${lit(itf.regulation)},
    cargoRegularVigente: ${lit(itf.current_regular_charge_applicable)},
    alicuotaVigente: ${lit(itf.current_regular_charge_rate)},
    corteOperativoExacto: ${lit(itf.exact_operational_cutoff_date)},
    alicuotasHistoricas: ${lit(itf.previous_rates_by_period)},
    exigeInterpretacionHistorica: ${lit(itf.require_historical_tax_interpretation)},
    reglaDeFraude: ${lit(itf.fraud_rule)},
  },
  rciva: {
    estado: ${lit(rciva.status)},
    alicuota: ${lit(rciva.value)},
    base: ${lit(rciva.tax_base)},
    literales: ${lit(rciva.literal_glosas)},
    advertencia: ${lit(rciva.warning)},
  },
  iue: {
    estado: ${lit(iue.status)},
    hallazgo: ${lit(iue.finding)},
  },
  salarioMinimo: {
    valorBob: ${lit(smn.value)},
    vigenteDesde: ${lit(smn.effective_from)},
    fuente: ${lit(smn.locator)},
    esPisoDeSubsistenciaDeCredito: ${lit(smn.credit_subsistence_floor)},
  },
} as const;
`);

  // --- Casos de regresión ----------------------------------------------------
  partes.push(`
/**
 * Los ${datos.regression_specifications.records.length} casos de contrato del corpus.
 *
 * «${datos.regression_specifications.description}»
 *
 * No miden el worker: fijan lo que el worker NO puede hacer. Se ejecutan en
 * \`test/corpus-extractos-regresion.spec.ts\` contra el código de verdad.
 */
export interface CasoDeRegresionExtractos {
  readonly id: string;
  readonly clase: string;
  readonly entrada: Readonly<Record<string, unknown>>;
  readonly esperado: Readonly<Record<string, unknown>>;
  readonly explicacion: string;
}

export const CASOS_DE_REGRESION_EXTRACTOS: readonly CasoDeRegresionExtractos[] = [`);
  for (const c of datos.regression_specifications.records) {
    partes.push(
      `  { id: ${lit(c.id)}, clase: ${lit(c.kind)}, entrada: ${lit(c.input)},` +
        ` esperado: ${lit(c.expected)}, explicacion: ${lit(c.explanation)} },`,
    );
  }
  partes.push(`];
`);

  await escribir(
    'src/modules/workers/bank-statement/core/corpus/corpus-extractos.generated.ts',
    `${partes.join('\n')}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Corpus de identidad
// ─────────────────────────────────────────────────────────────────────────────

async function generarIdentidad(): Promise<void> {
  const { datos, hash } = leerCorpus('corpus-identidad-bo.json');
  const partes: string[] = [CABECERA('corpus-identidad-bo.json', hash, datos.meta.schema_version)];
  const ds4924 = datos.mission_1['1.1'].generations.find((g: Json) => g.id === 'BO_CI_DS4924');
  const legado = datos.mission_1['1.1'].generations.find((g: Json) => g.id === 'BO_CI_LEGACY');
  const numero = datos.mission_1['1.1'].number_and_expiry;
  const mrz = datos.mission_1['1.3'];

  partes.push(`
/** El hash del corpus del que salió este archivo. Lo comprueba una prueba. */
export const HASH_DEL_CORPUS_IDENTIDAD = '${hash}';

/**
 * Lo que el corpus de identidad dice DE SÍ MISMO.
 *
 * Las tres banderas de arriba son el motivo por el que este worker no aprueba
 * solo: no es un modelo entrenado, no es una certificación y no es una
 * calibración de producción. Lo declara su propio manifiesto, y el código lo
 * respeta negándose a convertir cualquiera de sus números en un rechazo
 * automático.
 */
export const PROCEDENCIA_CORPUS_IDENTIDAD = {
  titulo: ${lit(datos.meta.title)},
  version: ${lit(datos.meta.schema_version)},
  generadoEl: ${lit(datos.meta.generated_at_local)},
  noEsModeloEntrenado: ${lit(datos.meta.not_a_trained_model)},
  noEsCertificacion: ${lit(datos.meta.not_a_certification)},
  noEsCalibracionDeProduccion: ${lit(datos.meta.not_a_production_calibration)},
  imagenesRealesEnElPaquete: ${lit(datos.meta.real_images_in_package)},
  semanticaDeNulos: ${lit(datos.meta.null_semantics)},
  limitaciones: ${lit(datos.meta.limitations)},
} as const;

/**
 * Lo que el encargo pidió NO volver a introducir.
 *
 * Cada una de estas cinco cosas estuvo en el worker y cada una producía la misma
 * clase de error: una afirmación fuerte sobre una persona apoyada en una medida
 * que no la sostiene.
 */
export const NO_REINTRODUCIR: readonly string[] = ${lit(datos.context.do_not_reintroduce)};

/**
 * La política de producción del corpus. Es el contrato de este worker.
 *
 * \`SHADOW_REVIEW\` con las dos automatizaciones apagadas, y cada umbral en
 * \`null\` porque ninguno está calibrado. La lista de lo que exige CUALQUIER
 * umbral antes de encenderse es la parte que se salta todo el mundo, y por eso
 * viaja al código.
 */
export const POLITICA_DE_PRODUCCION = {
  modo: ${lit(datos.production_policy.mode)},
  aceptacionAutomatica: ${lit(datos.production_policy.auto_accept_enabled)},
  rechazoAutomaticoPorFraude: ${lit(datos.production_policy.auto_reject_fraud_enabled)},
  cotejo: {
    umbralDeAceptacion: ${lit(datos.production_policy.matching.accept_threshold)},
    umbralDeRechazo: ${lit(datos.production_policy.matching.reject_threshold)},
    huellaDelModelo: ${lit(datos.production_policy.matching.model_fingerprint)},
    idDeCalibracion: ${lit(datos.production_policy.matching.calibration_id)},
  },
  pad: {
    umbralDeAceptacion: ${lit(datos.production_policy.pad.accept_threshold)},
    umbralDeRechazo: ${lit(datos.production_policy.pad.reject_threshold)},
    fusion: ${lit(datos.production_policy.pad.fusion)},
    idDeCalibracion: ${lit(datos.production_policy.pad.calibration_id)},
  },
  forense: {
    rechazoDuro: ${lit(datos.production_policy.forensics.hard_reject_enabled)},
    senalesSinCalibrar: ${lit(datos.production_policy.forensics.uncalibrated_signals)},
  },
  senalAusente: ${lit(datos.production_policy.missing_signal)},
  tipoDeDocumentoNoAdmitido: ${lit(datos.production_policy.wrong_document_type)},
  documentoIlegible: ${lit(datos.production_policy.unreadable_document)},
  mismosBytesEnDosPapeles: ${lit(datos.production_policy.same_bytes_wrong_roles)},
  parecidoPorEncimaDe097: ${lit(datos.production_policy.high_similarity_above_0_97)},
  controlDeMrzFallido: ${lit(datos.production_policy.mrz_checksum_failure)},
  qrNoDecodificable: ${lit(datos.production_policy.qr_decode_failure)},
  todoUmbralExige: ${lit(datos.production_policy.all_thresholds_require)},
} as const;
`);

  // --- Rótulos del DS 4924 ---------------------------------------------------
  partes.push(`
/**
 * Los rótulos LEGALES de la cédula del rediseño (DS ${ds4924.id.includes('4924') ? '4924' : '?'}).
 *
 * Fechas que no hay que confundir, y el corpus las separa en dos campos por la
 * contradicción C01: el decreto es del ${ds4924.norm_date} y la emisión empieza el
 * ${ds4924.issuance_start}.
 *
 * \`accionSiFalta\` dice lo mismo en los veinte: **NO ACUSAR**. Un rótulo que el
 * reconocedor no leyó se registra como ilegible o ausente, no como indicio de
 * falsificación — y eso vale aunque falten varios, porque lo que suele faltar no
 * es el rótulo sino la resolución.
 */
export interface RotuloLegal {
  readonly orden: number;
  readonly id: string;
  readonly literal: string;
  readonly posicion: string;
  readonly cara: 'ANVERSO' | 'REVERSO';
  readonly accionSiFalta: string;
}

export const ROTULOS_DS4924: readonly RotuloLegal[] = [`);
  for (const r of ds4924.front_labels) {
    partes.push(
      `  { orden: ${lit(r.order)}, id: ${lit(r.id)}, literal: ${lit(r.literal)},` +
        ` posicion: ${lit(r.relative_position)}, cara: 'ANVERSO', accionSiFalta: ${lit(r.missing_ocr_action)} },`,
    );
  }
  for (const r of ds4924.back_labels) {
    partes.push(
      `  { orden: ${lit(r.order)}, id: ${lit(r.id)}, literal: ${lit(r.literal)},` +
        ` posicion: ${lit(r.relative_position)}, cara: 'REVERSO', accionSiFalta: ${lit(r.missing_ocr_action)} },`,
    );
  }
  partes.push(`];

/** Límites que la propia norma pone a esa lista. */
export const LIMITES_DE_LOS_ROTULOS: readonly string[] = ${lit(ds4924.literal_limits)};

/**
 * Las dos variantes dimensionales, que son DOS y no una (contradicción C04).
 *
 * El DS 4924 fija ${ds4924.dimensions.width_mm}×${ds4924.dimensions.height_mm} mm y la variante ED-10 del DS 5364 fija
 * ${ds4924.amendment_2025.ed10_variant.width_mm}×${ds4924.amendment_2025.ed10_variant.height_mm} mm. Por eso \`pruebaEstrictaDeProporcion\` es \`false\`: rechazar por la
 * relación de aspecto de una FOTO —que además depende del encuadre— acusaría a
 * una variante legítima.
 */
export const DIMENSIONES = {
  ds4924: { anchoMm: ${lit(ds4924.dimensions.width_mm)}, altoMm: ${lit(ds4924.dimensions.height_mm)} },
  ed10: { anchoMm: ${lit(ds4924.amendment_2025.ed10_variant.width_mm)}, altoMm: ${lit(
    ds4924.amendment_2025.ed10_variant.height_mm,
  )}, alcance: ${lit(ds4924.amendment_2025.ed10_variant.scope)} },
  pruebaEstrictaDeProporcion: ${lit(ds4924.dimensions.strict_photo_ratio_test)},
  mapaPuedeSerHolograma: ${lit(ds4924.amendment_2025.map_may_be_hologram)},
} as const;

/**
 * La generación anterior, que el corpus deja DELIBERADAMENTE sin rótulos.
 *
 * «${legado.reason}»
 *
 * Su política de vigencia es lo que sí está fijado: «${legado.validity_policy}»
 */
export const GENERACION_LEGADA = {
  politicaDeVigencia: ${lit(legado.validity_policy)},
  rotulosOficiales: null,
  exigeMrz: ${lit(legado.mrz_required)},
  exigeQr: ${lit(legado.qr_required)},
  catalogoCompleto: ${lit(legado.production_catalogue_complete)},
  razon: ${lit(legado.reason)},
} as const;

/** Rasgos de seguridad y qué puede decir de ellos UNA fotografía. */
export interface RasgoDeSeguridad {
  readonly id: string;
  readonly cara: string;
  readonly visibleEnFotoAmbiente: boolean | string;
  readonly loQuePuedeComprobarUnaFoto: string;
  readonly limitaciones: string;
  readonly resolucionMinimaPublicada: number | null;
}

export const RASGOS_DE_SEGURIDAD: readonly RasgoDeSeguridad[] = [`);
  for (const r of ds4924.security_features) {
    partes.push(
      `  { id: ${lit(r.id)}, cara: ${lit(r.face)}, visibleEnFotoAmbiente: ${lit(
        r.visible_in_ambient_photo,
      )}, loQuePuedeComprobarUnaFoto: ${lit(r.single_photo_check)}, limitaciones: ${lit(
        r.limitations,
      )}, resolucionMinimaPublicada: ${lit(r.published_min_resolution_px)} },`,
    );
  }
  partes.push(`];

/**
 * Lo que NO se puede comprobar con una fotografía, y por tanto NO SE EXIGE.
 *
 * Los siete llegan con \`existeEnLaVarianteBoliviana: null\` — ni siquiera se
 * estableció que la cédula los tenga. Exigir un rasgo que quizá no existe, sobre
 * un medio que no puede mostrarlo, es la receta exacta de una acusación falsa.
 */
export const NO_VERIFICABLE_EN_FOTO: readonly {
  readonly id: string;
  readonly existeEnLaVarianteBoliviana: boolean | null;
  readonly accion: string;
  readonly razon: string;
}[] = [`);
  for (const r of datos.mission_1['1.1'].not_photo_verifiable) {
    partes.push(
      `  { id: ${lit(r.id)}, existeEnLaVarianteBoliviana: ${lit(
        r.existence_in_bolivian_variant,
      )}, accion: ${lit(r.action)}, razon: ${lit(r.reason)} },`,
    );
  }
  partes.push(`];
`);

  // --- Número, complemento, extensión ----------------------------------------
  partes.push(`
/**
 * La gramática del número de cédula, que es MÁS CORTA de lo que todo el mundo
 * cree.
 *
 * Tres correcciones, y las tres van contra reglas que parecían obvias:
 *
 * 1. **El complemento NO son dos letras.** El encargo lo describía así; el
 *    Servicio de Impuestos Nacionales lo publica como alfanumérico. Validar
 *    \`[A-Z]{2}\` rechazaría complementos legítimos (contradicción C02).
 * 2. **La extensión departamental no es oficial.** Son nueve candidatos
 *    reconstruidos, no la tabla del emisor, y por eso no pueden ser motivo de
 *    rechazo (hueco G05).
 * 3. **El número es una CADENA.** Convertirlo a número borra los ceros
 *    iniciales, y no se verificó ninguna longitud mínima ni máxima que permita
 *    rechazar por tamaño (hueco G04).
 */
export const NUMERO_DE_CEDULA = {
  raiz: {
    almacenamiento: ${lit(numero.root.storage)},
    longitudMinima: ${lit(numero.root.exact_min_length)},
    longitudMaxima: ${lit(numero.root.exact_max_length)},
    normalizacion: ${lit(numero.root.normalization)},
  },
  complemento: {
    obligatorio: ${lit(numero.complement.mandatory)},
    claseDeCaracteres: ${lit(numero.complement.verified_character_class)},
    expresionExacta: ${lit(numero.complement.exact_regex)},
    reglaDeDosLetras: ${lit(numero.complement.two_letters_only_rule)},
    separador: ${lit(numero.complement.display_separator_candidate)},
    razon: ${lit(numero.complement.reason)},
  },
  extensionDepartamental: {
    exigidaParaAutenticidad: ${lit(numero.department_extension.required_for_authenticity)},
    listaOficialVerificada: ${lit(numero.department_extension.official_SEGIP_code_list_verified)},
    candidatos: ${lit(
      numero.department_extension.candidate_aliases_only.map((c: Json) => ({
        nombre: c.name,
        candidato: c.candidate,
        verificado: c.official_verified,
      })),
    )},
    razon: ${lit(numero.department_extension.reason)},
  },
  caducidadIndefinida: {
    existeLegalmente: ${lit(numero.indefinite_expiry.legally_exists)},
    literalImpresoVerificado: ${lit(numero.indefinite_expiry.printed_literal_exact)},
    centinela2049EsNormativo: ${lit(numero.indefinite_expiry.mrz_sentinel_2049_normative)},
    razon: ${lit(numero.indefinite_expiry.reason)},
  },
} as const;
`);

  // --- MRZ TD1 ---------------------------------------------------------------
  partes.push(`
/**
 * La especificación TD1 del ICAO Doc 9303 parte 5, transcrita campo a campo.
 *
 * Lo que esta tabla contesta y una implementación de memoria no: qué campos
 * están PROTEGIDOS por un dígito de control y cuáles no. El código del
 * documento, el emisor, el sexo, la nacionalidad y los nombres **no lo están**,
 * así que una discrepancia en ellos es una lectura dudosa del reconocedor, no
 * una incoherencia del documento.
 *
 * \`alcance\`: ${mrz.scope}
 */
export interface CampoMrz {
  readonly linea: 1 | 2 | 3;
  readonly desde: number;
  readonly hasta: number;
  readonly longitud: number;
  readonly nombre: string;
  readonly patron: string;
}

export const CAMPOS_MRZ_TD1: readonly CampoMrz[] = [
${mrz.fields
  .map(
    (f: Json) =>
      `  { linea: ${f.line}, desde: ${f.start}, hasta: ${f.end}, longitud: ${f.length}, nombre: ${lit(
        f.name,
      )}, patron: ${lit(f.pattern)} },`,
  )
  .join('\n')}
];

export const MRZ_TD1 = {
  lineas: ${lit(mrz.lines)},
  caracteresPorLinea: ${lit(mrz.characters_per_line)},
  alfabeto: ${lit(mrz.allowed_characters)},
  relleno: ${lit(mrz.filler)},
  /** Campos que NINGÚN dígito de control protege. */
  noProtegidos: ${lit(mrz.checksum.not_protected)},
  control: {
    modulo: ${lit(mrz.checksum.modulus)},
    pesos: ${lit(mrz.checksum.weights)},
    algoritmo: ${lit(mrz.checksum.algorithm)},
    reinicioDePesos: ${lit(mrz.checksum.weights_restart)},
    compuesto: ${lit(mrz.checksum.composite.js)},
    ejemplos: ${lit(mrz.checksum.examples)},
  },
  desbordeDelNumero: {
    disparador: ${lit(mrz.overflow_document_number.trigger)},
    significado: ${lit(mrz.overflow_document_number.meaning)},
    algoritmo: ${lit(mrz.overflow_document_number.algorithm)},
    siNoSePuedeInterpretar: ${lit(mrz.overflow_document_number.ambiguous_or_unparseable_action)},
  },
  codigoDeDocumento: {
    primerCaracter: ${lit(mrz.document_code_rules.first_character)},
    segundoCaracterProhibido: ${lit(mrz.document_code_rules.forbidden_second_character)},
    parProhibido: ${lit(mrz.document_code_rules.forbidden_pair)},
    parReservado: ${lit(mrz.document_code_rules.reserved_pair)},
    alcanceDelParReservado: ${lit(mrz.document_code_rules.reserved_pair_scope)},
    parBolivianoVerificado: ${lit(mrz.document_code_rules.bolivian_exact_pair_verified)},
  },
  fechas: {
    codificacion: ${lit(mrz.dates.encoding)},
    siglo: ${lit(mrz.dates.century)},
    elementosDesconocidos: ${lit(mrz.dates.unknown_birth_elements)},
    caducidad2049: ${lit(mrz.dates.expiry_2049)},
    caducidadDesconocida: ${lit(mrz.dates.unknown_expiry_action)},
  },
  nacionalidad: {
    emisorBolivia: ${lit(mrz.country.issuer_Bolivia)},
    nacionalidadBolivia: ${lit(mrz.country.nationality_Bolivia)},
    unExtranjeroPuedeTenerOtra: ${lit(mrz.country.foreign_holder_nationality_may_differ)},
  },
  reparacionOcr: {
    sustitucionesGlobalesAutomaticas: ${lit(mrz.ocr_repair_policy.automatic_global_substitutions)},
    metodo: ${lit(mrz.ocr_repair_policy.method)},
    pasarElControlNoDemuestraAutenticidad: ${lit(
      mrz.ocr_repair_policy.checksum_pass_proves_authenticity,
    )},
    variasHipotesisValidas: ${lit(mrz.ocr_repair_policy.multiple_valid_hypotheses)},
  },
  separadorDeNombres: ${lit(mrz.transliteration.primary_secondary_separator)},
  particulasDelNombre: ${lit(mrz.transliteration.particles)},
} as const;

/** Transliteración ICAO: de una letra acentuada a lo que puede aparecer en la MRZ. */
export const TRANSLITERACION_MRZ: readonly (readonly [string, readonly string[]])[] = [
${Object.entries(mrz.transliteration)
  .filter(([, v]) => Array.isArray(v))
  .map(([k, v]) => `  [${lit(k)}, ${lit(v)}],`)
  .join('\n')}
];

/**
 * Confusiones candidatas del reconocedor, SIN frecuencias.
 *
 * El corpus es tajante: no existe matriz de confusión medida para esta versión
 * de Tesseract, este idioma, este canal y este documento (hueco G09). Son
 * hipótesis de ENSAYO —cada una se propone y se comprueba contra el dígito de
 * control— y jamás sustituciones globales automáticas.
 */
export const CONFUSIONES_OCR_CANDIDATAS: readonly (readonly [string, string])[] = [
${datos.mission_1['1.4'].candidate_confusions_NOT_empirical
  .map((c: Json) => `  [${lit(c.reference)}, ${lit(c.recognized_candidate)}],`)
  .join('\n')}
];

/** Preprocesados propuestos, todos con el mismo estado: ensayar, no aplicar a ciegas. */
export const PREPROCESADOS_PROPUESTOS = [
${datos.mission_1['1.4'].preprocessing
  .map(
    (p: Json) =>
      `  { operacion: ${lit(p.operation)}, proposito: ${lit(p.purpose)}, estado: ${lit(p.status)},` +
      ` efectoPublicado: ${lit(p.published_effect_on_Bolivian_IDs)} },`,
  )
  .join('\n')}
] as const;

/** Resolución: la recomendación general de Tesseract y su conversión a píxeles. */
export const RESOLUCION = {
  dpiRecomendado: ${lit(datos.mission_1['1.4'].resolution.recommendation_dpi)},
  alcance: ${lit(datos.mission_1['1.4'].resolution.recommendation_scope)},
  ladoLargoPara85mmA300dpi: ${lit(
    datos.mission_1['1.4'].resolution.id_long_edge_for_85mm_at_300dpi,
  )},
  ladoLargoMinimoParaMrz: ${lit(
    datos.mission_1['1.4'].resolution.minimum_mobile_long_edge_for_reliable_MRZ,
  )},
  ampliarNoCreaEvidencia: ${lit(datos.mission_1['1.4'].resolution.upscale_does_not_create_evidence)},
} as const;
`);

  // --- Otros documentos ------------------------------------------------------
  partes.push(`
/**
 * Los otros documentos con foto que llegan a un flujo de identidad.
 *
 * Los seis con la MISMA acción: clasificar como otro o mandar a revisión, y
 * **NO FRAUDE**. Una licencia de conducir boliviana es un documento excelente
 * que este flujo no admite; decirle a quien la subió que su documento es falso
 * es mentir sobre el motivo, y el motivo es lo único que le dice qué hacer.
 */
export interface OtroDocumento {
  readonly id: string;
  readonly nombre: string;
  readonly anclajes: readonly string[];
  readonly anclajeExclusivoVerificado: boolean;
  readonly accion: string;
  readonly notas: string;
}

export const OTROS_DOCUMENTOS: readonly OtroDocumento[] = [
${datos.mission_1['1.2']
  .map(
    (d: Json) =>
      `  { id: ${lit(d.id)}, nombre: ${lit(d.name)}, anclajes: ${lit(d.anchor_candidates)},` +
      ` anclajeExclusivoVerificado: ${lit(d.exclusive_anchor_verified)}, accion: ${lit(
        d.action,
      )}, notas: ${lit(d.notes)} },`,
  )
  .join('\n')}
];
`);

  // --- PAD -------------------------------------------------------------------
  partes.push(`
/**
 * Las señales estáticas de prueba de vida que caben en UNA fotografía.
 *
 * Las catorce llegan con la misma \`accionEnProduccion\`: evidencia auxiliar o
 * revisión, **nunca rechazo duro**. Y con el mismo \`estadoDeLaEvidencia\`: no se
 * encontró tasa transferible al dominio de este worker. Sus
 * \`falsosPositivos\` son lo que explica por qué: piel grasa, gafas, un flash
 * legítimo, el laminado auténtico de la propia cédula.
 */
export interface SenalPad {
  readonly id: string;
  readonly mide: string;
  readonly implementacion: string;
  readonly falsosPositivos: readonly string[];
  readonly tasaDeDeteccionPublicada: number | null;
  readonly bpcerPublicado: number | null;
  readonly estadoDeLaEvidencia: string;
  readonly accionEnProduccion: string;
}

export const SENALES_PAD: readonly SenalPad[] = [
${datos.mission_2['2.3']
  .map(
    (s: Json) =>
      `  { id: ${lit(s.id)}, mide: ${lit(s.measures)}, implementacion: ${lit(
        s.implementation_outline,
      )}, falsosPositivos: ${lit(s.false_positive_conditions)},` +
      ` tasaDeDeteccionPublicada: ${lit(
        s.published_detection_rate_for_this_signal_in_worker_domain,
      )}, bpcerPublicado: ${lit(s.published_BPCER_for_this_signal_in_worker_domain)},` +
      ` estadoDeLaEvidencia: ${lit(s.evidence_status)}, accionEnProduccion: ${lit(
        s.production_action,
      )} },`,
  )
  .join('\n')}
];

/**
 * Lo que UNA SOLA IMAGEN no puede demostrar, se mire como se mire.
 *
 * No es una limitación del worker: es una propiedad del medio. Un fotograma no
 * contiene tiempo, así que no contiene pulso, ni parpadeo, ni paralaje, ni la
 * respuesta a un reto.
 */
export const IMPOSIBLE_CON_UN_SOLO_FOTOGRAMA: readonly string[] = ${lit(
    datos.mission_2['2.4'].single_frame_impossible,
  )};

/** Los cortes de vida que traía el motor, con su estado real. */
export const CORTES_DE_VIDA_ACTUALES = {
  aceptar: ${lit(datos.mission_2['2.7'].current_scores.min_accept)},
  rechazar: ${lit(datos.mission_2['2.7'].current_scores.min_reject)},
  poblacion: ${lit(datos.mission_2['2.7'].current_scores.population)},
  estado: ${lit(datos.mission_2['2.7'].current_scores.status)},
  direccionDelScore: ${lit(datos.mission_2['2.7'].score_direction)},
  fusionMinima: ${lit(datos.mission_2['2.7'].min_fusion.definition)},
  independenciaVerificada: ${lit(datos.mission_2['2.7'].min_fusion.independence_verified)},
} as const;
`);

  // --- Cotejo biométrico -----------------------------------------------------
  const bis = datos.mission_2bis;
  partes.push(`
/**
 * El umbral de similitud biométrica: **bloqueado**.
 *
 * «${bis.production_similarity_threshold.reason}»
 *
 * Un par genuino medido y cero pares impostores no determinan nada. Los
 * resultados publicados que el corpus recoge —DocFace, DocFace+, CHIYA— vienen
 * con \`transferable_to_worker: false\` y por un motivo concreto: su referencia
 * es un retrato extraído del CHIP, no una fotografía de una tarjeta plastificada
 * bajo un reflejo.
 */
export const UMBRAL_BIOMETRICO = {
  valor: ${lit(bis.production_similarity_threshold.value)},
  estado: ${lit(bis.production_similarity_threshold.status)},
  paresGenuinosMedidos: ${lit(
    bis.production_similarity_threshold.population.available_measured_genuine_pairs,
  )},
  paresImpostoresMedidos: ${lit(
    bis.production_similarity_threshold.population.available_measured_impostor_pairs,
  )},
  razon: ${lit(bis.production_similarity_threshold.reason)},
} as const;

/** Los ocho pasos que convierten una medición en un umbral. Ninguno es saltable. */
export const PROCEDIMIENTO_DE_CALIBRACION: readonly {
  readonly paso: number;
  readonly accion: string;
  readonly salida: string;
}[] = [
${bis.calibration_procedure
  .map((p: Json) => `  { paso: ${p.step}, accion: ${lit(p.action)}, salida: ${lit(p.output)} },`)
  .join('\n')}
];

/** Fórmulas de intervalo binomial exacto, tal y como las publica el NIST. */
export const INTERVALOS_BINOMIALES = {
  unidad: ${lit(bis.confidence.unit)},
  superiorUnilateral: ${lit(bis.confidence.upper_one_sided)},
  inferiorUnilateral: ${lit(bis.confidence.lower_one_sided)},
  bilateral: ${lit(bis.confidence.two_sided)},
  sinErroresSuperior: ${lit(bis.confidence.zero_error_upper)},
  sinErroresTamano: ${lit(bis.confidence.zero_error_size)},
  reglaDeTres: ${lit(bis.confidence.rule_of_three)},
} as const;

/** Cuántos ensayos hacen falta para poder AFIRMAR una tasa. */
export const TAMANOS_SIN_ERRORES: readonly {
  readonly confianza: number;
  readonly tasaObjetivo: number;
  readonly ensayos: number;
  readonly cotaSuperior: number;
}[] = [
${bis.confidence.zero_error_tables
  .map(
    (t: Json) =>
      `  { confianza: ${t.confidence_one_sided}, tasaObjetivo: ${t.target_error_rate}, ensayos: ${t.independent_trials_required}, cotaSuperior: ${t.upper_bound_at_n} },`,
  )
  .join('\n')}
];

/**
 * Las observaciones del encargo, con su estado.
 *
 * Las dos que importan llevan \`RETIRADO_NO_REUTILIZAR\`: los umbrales 0,8824 y
 * 0,7789 salieron de rostros DIBUJADOS y cero pares genuinos reales. Están aquí
 * para que el código pueda reconocerlos y negarse a usarlos, no para usarlos.
 */
export const OBSERVACIONES_DEL_ENCARGO: readonly {
  readonly id: string;
  readonly valor: number | readonly number[] | null;
  readonly estado: string;
  readonly autorizadoComoUmbral: boolean;
}[] = [
${datos.context.user_observations
  .map(
    (o: Json) =>
      `  { id: ${lit(o.id)}, valor: ${lit(o.value)}, estado: ${lit(
        o.status,
      )}, autorizadoComoUmbral: ${lit(o.production_threshold_authorized)} },`,
  )
  .join('\n')}
];

/** Contradicciones que el corpus resuelve, con la acción que impone cada una. */
export const CONTRADICCIONES_IDENTIDAD: readonly {
  readonly id: string;
  readonly afirmacion: string;
  readonly resuelto: string;
  readonly accion: string;
}[] = [
${datos.contradictions
  .map(
    (c: Json) =>
      `  { id: ${lit(c.id)}, afirmacion: ${lit(c.user_or_source_claim)}, resuelto: ${lit(
        c.resolved,
      )}, accion: ${lit(c.action)} },`,
  )
  .join('\n')}
];
`);

  await escribir(
    'src/modules/workers/identity-verification/core/corpus/corpus-identidad.generated.ts',
    `${partes.join('\n')}`,
  );
}

async function main(): Promise<void> {
  console.log(MODO_CHECK ? 'Comprobando catálogos derivados…' : 'Generando catálogos derivados…');
  await generarExtractos();
  await generarIdentidad();
  if (process.exitCode !== 1) console.log(MODO_CHECK ? '✓ al día' : 'listo');
}

void main();
