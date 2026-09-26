import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DomainException } from '../src/common/errors/domain-exception';
import { CreateArtifactDto, ReplaceGraphDto } from '../src/modules/artifacts/artifact.dto';
import { CreateTestSuiteDto } from '../src/modules/testing/testing.dto';
import { CreateVariableDefinitionDto } from '../src/modules/variables/variable.dto';
import { VariableContractService } from '../src/modules/variables/variable-contract.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type {
  CompiledDecisionArtifact,
  WorkerServiceInvoker,
  WorkerServiceOutcome,
} from '../src/modules/graph/graph.types';
import {
  cargarCuerpos,
  cargarGenerador,
  compilarLoQueEnviaElGuion,
  definicion,
  motor,
  resolvedor,
  versionesSimuladas,
  type Compilado,
} from './extracto-capacidad-pago.fixture';

/**
 * `EXTRACTO_CAPACIDAD_PAGO`, portado del Motor de DEV al repositorio, ejecutado con el motor REAL.
 *
 * ## Por qué existe
 *
 * La definición vivía sólo en la base de DEV (`c4084c9` se llevó las semillas que la creaban), así
 * que un Motor nuevo no podía tenerla y nadie podía revisar un cambio suyo. `scripts/extracto-
 * capacidad-pago.mjs` la publica por la API de gestión; esta prueba comprueba lo que ese guion
 * envía: que la API lo acepta (los DTO reales), que el validador de grafo lo da por bueno, y que
 * el algoritmo decide lo que dice que decide.
 *
 * ## Qué se sustituye y qué no
 *
 * El servicio de extractos se sustituye por un doble que devuelve el contrato normalizado. No es
 * un atajo: leer un PDF depende de `pdfjs` y de la cascada de analizadores, que ya tienen sus
 * pruebas, y meterlos aquí haría que un cambio en la lectura de PDF rompiera la prueba del
 * ALGORITMO. Lo que se comprueba es que, dada una respuesta del servicio, el grafo decide lo
 * que dice. La otra mitad —que el servicio real lea los documentos de la suite como se declara—
 * está en `extracto-capacidad-pago-documento.spec.ts`.
 *
 * Los umbrales (confianza 0,6; 5 movimientos; cobertura 3 y 1,5) son los del grafo de DEV; no se
 * inventó ninguno. Si alguien los cambia en el JSON, los casos de borde de aquí caen a propósito.
 */

const UMBRAL_CONFIANZA = 0.6;
const UMBRAL_MOVIMIENTOS = 5;
const COBERTURA_HOLGADA = 3;
const COBERTURA_AJUSTADA = 1.5;

/**
 * Lo que devuelve `bank-statement.normalize` y el nodo proyecta. Los totales IMPRESOS van a `null`
 * a propósito, como en los siete formatos bolivianos especializados: el algoritmo lee los abonos
 * SUMADOS (`creditExtracted`), y un doble que publicara el impreso describiría otro documento.
 */
function extracto(
  parcial: {
    abonos?: number | null;
    confianza?: number;
    movimientos?: number;
    moneda?: string | null;
  } = {},
): WorkerServiceOutcome {
  const { abonos = 15_000, confianza = 0.94, movimientos = 24, moneda = 'BOB' } = parcial;
  return {
    status: 'SUCCEEDED',
    result: {
      account: { currency: moneda },
      balances: { opening: 10_000, closing: 16_769.5 },
      totals: { credit: null, debit: null, creditExtracted: abonos, debitExtracted: 8_230.5 },
      quality: { overallConfidence: confianza, warnings: [] },
      transactions: Array.from({ length: movimientos }, (_, indice) => ({ id: `t-${indice}` })),
    },
    warnings: [],
    durationMs: 12,
  };
}

const devuelve = (salida: WorkerServiceOutcome): WorkerServiceInvoker => ({
  invoke: () => Promise.resolve(salida),
});

