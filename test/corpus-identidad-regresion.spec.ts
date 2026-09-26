import {
  CAMPOS_MRZ_TD1,
  CONTRADICCIONES_IDENTIDAD,
  CORTES_DE_VIDA_ACTUALES,
  DIMENSIONES,
  GENERACION_LEGADA,
  IMPOSIBLE_CON_UN_SOLO_FOTOGRAMA,
  MRZ_TD1,
  NO_REINTRODUCIR,
  NO_VERIFICABLE_EN_FOTO,
  NUMERO_DE_CEDULA,
  OBSERVACIONES_DEL_ENCARGO,
  OTROS_DOCUMENTOS,
  POLITICA_DE_PRODUCCION,
  PROCEDENCIA_CORPUS_IDENTIDAD,
  RESOLUCION,
  ROTULOS_DS4924,
  SENALES_PAD,
  UMBRAL_BIOMETRICO,
} from '../src/modules/workers/identity-verification/core/corpus/corpus-identidad.generated';
import {
  checkDigit,
  parseMrzTd1,
} from '../src/modules/workers/identity-verification/core/parsers/mrz-td1';
import {
  analizarPlantilla,
  LADO_LARGO_MINIMO_LEGIBLE,
} from '../src/modules/workers/identity-verification/core/forensics/template-conformance';
import {
  evaluarFraude,
  UMBRALES_DE_FRAUDE_POR_DEFECTO,
} from '../src/modules/workers/identity-verification/core/forensics/identity-fraud.scorer';
import { IdentityDecisionEngine } from '../src/modules/workers/identity-verification/core/domain/identity-decision.engine';
import { IdentityDecision } from '../src/modules/workers/identity-verification/core/domain/identity-enums';
import { IDENTITY_DEFAULTS } from '../src/modules/workers/identity-verification/core/identity-options';
import { esNumeroDeCedulaValido } from '../src/modules/workers/identity-verification/core/catalog/bolivia-ci.catalog';
import { PLANTILLAS } from '../src/modules/workers/identity-verification/core/catalog/bolivia-ci.catalog';
import type { ExtractedIdentityData } from '../src/modules/workers/identity-verification/core/domain/extracted-identity.types';
import type { AnalisisSemantico } from '../src/modules/workers/identity-verification/core/forensics/identity-semantic.classifier';
import type { AnalisisDeManipulacion } from '../src/modules/workers/identity-verification/core/forensics/image-tamper.analyzer';

/**
 * El corpus de identidad, ejecutado contra el worker.
 *
 * Todo lo que hay aquí protege la misma frontera: la que separa **medir** de
 * **acusar**. El corpus llegó con una política de producción explícita —modo
 * sombra, sin aceptación ni rechazo automáticos, todos los umbrales en `null`—
 * y con una lista de cinco cosas que el encargo pidió no volver a introducir.
 * Estas pruebas existen para que ninguna de las dos se pierda en la próxima
 * refactorización, porque las dos se pierden igual: sin romper nada, sin que
 * falle ningún test, y sólo se nota en la cola de revisión o en la reclamación
 * de alguien a quien se acusó sin poder demostrarlo.
 */

/** Una MRZ TD1 completa y coherente, con todos sus controles calculados. */
const MRZ_VALIDA = [
  'IDBOL1234567<<4<<<<<<<<<<<<<<<',
  '0304052F2811017BOL<<<<<<<<<<<0',
  'RODRIGUEZ<GONZALEZ<<MARIA<RENE',
].join('\n');

const CAMPOS_VACIOS: ExtractedIdentityData = {} as ExtractedIdentityData;

/** Sin servidor de embeddings: la prueba semántica no se ejecutó. */
const SEMANTICA_AUSENTE: AnalisisSemantico = {
  disponible: false,
  conformidad: null,
  mejorPositiva: null,
  mejorNegativa: null,
  margen: null,
  contradicho: false,
  modelo: null,
  indisponibilidad: 'SIN_CODIFICADOR',
};

/** La prueba semántica corrió y no encontró nada. */
const SEMANTICA_LIMPIA: AnalisisSemantico = {
  disponible: true,
  conformidad: 0.9,
  mejorPositiva: { id: 'cedula-boliviana', parecido: 0.9 },
  mejorNegativa: { id: 'plantilla-de-internet', parecido: 0.1 },
  margen: 0.8,
  contradicho: false,
  modelo: 'prueba',
};

