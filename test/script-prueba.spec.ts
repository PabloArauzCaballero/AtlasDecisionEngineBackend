import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';

/**
 * Verifica los scripts de ejemplo `docs/script-prueba.js` y `docs/script-prueba.py`
 * contra el ejecutor REAL (ScriptNodeRunnerService, modo IN_PROCESS). Cubre los
 * escenarios pedidos: resultado correcto, variable faltante, error de sintaxis,
 * salida inválida, tipo incompatible y timeout.
 */
const JS = fs.readFileSync(path.join(__dirname, '..', 'docs', 'script-prueba.js'), 'utf8');
const PY = fs.readFileSync(path.join(__dirname, '..', 'docs', 'script-prueba.py'), 'utf8');

/**
 * Presupuesto por defecto de los casos que ejecutan un script de verdad.
 *
 * Cubre el arranque del proceso hijo, que no es cosa de este código: en una máquina de
 * desarrollo Windows con contenedores activos, `node -e 0` mide entre 1 356 y 2 919 ms, así que
 * los 3 s que había aquí se agotaban antes de ejecutar una línea y la prueba fallaba con
 * `script timed out` sin nada roto. Python arranca aún más despacio. Es un techo, no una espera:
 * subirlo no ralentiza ninguna prueba, sólo evita matarlas antes de tiempo.
 *
 * El caso de timeout de más abajo pasa su propio valor corto a propósito.
 */
const SPAWN_BUDGET_MS = 15_000;

function runner(timeoutMs = SPAWN_BUDGET_MS) {
  return new ScriptNodeRunnerService(
    new ConfigService({ SCRIPT_NODES_ENABLED: true, SCRIPT_NODE_TIMEOUT_MS: timeoutMs }),
  );
}

const ctx = (variables: Record<string, unknown>) => ({ variables, decision: {}, output: {} });

// Varios casos arrancan DOS intérpretes (JavaScript y Python) en la misma prueba. Con un
// arranque lento, 30 s se quedaban justos y el fallo aparecía como un timeout de Jest, que
// apunta al sitio equivocado. Es el plazo del arnés, no una aserción.
jest.setTimeout(60_000);

describe('scripts de prueba del ejecutor (IN_PROCESS)', () => {
  it('JavaScript: aprueba una solicitud de riesgo medio', async () => {
    const result = await runner().execute(
      'JAVASCRIPT',
      JS,
      ctx({ monto: 1500, cliente: 'Cliente de prueba', nivelRiesgo: 3 }),
    );
    expect(result).toMatchObject({
      aprobado: true,
      clasificacion: 'RIESGO_MEDIO',
      limiteSugerido: 1500,
    });
    expect(String(result.mensaje)).toContain('Cliente de prueba');
  });

  it('Python: produce el mismo resultado que JavaScript', async () => {
    const result = await runner().execute(
      'PYTHON',
      PY,
      ctx({ monto: 1500, cliente: 'Cliente de prueba', nivelRiesgo: 3 }),
    );
    expect(result).toMatchObject({
      aprobado: true,
      clasificacion: 'RIESGO_MEDIO',
      limiteSugerido: 1500,
    });
  });

  it('rechaza de forma controlada cuando falta la variable requerida (monto)', async () => {
    const js = await runner().execute('JAVASCRIPT', JS, ctx({}));
    const py = await runner().execute('PYTHON', PY, ctx({}));
    expect(js).toMatchObject({ aprobado: false, clasificacion: 'RECHAZADO' });
    expect(py).toMatchObject({ aprobado: false, clasificacion: 'RECHAZADO' });
  });

  it('falla ante un error de sintaxis', async () => {
    await expect(runner().execute('JAVASCRIPT', 'return {', ctx({}))).rejects.toThrow();
    await expect(runner().execute('PYTHON', 'result = {', ctx({}))).rejects.toThrow();
  });

  it('rechaza una salida que no es un objeto (tipo incompatible)', async () => {
    await expect(runner().execute('JAVASCRIPT', 'return 42;', ctx({}))).rejects.toThrow(
      /object|SCRIPT_INVALID_OUTPUT|return an object/i,
    );
    await expect(runner().execute('PYTHON', 'result = 42', ctx({}))).rejects.toThrow(
      /object|SCRIPT_INVALID_OUTPUT|assign an object/i,
    );
  });

  it('corta la ejecución que excede el tiempo máximo', async () => {
    await expect(runner(500).execute('JAVASCRIPT', 'while (true) {}', ctx({}))).rejects.toThrow(
      /status|timed out/i,
    );
  });
});