const fallaCon = (codigo: string): WorkerServiceInvoker => ({
  invoke: () => Promise.reject(new DomainException(codigo, 'El documento no se pudo leer')),
});

function validar<T extends object>(clase: new () => T, cuerpo: unknown): string[] {
  // Las mismas opciones que el `ValidationPipe` global de `main.ts`.
  const errores = validateSync(plainToInstance(clase, cuerpo) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
    stopAtFirstError: false,
  });
  return errores.map(
    (error) => `${error.property}: ${JSON.stringify(error.constraints ?? error.children)}`,
  );
}

interface MovimientoLeido {
  fecha: Date;
  descripcion: string;
  debito: number;
  credito: number;
  saldo: number;
}

/**
 * Lee lo que el PDF sintético DECLARA, sin `pdfjs`: el generador escribe cada celda como
 * `1 0 0 1 x y Tm (texto) Tj`, así que basta con leer el flujo de contenido. Con `pdfjs` la prueba
 * no podría convivir con `bank-statement-fixtures.spec.ts` en el mismo proceso de Jest (ver
 * `scripts/verificar-suite-extracto.ts`, que sí lo lee con el motor real).
 */
function leerDocumento(base64: string) {
  const pdf = Buffer.from(base64, 'base64').toString('latin1');
  const celdas = [...pdf.matchAll(/1 0 0 1 (\d+) (\d+) Tm \(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    texto: m[3],
  }));
  const numero = (texto: string | undefined) =>
    texto === undefined ? 0 : Number(texto.replace(/\./g, '').replace(',', '.'));
  const fechaDe = (texto: string) => {
    const [dia, mes, anio] = texto.split('/').map(Number);
    return new Date(Date.UTC(anio, mes - 1, dia));
  };
  const filas = new Map<number, typeof celdas>();
  for (const celda of celdas) filas.set(celda.y, [...(filas.get(celda.y) ?? []), celda]);
  const movimientos: MovimientoLeido[] = [...filas.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, fila]) => fila)
    .filter((fila) => fila.some((c) => c.x === 20 && /^\d{2}\/\d{2}\/\d{4}$/.test(c.texto)))
    .map((fila) => {
      const en = (x: number) => fila.find((c) => c.x === x)?.texto;
      return {
        fecha: fechaDe(en(20)!),
        descripcion: en(120)!,
        debito: numero(en(420)),
        credito: numero(en(520)),
        saldo: numero(en(620)),
      };
    });
  const periodo = celdas.find((c) => c.texto.startsWith('PERIODO:'))!.texto;
  const [desde, hasta] = periodo.replace('PERIODO: ', '').split(' AL ');
  const saldoInicial = numero(
    celdas.find((c) => c.texto === 'SALDO INICIAL') &&
      celdas.find((c) => c.y === celdas.find((k) => k.texto === 'SALDO INICIAL')!.y && c.x === 620)
        ?.texto,
  );
  return { movimientos, periodo: { desde: fechaDe(desde), hasta: fechaDe(hasta) }, saldoInicial };
}

/** Cuántos meses cuenta el worker como «completos»: 28 días cubiertos (o el mes entero si es más corto) y actividad. */
function mesesCompletos(
  movimientos: MovimientoLeido[],
  periodo: { desde: Date; hasta: Date },
): number {
  const fechas = movimientos.map((m) => m.fecha.getTime());
  const desde = Math.min(periodo.desde.getTime(), ...fechas);
  const hasta = Math.max(periodo.hasta.getTime(), ...fechas);
  const dia = 86_400_000;
  let completos = 0;
  const cursor = new Date(desde);
  cursor.setUTCDate(1);
  while (cursor.getTime() <= hasta) {
    const inicio = cursor.getTime();
    const fin = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0);
    const cubiertos = Math.round((Math.min(fin, hasta) - Math.max(inicio, desde)) / dia) + 1;
    const diasDelMes = new Date(fin).getUTCDate();
    const conActividad = movimientos.some(
      (m) => m.fecha.getTime() >= inicio && m.fecha.getTime() <= fin,
    );
    if (conActividad && cubiertos >= Math.min(28, diasDelMes)) completos += 1;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return completos;
}