/** El análisis de píxeles corrió y no encontró nada. */
const PIXELES_LIMPIOS: AnalisisDeManipulacion = {
  disponible: true,
  senales: [],
  medidas: {
    periodicidad: null,
    residuoMaximoRelativo: null,
    bloquesAtipicos: null,
    variacionDelRuido: null,
    marcoUniforme: null,
  },
};

describe('corpus de identidad · lo que el worker no puede hacer', () => {
  describe('la política de producción es la que el código implementa', () => {
    it('el corpus declara modo sombra y las dos automatizaciones apagadas', () => {
      expect(POLITICA_DE_PRODUCCION.modo).toBe('SHADOW_REVIEW');
      expect(POLITICA_DE_PRODUCCION.aceptacionAutomatica).toBe(false);
      expect(POLITICA_DE_PRODUCCION.rechazoAutomaticoPorFraude).toBe(false);
      expect(POLITICA_DE_PRODUCCION.forense.rechazoDuro).toBe(false);
      expect(POLITICA_DE_PRODUCCION.forense.senalesSinCalibrar).toBe('LOG_ONLY');
    });

    it('sin perfil de umbrales no se aprueba a nadie, se pregunta', () => {
      expect(IDENTITY_DEFAULTS.matchThreshold).toBeUndefined();
      expect(IDENTITY_DEFAULTS.reviewThreshold).toBeUndefined();
      expect(IDENTITY_DEFAULTS.thresholdProfileVersion).toBe('unconfigured');

      const decision = new IdentityDecisionEngine().decide({
        documentQuality: 0.9,
        requiredFieldsPresent: true,
        selfieQuality: 0.9,
        liveness: 'PASSED',
        faceSimilarity: 0.99,
        documentExpiresAt: new Date('2030-01-01T00:00:00Z'),
        now: new Date('2026-09-11T00:00:00Z'),
        minDocumentQuality: 0.5,
        minSelfieQuality: 0.5,
      });
      expect(decision.decision).toBe(IdentityDecision.REVIEW_REQUIRED);
      expect(decision.reasonCodes).toContain('THRESHOLD_PROFILE_MISSING');
    });

    it('el umbral biométrico del corpus está BLOQUEADO, con su razón', () => {
      expect(UMBRAL_BIOMETRICO.valor).toBe(null);
      expect(UMBRAL_BIOMETRICO.estado).toBe('BLOQUEADO_SIN_CALIBRACION');
      expect(UMBRAL_BIOMETRICO.paresGenuinosMedidos).toBe(1);
      expect(UMBRAL_BIOMETRICO.paresImpostoresMedidos).toBe(0);
    });

    it('los umbrales retirados no pueden volver como umbrales', () => {
      const retirados = OBSERVACIONES_DEL_ENCARGO.filter(
        (observacion) => observacion.estado === 'RETIRADO_NO_REUTILIZAR',
      );
      // 0,8824 y 0,7789: salieron de rostros dibujados y cero pares reales.
      expect(retirados.map((r) => r.valor)).toEqual(expect.arrayContaining([0.8824, 0.7789]));
      for (const observacion of OBSERVACIONES_DEL_ENCARGO) {
        expect(observacion.autorizadoComoUmbral).toBe(false);
      }
    });
  });

  describe('la prueba de vida sin calibrar escala, no rechaza', () => {
    it('el corpus marca sus cortes como no usables para rechazo automático', () => {
      expect(CORTES_DE_VIDA_ACTUALES.aceptar).toBe(0.55);
      expect(CORTES_DE_VIDA_ACTUALES.rechazar).toBe(0.35);
      expect(CORTES_DE_VIDA_ACTUALES.estado).toBe('NO_USAR_COMO_RECHAZO_AUTOMATICO');
      expect(POLITICA_DE_PRODUCCION.pad.umbralDeAceptacion).toBe(null);
      expect(POLITICA_DE_PRODUCCION.pad.umbralDeRechazo).toBe(null);
    });

    it('y el motor de decisión lo respeta: sin perfil, revisión humana', () => {
      const entrada = {
        documentQuality: 0.9,
        requiredFieldsPresent: true,
        selfieQuality: 0.9,
        liveness: 'FAILED' as const,
        faceSimilarity: 0.9,
        documentExpiresAt: new Date('2030-01-01T00:00:00Z'),
        now: new Date('2026-09-11T00:00:00Z'),
        matchThreshold: 0.8,
        reviewThreshold: 0.6,
        minDocumentQuality: 0.5,
        minSelfieQuality: 0.5,
      };
      const motor = new IdentityDecisionEngine();

      const sinCalibrar = motor.decide(entrada);
      expect(sinCalibrar.decision).toBe(IdentityDecision.REVIEW_REQUIRED);
      expect(sinCalibrar.reasonCodes).toContain('LIVENESS_PROFILE_UNCALIBRATED');

      // Con perfil calibrado sí rechaza: lo que cambia es quién firma el «no».
      const calibrado = motor.decide({ ...entrada, livenessCalibrated: true });
      expect(calibrado.decision).toBe(IdentityDecision.NOT_VERIFIED);
      expect(calibrado.reasonCodes).toEqual(['LIVENESS_FAILED']);
    });

    it('y el despliegue por omisión no declara ningún perfil de vida', () => {
      expect(IDENTITY_DEFAULTS.livenessProfileVersion).toBe('unconfigured');
    });

    it('una sola fotografía no puede demostrar vida, y el corpus enumera qué', () => {
      expect(IMPOSIBLE_CON_UN_SOLO_FOTOGRAMA).toContain('medir pulso temporal');
      expect(IMPOSIBLE_CON_UN_SOLO_FOTOGRAMA).toContain('observar paralaje');
    });
  });

  describe('ninguna señal PAD rechaza por su cuenta', () => {
    it('las catorce llegan como evidencia auxiliar o revisión', () => {
      expect(SENALES_PAD.length).toBe(14);
      for (const senal of SENALES_PAD) {
        expect(senal.accionEnProduccion).toContain('EVIDENCIA_AUXILIAR_O_REVISION');
        expect(senal.accionEnProduccion).toContain('no rechazo duro');
        // Y ninguna trae una tasa medida en el dominio de este worker.
        expect(senal.tasaDeDeteccionPublicada).toBe(null);
        expect(senal.bpcerPublicado).toBe(null);
      }
    });

    it('un parecido altísimo NO es fraude automático (contradicción C10)', () => {
      expect(POLITICA_DE_PRODUCCION.parecidoPorEncimaDe097).toBe('NO_AUTOMATIC_FRAUD');
      const c10 = CONTRADICCIONES_IDENTIDAD.find((c) => c.id === 'C10');
      expect(c10?.accion).toContain('Eliminar el rechazo automático');
    });

    it('la falta de metadatos tampoco', () => {
      expect(NO_REINTRODUCIR).toContain('Ausencia de metadatos interpretada como fraude');
      const metadata = SENALES_PAD.find((senal) => senal.id === 'metadata');
      expect(metadata?.implementacion).toContain('jamás exigir EXIF');
    });

    it('los mismos bytes en los dos papeles piden otra captura, no acusan', () => {
      expect(POLITICA_DE_PRODUCCION.mismosBytesEnDosPapeles).toBe('RECAPTURE_OR_REVIEW');
    });
  });

  describe('MRZ TD1 · la especificación del ICAO, comprobada contra el analizador', () => {
    it('reproduce los dos dígitos de control que el corpus trae calculados', () => {
      for (const ejemplo of MRZ_TD1.control.ejemplos as ReadonlyArray<{
        input: string;
        check: string;
      }>) {
        expect(checkDigit(ejemplo.input)).toBe(ejemplo.check);
      }
      expect(MRZ_TD1.control.modulo).toBe(10);
      expect(MRZ_TD1.control.pesos).toEqual([7, 3, 1]);
    });

    it('el analizador lee cada campo donde la tabla del corpus lo pone', () => {
      const mrz = parseMrzTd1(MRZ_VALIDA);
      const campo = (nombre: string) => CAMPOS_MRZ_TD1.find((c) => c.nombre === nombre);

      // Estado emisor: línea 1, posiciones 3 a 5.
      expect(campo('issuer')).toMatchObject({ linea: 1, desde: 3, hasta: 5 });
      expect(mrz?.issuingState).toBe('BOL');
      // Nacionalidad: línea 2, posiciones 16 a 18.
      expect(campo('nationality')).toMatchObject({ linea: 2, desde: 16, hasta: 18 });
      expect(mrz?.nationality).toBe('BOL');
      // Sexo: línea 2, posición 8.
      expect(campo('sex')).toMatchObject({ linea: 2, desde: 8, hasta: 8 });
      expect(mrz?.sex).toBe('F');
      // Número: línea 1, posiciones 6 a 14, con su control en la 15.
      expect(campo('document_number')).toMatchObject({ linea: 1, desde: 6, hasta: 14 });
      expect(mrz?.documentNumber).toBe('1234567');
      expect(mrz?.checks.documentNumber).toBe(true);
      expect(mrz?.checks.composite).toBe(true);
    });

    it('lo que NINGÚN dígito de control protege no puede ser una acusación', () => {
      expect(MRZ_TD1.noProtegidos).toEqual(
        expect.arrayContaining(['document code', 'issuer', 'sex', 'nationality', 'names']),
      );
      // Y un titular extranjero con cédula boliviana es un caso legítimo.
      expect(MRZ_TD1.nacionalidad.unExtranjeroPuedeTenerOtra).toBe(true);
    });

    it('un control ilegible es NO EVALUABLE, nunca fallido', () => {
      expect(POLITICA_DE_PRODUCCION.controlDeMrzFallido).toBe('REVIEW_OR_RECAPTURE');
      // Medido sobre cédulas auténticas: el compuesto llega como `?` o como `c`.
      const ilegible = MRZ_VALIDA.replace('BOL<<<<<<<<<<<0', 'BOL<<<<<<<<<<<?');
      expect(parseMrzTd1(ilegible)?.checks.composite).toBe(null);

      // Y un control que SÍ se lee y no cuadra sigue saliendo en falso.
      const alterado = MRZ_VALIDA.replace('BOL<<<<<<<<<<<0', 'BOL<<<<<<<<<<<9');
      expect(parseMrzTd1(alterado)?.checks.composite).toBe(false);
    });

    it('el compuesto se calcula sobre los segmentos que fija el corpus', () => {
      expect(MRZ_TD1.control.compuesto).toBe(
        'line1.slice(5,30) + line2.slice(0,7) + line2.slice(8,15) + line2.slice(18,29)',
      );
    });

    it('un número de más de nueve caracteres se lee, no se descarta', () => {
      expect(MRZ_TD1.desbordeDelNumero.disparador).toContain('15');
      expect(MRZ_TD1.desbordeDelNumero.significado).toContain('no checksum cero');
      expect(MRZ_TD1.desbordeDelNumero.siNoSePuedeInterpretar).toContain('REVISI');

      /*
       * Un número de doce caracteres, montado como manda la norma: los nueve
       * primeros en su sitio, un `<` en el hueco del dígito de control y el
       * resto al principio del campo opcional, seguido del control del número
       * COMPLETO y de un relleno.
       */
      const completo = 'AB1234567890';
      const control = checkDigit(completo);
      const l1 = `IDBOL${completo.slice(0, 9)}<${completo.slice(9)}${control}<`
        .padEnd(30, '<')
        .slice(0, 30);
      const l2Sin = '0304052F2811017BOL<<<<<<<<<<<';
      const compuesto = checkDigit(
        l1.slice(5, 30) + l2Sin.slice(0, 7) + l2Sin.slice(8, 15) + l2Sin.slice(18, 29),
      );
      const mrz = parseMrzTd1(
        [l1, `${l2Sin}${compuesto}`, 'RODRIGUEZ<GONZALEZ<<MARIA<RENE'].join('\n'),
      );
      expect(mrz?.documentNumber).toBe(completo);
      expect(mrz?.checks.documentNumber).toBe(true);
    });

    it('una fecha 49xxxx no se convierte en indefinida por sí sola', () => {
      expect(MRZ_TD1.fechas.caducidad2049).toMatchObject({ status: 'NO_ENCONTRADO' });
      expect(NUMERO_DE_CEDULA.caducidadIndefinida.centinela2049EsNormativo).toBe(false);
    });
  });

  describe('el número de cédula: un buscador, no un validador', () => {
    it('el corpus deja la gramática sin verificar, y lo dice', () => {
      expect(NUMERO_DE_CEDULA.raiz.longitudMinima).toBe(null);
      expect(NUMERO_DE_CEDULA.raiz.longitudMaxima).toBe(null);
      expect(NUMERO_DE_CEDULA.complemento.reglaDeDosLetras).toBe(false);
      expect(NUMERO_DE_CEDULA.complemento.claseDeCaracteres).toContain('alfanum');
    });

    it('un número que no encaja en el buscador se ANOTA, no acusa', () => {
      // Nueve cifras: fuera de lo que el buscador espera y dentro de lo que el
      // corpus dice que no se puede rechazar.
      expect(esNumeroDeCedulaValido('123456789')).toBe(false);

      const analisis = analizarPlantilla({
        textoAnverso: 'CEDULA DE IDENTIDAD',
        textoReverso: '',
        campos: {
          documentNumber: { value: '123456789', source: 'OCR' },
        } as unknown as ExtractedIdentityData,
        mrz: null,
        ahora: new Date('2026-09-11T00:00:00Z'),
        ladoLargoPx: 1600,
      });
      expect(analisis.incoherencias.map((i) => i.codigo)).not.toContain(
        'DOCUMENT_NUMBER_FORMAT_INVALID',
      );
      expect(analisis.observaciones.map((o) => o.codigo)).toContain(
        'DOCUMENT_NUMBER_SHAPE_UNEXPECTED',
      );
    });

    it('la extensión departamental es candidata, no una regla de rechazo', () => {
      expect(NUMERO_DE_CEDULA.extensionDepartamental.exigidaParaAutenticidad).toBe(false);
      expect(NUMERO_DE_CEDULA.extensionDepartamental.listaOficialVerificada).toBe(false);
      for (const candidato of NUMERO_DE_CEDULA.extensionDepartamental.candidatos) {
        expect(candidato.verificado).toBe(false);
      }
    });
  });

  describe('una plantilla que no se pudo leer no es una plantilla incompleta', () => {
    const sinTexto = {
      textoAnverso: 'CEDULA DE IDENTIDAD',
      textoReverso: '',
      campos: CAMPOS_VACIOS,
      mrz: null,
      ahora: new Date('2026-09-11T00:00:00Z'),
    };

    it('por debajo del suelo de legibilidad, la cobertura no se juzga', () => {
      const pequena = analizarPlantilla({ ...sinTexto, ladoLargoPx: 796 });
      expect(pequena.coberturaEvaluable).toBe(false);
      expect(pequena.motivoDeNoEvaluable).toContain('796');

      const grande = analizarPlantilla({ ...sinTexto, ladoLargoPx: 1600 });
      expect(grande.coberturaEvaluable).toBe(true);
    });

    it('y el fusor no la puntúa: la declara ausente', () => {
      const evaluacion = evaluarFraude({
        plantilla: analizarPlantilla({ ...sinTexto, ladoLargoPx: 796 }),
        semantica: SEMANTICA_AUSENTE,
        manipulacion: PIXELES_LIMPIOS,
        umbrales: UMBRALES_DE_FRAUDE_POR_DEFECTO,
      });
      expect(evaluacion.veredicto).toBe('CLEAR');
      expect(evaluacion.motivos).not.toContain('TEMPLATE_COVERAGE_LOW');
      expect(evaluacion.pruebasAusentes).toContain('TEMPLATE:LOW_RESOLUTION');
      expect(evaluacion.observaciones).toContain('TEMPLATE_COVERAGE_NOT_EVALUABLE');
    });

    it('en modo estricto, esa misma foto escala a una persona', () => {
      const evaluacion = evaluarFraude({
        plantilla: analizarPlantilla({ ...sinTexto, ladoLargoPx: 796 }),
        semantica: SEMANTICA_LIMPIA,
        manipulacion: PIXELES_LIMPIOS,
        umbrales: { ...UMBRALES_DE_FRAUDE_POR_DEFECTO, estricto: true },
      });
      expect(evaluacion.veredicto).toBe('REVIEW');
      expect(evaluacion.motivos).toContain('TEMPLATE_NOT_EVALUABLE_LOW_RESOLUTION');
    });

    it('el suelo sale de la conversión que el propio corpus calcula', () => {
      // 300 ppp sobre 85 mm de lado largo son 1003,94 px.
      expect(RESOLUCION.dpiRecomendado).toBe(300);
      expect(RESOLUCION.ladoLargoPara85mmA300dpi).toBeCloseTo(1003.94, 1);
      expect(LADO_LARGO_MINIMO_LEGIBLE).toBeLessThanOrEqual(
        Math.ceil(RESOLUCION.ladoLargoPara85mmA300dpi as number),
      );
      // Y ampliar una foto pequeña no crea evidencia que no estaba.
      expect(RESOLUCION.ampliarNoCreaEvidencia).toBe(true);
    });
  });

  describe('el documento: lo que la norma fija y lo que nadie verificó', () => {
    it('los rótulos del DS 4924 llegan completos y todos dicen NO ACUSAR', () => {
      const anverso = ROTULOS_DS4924.filter((rotulo) => rotulo.cara === 'ANVERSO');
      const reverso = ROTULOS_DS4924.filter((rotulo) => rotulo.cara === 'REVERSO');
      expect(anverso.length).toBe(11);
      expect(reverso.length).toBe(9);
      for (const rotulo of ROTULOS_DS4924) {
        expect(rotulo.accionSiFalta).toContain('NO_ACUSAR');
      }
      expect(anverso.map((r) => r.literal)).toContain('CÉDULA DE IDENTIDAD');
      expect(reverso.map((r) => r.literal)).toContain('LUGAR DE NACIMIENTO:');
    });

    it('hay DOS generaciones y la anterior no tiene rótulos inventados', () => {
      expect(PLANTILLAS.length).toBe(2);
      expect(GENERACION_LEGADA.rotulosOficiales).toBe(null);
      expect(GENERACION_LEGADA.exigeMrz).toBe(false);
      expect(GENERACION_LEGADA.politicaDeVigencia).toContain('No invalidar por ser legado');
    });

    it('hay DOS dimensiones legales, así que la proporción no rechaza (C04)', () => {
      expect(DIMENSIONES.ds4924).toEqual({ anchoMm: 85, altoMm: 55 });
      expect(DIMENSIONES.ed10).toMatchObject({ anchoMm: 85, altoMm: 54 });
      expect(DIMENSIONES.pruebaEstrictaDeProporcion).toBe(false);
      expect(DIMENSIONES.mapaPuedeSerHolograma).toBe(true);
    });

    it('lo que una foto no puede demostrar, no se exige', () => {
      expect(NO_VERIFICABLE_EN_FOTO.length).toBe(7);
      for (const rasgo of NO_VERIFICABLE_EN_FOTO) {
        expect(rasgo.accion).toBe('NO_EXIGIR');
        // Ni siquiera se estableció que la cédula boliviana los lleve.
        expect(rasgo.existeEnLaVarianteBoliviana).toBe(null);
      }
    });

    it('no hay regla dura de vigencia de cinco o diez años', () => {
      expect(NO_REINTRODUCIR).toContain('Regla dura de vigencia fija 5/10 años');
      // Una cédula de diez años de vigencia no levanta ninguna incoherencia.
      const analisis = analizarPlantilla({
        textoAnverso: 'CEDULA DE IDENTIDAD',
        textoReverso: '',
        campos: {
          issueDate: { value: '2016-01-10', source: 'OCR' },
          expirationDate: { value: '2026-01-10', source: 'OCR' },
          dateOfBirth: { value: '1990-05-04', source: 'OCR' },
        } as unknown as ExtractedIdentityData,
        mrz: null,
        ahora: new Date('2026-09-11T00:00:00Z'),
        ladoLargoPx: 1600,
      });
      expect(analisis.incoherencias.map((i) => i.codigo)).not.toContain(
        'VALIDITY_SPAN_IMPLAUSIBLE',
      );
    });

    it('otro documento de identidad es OTRO, nunca un fraude', () => {
      expect(OTROS_DOCUMENTOS.length).toBe(6);
      for (const documento of OTROS_DOCUMENTOS) {
        expect(documento.accion).toContain('NO_FRAUDE');
        expect(documento.anclajeExclusivoVerificado).toBe(false);
      }
      expect(POLITICA_DE_PRODUCCION.tipoDeDocumentoNoAdmitido).toBe('UNSUPPORTED_OR_RECAPTURE');
    });
  });

  describe('el corpus dice de sí mismo lo que no es', () => {
    it('no es un modelo entrenado, ni una certificación, ni una calibración', () => {
      expect(PROCEDENCIA_CORPUS_IDENTIDAD.noEsModeloEntrenado).toBe(true);
      expect(PROCEDENCIA_CORPUS_IDENTIDAD.noEsCertificacion).toBe(true);
      expect(PROCEDENCIA_CORPUS_IDENTIDAD.noEsCalibracionDeProduccion).toBe(true);
      expect(PROCEDENCIA_CORPUS_IDENTIDAD.imagenesRealesEnElPaquete).toBe(0);
    });

    it('las cinco cosas que no hay que reintroducir siguen enumeradas', () => {
      expect(NO_REINTRODUCIR.length).toBe(5);
      expect(NO_REINTRODUCIR).toEqual(
        expect.arrayContaining([
          'Recorte por color de píxel',
          'Umbral biométrico de dibujos',
          'Arbitraje automático no implementado',
        ]),
      );
    });
  });
});