describe('EXTRACTO_CAPACIDAD_PAGO · la definición portada', () => {
  let compilado: Compilado;
  let artefacto: CompiledDecisionArtifact;

  beforeAll(() => {
    compilado = compilarLoQueEnviaElGuion();
    artefacto = compilado.compilado;
  });

  const contratosDeEntrada = () =>
    artefacto.variables.filter((variable) => !String(variable.usageType).startsWith('OUTPUT'));

  /** Decide como lo hace el runtime: resuelve las entradas y ejecuta con el doble del servicio. */
  async function decidir(cuota: number, invocador: WorkerServiceInvoker) {
    const resolucion = await resolvedor.resolve(
      contratosDeEntrada(),
      {
        // Base64 de `%PDF-1.4`: da igual, el servicio es un doble y no lo abre.
        extracto_pdf_base64: 'JVBERi0xLjQ=',
        extracto_nombre_archivo: 'extracto.pdf',
        cuota_solicitada_extracto: cuota,
      },
      {
        tenantId: 1n,
        artifactCode: 'EXTRACTO_CAPACIDAD_PAGO',
        requestId: 't',
        allowExternal: false,
      },
    );
    expect(resolucion.valid).toBe(true);
    return motor.execute(artefacto, resolucion.values, undefined, undefined, undefined, invocador);
  }

  describe('lo que el guion envía a la API', () => {
    it('el alta del artefacto la acepta CreateArtifactDto, y sin las notas de autoría', () => {
      const cuerpos = cargarCuerpos();
      const alta = cuerpos.cuerpoDeArtefacto(definicion);
      expect(validar(CreateArtifactDto, alta)).toEqual([]);
      expect(alta).not.toHaveProperty('authoringNotes');
      expect(alta.artifactCode).toBe('EXTRACTO_CAPACIDAD_PAGO');
    });

    it('las siete variables las acepta CreateVariableDefinitionDto y su contrato es válido', () => {
      const cuerpos = cargarCuerpos();
      const contratos = new VariableContractService({} as PrismaService);
      const variables = [
        ...definicion.inputs.map((variable) => ({ variable, direccion: 'input' as const })),
        ...definicion.outputs.map((variable) => ({ variable, direccion: 'output' as const })),
      ];
      expect(variables).toHaveLength(7);
      for (const { variable, direccion } of variables) {
        const cuerpo = cuerpos.cuerpoDeVariable(definicion, variable, direccion);
        expect({
          code: variable.code,
          errores: validar(CreateVariableDefinitionDto, cuerpo),
        }).toEqual({
          code: variable.code,
          errores: [],
        });
        const informe = contratos.validateContract(
          cuerpo.initialVersion as unknown as Parameters<
            VariableContractService['validateContract']
          >[0],
        );
        expect({ code: variable.code, problemas: informe.issues }).toEqual({
          code: variable.code,
          problemas: [],
        });
      }
    });

    it('el PDF viaja marcado como sensible y es lo único que lo está: el motor guarda su HMAC, no el documento', async () => {
      const cuerpos = cargarCuerpos();
      const sensibles = [...definicion.inputs, ...definicion.outputs]
        .filter(
          (variable) =>
            cuerpos.cuerpoDeVariable(definicion, variable, 'input').isSensitive === true,
        )
        .map((variable) => variable.code);
      expect(sensibles).toEqual(['extracto_pdf_base64']);

      // Y en la ejecución se nota: el valor no llega a `storedValue`.
      const resolucion = await resolvedor.resolve(
        contratosDeEntrada(),
        {
          extracto_pdf_base64: 'JVBERi0xLjQ=',
          extracto_nombre_archivo: 'extracto.pdf',
          cuota_solicitada_extracto: 3_500,
        },
        {
          tenantId: 1n,
          artifactCode: 'EXTRACTO_CAPACIDAD_PAGO',
          requestId: 't',
          allowExternal: false,
        },
      );
      const pdf = resolucion.snapshots.find((fila) => fila.code === 'extracto_pdf_base64');
      expect(pdf?.sensitive).toBe(true);
      expect(pdf?.storedValue).toBeNull();
    });

    it('el grafo lo acepta ReplaceGraphDto (isRequired, conditionCode, sin campos de lectura)', () => {
      expect(validar(ReplaceGraphDto, compilado.cuerpo)).toEqual([]);
      // La asimetría que rompe un puerto: la lectura trae `required` y `code`; la escritura los
      // exige con otro nombre. Ninguno de los de lectura debe colarse en el cuerpo.
      for (const dependencia of compilado.cuerpo.dependencies) {
        expect(dependencia).toHaveProperty('isRequired', true);
        expect(dependencia).not.toHaveProperty('required');
      }
      for (const arista of compilado.cuerpo.edges) {
        for (const condicion of arista.conditions) expect(condicion).not.toHaveProperty('code');
      }
      // Cada dependencia apunta a la versión de variable creada para su código.
      const versiones = versionesSimuladas();
      for (const dependencia of compilado.cuerpo.dependencies) {
        const codigo = dependencia.dependencyPath.split('.')[1];
        expect(dependencia.variableVersionId).toBe(versiones.get(codigo));
      }
    });

    it('la suite la acepta CreateTestSuiteDto: bloqueante y con los casos materializados', () => {
      const cuerpos = cargarCuerpos();
      const casos = cuerpos.casosDeLaSuite(definicion, { hoy: new Date('2026-09-25T12:00:00Z') });
      expect(definicion.suite.isBlocking).toBe(true);
      expect(validar(CreateTestSuiteDto, { ...definicion.suite, cases: casos })).toEqual([]);
      expect(casos).toHaveLength(definicion.cases.length);
      for (const caso of casos) {
        expect(Object.keys(caso.input).sort()).toEqual([
          'cuota_solicitada_extracto',
          'extracto_nombre_archivo',
          'extracto_pdf_base64',
        ]);
      }
      // Los códigos de caso son únicos: el Motor los usa como clave dentro de la suite.
      expect(new Set(casos.map((caso) => caso.caseCode)).size).toBe(casos.length);
    });
  });

  describe('el grafo portado', () => {
    it('lo da por bueno el validador completo del Motor, sin errores', () => {
      expect(compilado.informe.errors).toEqual([]);
      expect(compilado.informe.valid).toBe(true);
    });

    it('conserva las cifras de la versión 1 de DEV: 7 variables, 8 nodos, 7 aristas, 3 condiciones, 10 intermedias, 4 campos de contrato', () => {
      expect(artefacto.variables).toHaveLength(7);
      expect(Object.keys(artefacto.nodes)).toHaveLength(8);
      expect(Object.values(artefacto.edgesByNode).flat()).toHaveLength(7);
      expect(Object.keys(artefacto.conditions)).toHaveLength(3);
      expect(artefacto.intermediates).toHaveLength(10);
      expect(artefacto.outputContract).toHaveLength(4);
      expect(artefacto.startNodeKey).toBe('START');
    });

    it('los cuatro desenlaces son nodos RESULT terminales; ninguno abre caso de revisión', () => {
      const terminales = Object.values(artefacto.nodes).filter((nodo) => nodo.terminal);
      expect(terminales.map((nodo) => [nodo.key, nodo.type]).sort()).toEqual([
        ['APROBAR', 'RESULT'],
        ['APROBAR_CONDICIONADO', 'RESULT'],
        ['RECHAZAR', 'RESULT'],
        ['REVISAR', 'RESULT'],
      ]);
      // Es lo que hay: `REVISAR` es un RESULT y no un MANUAL_REVIEW, así que `REVISION_MANUAL`
      // se DEVUELVE pero no crea caso en ninguna cola. Está portado tal cual y declarado aquí para
      // que quien lo quiera cambiar sepa que es una decisión, no un olvido del puerto.
    });

    it('los umbrales son los del grafo original y no otros', () => {
      const [confianza, movimientos] = (
        artefacto.conditions.EXTRACTO_NO_CONFIABLE.expression as {
          args: Array<{ right: { value: unknown } }>;
        }
      ).args
        .slice(1)
        .map((arg) => arg.right.value);
      expect([confianza, movimientos]).toEqual([UMBRAL_CONFIANZA, UMBRAL_MOVIMIENTOS]);
      const derecha = (codigo: string) =>
        (artefacto.conditions[codigo].expression as { right: { value: unknown } }).right.value;
      expect(derecha('COBERTURA_HOLGADA')).toBe(COBERTURA_HOLGADA);
      expect(derecha('COBERTURA_SUFICIENTE')).toBe(COBERTURA_AJUSTADA);
    });

    it('el nodo que llama al servicio continúa ante un fallo y declara un valor por defecto para cada proyección', () => {
      const llamada = artefacto.nodes.ANALIZAR_EXTRACTO.config as {
        service: string;
        operation: string;
        onError: string;
        outputs: Array<{ defaultValue?: unknown; intermediateCode: string }>;
      };
      expect([llamada.service, llamada.operation, llamada.onError]).toEqual([
        'bank-statement',
        'normalize',
        'CONTINUE',
      ]);
      expect(llamada.outputs).toHaveLength(8);
      expect(llamada.outputs.every((salida) => salida.defaultValue !== undefined)).toBe(true);
      // Lee los abonos SUMADOS, no el total que imprime el banco (que llega `null`).
      const abonos = (
        artefacto.nodes.ANALIZAR_EXTRACTO.config as {
          outputs: Array<{ path: string; intermediateCode: string }>;
        }
      ).outputs.find((salida) => salida.intermediateCode === 'ext_total_creditos');
      expect(abonos?.path).toBe('result.totals.creditExtracted');
    });
  });

  describe('la decisión, con el servicio de extractos doblado', () => {
    it('aprueba cuando los abonos cubren la cuota con holgura, y publica ingreso y confianza', async () => {
      // 15.000 / 2.000 = 7,5 veces.
      const resultado = await decidir(2_000, devuelve(extracto()));
      expect(resultado.output).toMatchObject({
        decision_extracto: 'APROBADO',
        motivo_extracto: 'COBERTURA_HOLGADA',
        ingreso_verificado: 15_000,
        confianza_extracto: 0.94,
      });
      expect(resultado.terminalNodeKey).toBe('APROBAR');
    });

    it('aprueba con condiciones en la franja ajustada', async () => {
      // 15.000 / 6.000 = 2,5 veces.
      const resultado = await decidir(6_000, devuelve(extracto()));
      expect(resultado.output).toMatchObject({
        decision_extracto: 'APROBADO_CON_CONDICIONES',
        motivo_extracto: 'COBERTURA_AJUSTADA',
      });
      expect(resultado.terminalNodeKey).toBe('APROBAR_CONDICIONADO');
    });

    it('rechaza cuando los abonos no llegan a cubrir la cuota vez y media', async () => {
      // 15.000 / 12.000 = 1,25 veces.
      const resultado = await decidir(12_000, devuelve(extracto()));
      expect(resultado.output).toMatchObject({
        decision_extracto: 'RECHAZADO',
        motivo_extracto: 'COBERTURA_INSUFICIENTE',
        ingreso_verificado: 15_000,
      });
      expect(resultado.terminalNodeKey).toBe('RECHAZAR');
    });

    /*
     * Los bordes son «mayor o igual», y los dos se pueden cruzar con cifras exactas: 15.000 entre
     * 5.000 da 3 justos, y entre 10.000 da 1,5 justos, sin redondeo de por medio.
     */
    it.each([
      ['cobertura de 3 justos aprueba', 5_000, 'APROBADO'],
      ['cobertura de 2,99998 no llega a 3', 5_000.01, 'APROBADO_CON_CONDICIONES'],
      ['cobertura de 1,5 justos aprueba con condiciones', 10_000, 'APROBADO_CON_CONDICIONES'],
      ['cobertura de 1,49999 no llega a 1,5', 10_000.01, 'RECHAZADO'],
    ])('borde: %s', async (_nombre, cuota, decision) => {
      const resultado = await decidir(cuota, devuelve(extracto()));
      expect(resultado.output.decision_extracto).toBe(decision);
    });

    it('un extracto legible SIN abonos rechaza (ingreso cero), no manda a revisión', async () => {
      // `creditExtracted: null` cae al valor por defecto 0 de la proyección: cobertura 0.
      const resultado = await decidir(3_500, devuelve(extracto({ abonos: null })));
      expect(resultado.output).toMatchObject({
        decision_extracto: 'RECHAZADO',
        motivo_extracto: 'COBERTURA_INSUFICIENTE',
        ingreso_verificado: 0,
      });
    });

    describe('la fiabilidad del extracto manda sobre la cobertura', () => {
      it.each([
        ['confianza 0,59', { confianza: 0.59 }, 'REVISION_MANUAL'],
        ['confianza 0,6 justa (el corte es «menor que»)', { confianza: 0.6 }, 'APROBADO'],
        ['4 movimientos', { movimientos: 4 }, 'REVISION_MANUAL'],
        ['5 movimientos justos (el corte es «menor que»)', { movimientos: 5 }, 'APROBADO'],
      ])('%s', async (_nombre, parcial, decision) => {
        // Cuota de 2.000: la cobertura sobra (7,5), así que lo único que decide es la fiabilidad.
        const resultado = await decidir(2_000, devuelve(extracto(parcial)));
        expect(resultado.output.decision_extracto).toBe(decision);
        if (decision === 'REVISION_MANUAL') {
          expect(resultado.output.motivo_extracto).toBe('EXTRACTO_NO_CONFIABLE');
          expect(resultado.terminalNodeKey).toBe('REVISAR');
        }
      });

      it('un PDF ilegible no rompe la decisión: la desvía a revisión con ingreso y confianza en cero', async () => {
        // Es la razón de `onError: CONTINUE`. Con `FAIL` sería un error HTTP y el analista se
        // quedaría sin decisión y sin motivo.
        const resultado = await decidir(3_500, fallaCon('NOT_A_FINANCIAL_STATEMENT'));
        expect(resultado.output).toMatchObject({
          decision_extracto: 'REVISION_MANUAL',
          motivo_extracto: 'EXTRACTO_NO_CONFIABLE',
          ingreso_verificado: 0,
          confianza_extracto: 0,
        });
        expect(resultado.terminalNodeKey).toBe('REVISAR');
        expect(resultado.manualReview).toBeUndefined();
      });

      it('una lectura con advertencias NO es un fallo: sigue y decide por lo que leyó', async () => {
        const conAvisos: WorkerServiceOutcome = {
          ...extracto(),
          status: 'SUCCEEDED_WITH_WARNINGS',
          warnings: ['cobertura-insuficiente: el extracto cubre 2 mes(es) completo(s)'],
        };
        const resultado = await decidir(2_000, devuelve(conAvisos));
        expect(resultado.output.decision_extracto).toBe('APROBADO');
      });
    });

    it('lo que produce el servicio (las ext_*) no sale en la respuesta pública', async () => {
      const resultado = await decidir(2_000, devuelve(extracto()));
      const claves = Object.keys(resultado.output);
      expect(claves.filter((clave) => clave.startsWith('ext_'))).toEqual([]);
      expect(claves).toEqual(
        expect.arrayContaining([
          'confianza_extracto',
          'decision_extracto',
          'ingreso_verificado',
          'motivo_extracto',
        ]),
      );
    });

    it('sin invocador de workers el nodo falla cerrado: nunca decide con datos que no leyó', async () => {
      const resolucion = await resolvedor.resolve(
        contratosDeEntrada(),
        {
          extracto_pdf_base64: 'JVBERi0xLjQ=',
          extracto_nombre_archivo: 'extracto.pdf',
          cuota_solicitada_extracto: 3_500,
        },
        {
          tenantId: 1n,
          artifactCode: 'EXTRACTO_CAPACIDAD_PAGO',
          requestId: 't',
          allowExternal: false,
        },
      );
      await expect(motor.execute(artefacto, resolucion.values)).rejects.toMatchObject({
        code: 'WORKER_SERVICE_NOT_CONFIGURED',
      });
    });
  });

  describe('los documentos que genera la suite (lo que declaran; el worker real los lee en scripts/verificar-suite-extracto.ts)', () => {
    const generador = cargarGenerador();
    const DIA = 86_400_000;

    // Cada día de dos años, para que caigan los bordes: 1 de mes, fin de mes, febrero bisiesto y fin de año.
    const dias = Array.from(
      { length: 800 },
      (_, indice) => new Date(Date.UTC(2026, 0, 1, 15) + indice * DIA),
    );

    it('el último movimiento cae SIEMPRE el día anterior a hoy: dentro de los tres días de tolerancia de la vigencia', () => {
      for (const hoy of dias) {
        const doc = generador.construirExtractoSintetico({ hoy });
        const { movimientos, periodo } = leerDocumento(doc.base64);
        const ayer = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - 1);
        expect({
          hoy: hoy.toISOString(),
          ultimo: movimientos[movimientos.length - 1].fecha.getTime(),
        }).toEqual({
          hoy: hoy.toISOString(),
          ultimo: ayer,
        });
        expect(periodo.hasta.getTime()).toBe(ayer);
      }
    });

    it('cubre tres meses naturales completos, con las fechas en orden y los saldos encadenados', () => {
      for (const hoy of dias) {
        const doc = generador.construirExtractoSintetico({ hoy });
        const { movimientos, periodo, saldoInicial } = leerDocumento(doc.base64);
        const contexto = hoy.toISOString();
        // Tres, o cuatro si ayer cae en un mes que ya lleva 28 días: con tres la política se cumple.
        expect({
          contexto,
          suficientes: mesesCompletos(movimientos, periodo) >= 3,
        }).toEqual({ contexto, suficientes: true });
        // La carátula empieza el día 1: es lo que hace completo al primer mes.
        expect(periodo.desde.getUTCDate()).toBe(1);
        const fechas = movimientos.map((m) => m.fecha.getTime());
        expect({ contexto, ordenadas: [...fechas].sort((a, b) => a - b) }).toEqual({
          contexto,
          ordenadas: fechas,
        });
        let saldo = saldoInicial;
        for (const m of movimientos) {
          saldo = Number((saldo + m.credito - m.debito).toFixed(2));
          expect({ contexto, saldo: m.saldo }).toEqual({ contexto, saldo });
        }
      }
    });

    it('los abonos suman EXACTAMENTE tres sueldos (15.000) y el mes en curso no aporta ninguno', () => {
      for (const hoy of dias) {
        const doc = generador.construirExtractoSintetico({ hoy, ingresoMensual: 5_000 });
        const { movimientos } = leerDocumento(doc.base64);
        const abonos = Number(movimientos.reduce((suma, m) => suma + m.credito, 0).toFixed(2));
        expect({ hoy: hoy.toISOString(), abonos, declarados: doc.abonos }).toEqual({
          hoy: hoy.toISOString(),
          abonos: 15_000,
          declarados: 15_000,
        });
        expect(movimientos).toHaveLength(doc.movimientos);
        // 24 movimientos de los tres meses, más el cargo del día de cierre.
        expect(doc.movimientos).toBe(25);
      }
    });

    it('el extracto corto tiene 3 movimientos y 5.000 en abonos: por debajo del mínimo de 5 del algoritmo', () => {
      const doc = generador.construirExtractoSintetico({
        tipo: 'pocos-movimientos',
        ingresoMensual: 5_000,
      });
      const { movimientos } = leerDocumento(doc.base64);
      expect(movimientos).toHaveLength(3);
      expect(movimientos.reduce((suma, m) => suma + m.credito, 0)).toBe(5_000);
      expect(doc.movimientos).toBeLessThan(UMBRAL_MOVIMIENTOS);
    });

    it('el documento «ilegible» es una cabecera %PDF- sin estructura, y la cuota de cada caso deja el resultado que declara', () => {
      const casos = cargarCuerpos().casosDeLaSuite(definicion, {
        hoy: new Date('2026-09-25T12:00:00Z'),
      });
      const ilegible = casos.find((caso) => caso.caseCode === 'EXTRACTO-PDF-ILEGIBLE-REVISA')!;
      expect(
        Buffer.from(String(ilegible.input.extracto_pdf_base64), 'base64').toString('latin1'),
      ).toBe('%PDF-1.4');

      // La cobertura de cada caso sale de sus cifras: 15.000 de abonos entre la cuota.
      const derivada = (cuota: number) => 15_000 / cuota;
      const esperada = (codigo: string) =>
        definicion.cases.find((caso) => caso.caseCode === codigo)!;
      for (const caso of definicion.cases.filter(
        (c) => c.documento === 'tres-meses' && c.cuota > 0 && c.cuota <= 1_000_000,
      )) {
        const cobertura = derivada(caso.cuota);
        const decision =
          cobertura >= COBERTURA_HOLGADA
            ? 'APROBADO'
            : cobertura >= COBERTURA_AJUSTADA
              ? 'APROBADO_CON_CONDICIONES'
              : 'RECHAZADO';
        expect({
          caso: caso.caseCode,
          decision: esperada(caso.caseCode).expectedResult.decision_extracto,
        }).toEqual({
          caso: caso.caseCode,
          decision,
        });
      }
    });
  });

  describe('el contrato de entrada', () => {
    const resolver = (cuota: number) =>
      resolvedor.resolve(
        contratosDeEntrada(),
        {
          extracto_pdf_base64: 'JVBERi0xLjQ=',
          extracto_nombre_archivo: 'extracto.pdf',
          cuota_solicitada_extracto: cuota,
        },
        {
          tenantId: 1n,
          artifactCode: 'EXTRACTO_CAPACIDAD_PAGO',
          requestId: 't',
          allowExternal: false,
        },
      );

    it.each([
      ['cero (exclusiveMin 0)', 0, false],
      ['negativa', -1, false],
      ['un céntimo, el mínimo válido', 0.01, true],
      ['un millón justo, el máximo', 1_000_000, true],
      ['un millón y un céntimo, sobre el tope', 1_000_000.01, false],
    ])('cuota %s', async (_nombre, cuota, valida) => {
      expect((await resolver(cuota)).valid).toBe(valida);
    });

    // El JSON real de v3 no declara ningún `constraints` para `extracto_nombre_archivo` (a
    // diferencia de `cuota_solicitada_extracto`, que sí trae max/scale/exclusiveMin): un puerto
    // fiel no le inventa un tope de 255 caracteres que el artefacto original nunca tuvo.
    it('el nombre del archivo no tiene tope de longitud declarado: uno muy largo sigue siendo válido', async () => {
      const resolucion = await resolvedor.resolve(
        contratosDeEntrada(),
        {
          extracto_pdf_base64: 'JVBERi0xLjQ=',
          extracto_nombre_archivo: 'a'.repeat(500),
          cuota_solicitada_extracto: 3_500,
        },
        {
          tenantId: 1n,
          artifactCode: 'EXTRACTO_CAPACIDAD_PAGO',
          requestId: 't',
          allowExternal: false,
        },
      );
      expect(resolucion.valid).toBe(true);
    });
  });
});
