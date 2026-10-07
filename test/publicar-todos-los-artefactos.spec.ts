import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import manifiesto from '../scripts/lib/artefactos.manifiesto.json';

/**
 * `scripts/publicar-todos-los-artefactos.mjs`: la semilla de artefactos de un entorno.
 *
 * ## Lo que esta prueba fija
 *
 * 1. Que el manifiesto no se queda atrás: toda `scripts/lib/*.definicion.json` tiene su fila, con el
 *    código que la definición declara y un guion que existe. Sin esto, el artefacto número ocho se
 *    publicaría a mano y un entorno nuevo volvería a arrancar sin él, que es el fallo del 2026-09-28.
 * 2. Que la regla que decide qué correr es conservadora: publica lo que falta, no toca lo que ya
 *    decide, y ante una versión en revisión, aprobada o rechazada NO corre el guion (crédito, sin
 *    esto, clonaría una versión nueva encima de la que espera las firmas).
 * 3. Que nunca despliega algo sin aprobar, y que el verificador distingue publicado de desplegado.
 *
 * Se corre con `--estado` contra un Motor de mentira: los guiones de cada artefacto ya tienen su
 * propia prueba contra los DTO y el compilador reales.
 */

const SCRIPTS = join(__dirname, '..', 'scripts');
const PUBLICAR = join(SCRIPTS, 'publicar-todos-los-artefactos.mjs');
const VERIFICAR = join(SCRIPTS, 'verificar-artefactos-publicados.mjs');

type Version = { id: string; versionNumber: number; status: string };
type Motor = Record<string, { versiones: Version[]; activos: Record<string, string> }>;

function levantar(motor: Motor): Promise<{ url: string; server: Server }> {
  const codigos = Object.keys(motor);
  const pagina = (items: unknown[]) => JSON.stringify({ items, hasNextPage: false });
  const server = createServer((peticion, respuesta) => {
    const url = new URL(peticion.url ?? '/', 'http://motor');
    respuesta.setHeader('content-type', 'application/json');
    if (url.pathname === '/v1/artifacts') {
      respuesta.end(
        pagina(codigos.map((artifactCode, i) => ({ id: String(i + 1), artifactCode }))),
      );
      return;
    }
    const detalle = /^\/v1\/artifacts\/(\d+)$/.exec(url.pathname);
    if (detalle) {
      respuesta.end(JSON.stringify({ versions: motor[codigos[Number(detalle[1]) - 1]].versiones }));
      return;
    }
    if (url.pathname === '/v1/deployments') {
      const pedido = url.searchParams.get('artifactCode');
      const filas = codigos
        .filter((codigo) => !pedido || codigo === pedido)
        .flatMap((codigo) =>
          Object.entries(motor[codigo].activos).map(([entorno, versionId]) => ({
            artifactVersionId: versionId,
            deploymentStatus: 'ACTIVE',
            environment: { code: entorno },
            artifactVersion: { id: versionId, artifact: { artifactCode: codigo } },
          })),
        );
      respuesta.end(pagina(filas));
      return;
    }
    respuesta.statusCode = 404;
    respuesta.end('{}');
  });
  return new Promise((resolver) =>
    server.listen(0, '127.0.0.1', () =>
      resolver({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }),
    ),
  );
}

function correr(
  guion: string,
  argumentos: string[],
): Promise<{ code: number | null; salida: string }> {
  return new Promise((resolver, rechazar) => {
    const hijo = spawn(process.execPath, [guion, ...argumentos], {
      env: { ...process.env, MANAGEMENT_API_KEY: 'clave-de-prueba' },
    });
    let salida = '';
    hijo.stdout.on('data', (trozo: Buffer) => (salida += trozo.toString()));
    hijo.stderr.on('data', (trozo: Buffer) => (salida += trozo.toString()));
    hijo.on('error', rechazar);
    hijo.on('close', (code) => resolver({ code, salida }));
  });
}

/** La línea de la tabla final que habla de un artefacto (la última: antes va la cabecera `== …`). */
const linea = (salida: string, codigo: string) =>
  salida
    .split('\n')
    .filter((fila) => fila.includes(` ${codigo} `))
    .pop() ?? '';

const v = (id: string, versionNumber: number, status: string): Version => ({
  id,
  versionNumber,
  status,
});

/** TEST el 2026-09-28 más un artefacto en cada estado que el guion NO debe continuar. */
const MOTOR: Motor = {
  // Sembrado con `sembrar-despliegue.mjs`: la versión queda COMPILED, no DEPLOYED_*, y aun así decide.
  IDENTIDAD_CARNET_MOVIL: { versiones: [v('1', 1, 'COMPILED')], activos: { STAGING: '1' } },
  RIESGO_ONBOARDING_CLIENTE: { versiones: [v('2', 1, 'IN_REVIEW')], activos: {} },
  PARTNER_KYB_REVIEW: { versiones: [v('3', 1, 'APPROVED')], activos: {} },
  PRIVACIDAD_SOLICITUD_TITULAR: { versiones: [v('4', 1, 'REJECTED')], activos: {} },
  ATLAS_RECALIFICACION_CAPACIDAD: {
    versiones: [v('5', 1, 'DEPLOYED_TO_STAGING'), v('6', 2, 'DRAFT')],
    activos: { STAGING: '5' },
  },
};

describe('el manifiesto de artefactos', () => {
  const definiciones = readdirSync(join(SCRIPTS, 'lib')).filter((nombre) =>
    nombre.endsWith('.definicion.json'),
  );

  it('tiene una fila por cada definición del repo, y ninguna de más', () => {
    expect(manifiesto.artefactos.map((fila) => fila.definicion).sort()).toEqual(
      definiciones.sort(),
    );
  });

  it.each(manifiesto.artefactos)('$codigo apunta a su guion y a su definición', (fila) => {
    expect(existsSync(join(SCRIPTS, fila.guion))).toBe(true);
    const definicion = JSON.parse(readFileSync(join(SCRIPTS, 'lib', fila.definicion), 'utf8'));
    expect(definicion.artifact.artifactCode).toBe(fila.codigo);
    expect(readFileSync(join(SCRIPTS, fila.guion), 'utf8')).toContain(fila.definicion);
  });

  it('los exigidos son exactamente los que AtlasBackend tiene por defecto', () => {
    expect(manifiesto.artefactos.filter((fila) => fila.exigido).map((fila) => fila.codigo)).toEqual(
      [
        'IDENTIDAD_CARNET_MOVIL',
        'ATLAS_BNPL_UNDERWRITING',
        'RIESGO_ONBOARDING_CLIENTE',
        'PARTNER_KYB_REVIEW',
      ],
    );
  });
});

describe('publicar-todos-los-artefactos.mjs --estado', () => {
  let motor: { url: string; server: Server };
  beforeAll(async () => (motor = await levantar(MOTOR)));
  afterAll(() => motor.server.close());

  it('publica lo que falta, continúa su borrador y no toca lo que espera a una persona', async () => {
    const { code, salida } = await correr(PUBLICAR, [
      '--base',
      motor.url,
      '--environments',
      'STAGING',
      '--estado',
    ]);
    expect(code).toBe(0);
    expect(linea(salida, 'IDENTIDAD_CARNET_MOVIL')).toMatch(/sin tocar.*ya decide/);
    // Crédito es el único que necesita --crear en un entorno vacío.
    expect(linea(salida, 'ATLAS_BNPL_UNDERWRITING')).toMatch(/haría: publicar.*\[--crear\]/);
    expect(linea(salida, 'RIESGO_ONBOARDING_CLIENTE')).toMatch(/sin tocar.*faltan las dos firmas/);
    expect(linea(salida, 'PARTNER_KYB_REVIEW')).toMatch(/sin tocar.*falta desplegarla/);
    expect(linea(salida, 'PRIVACIDAD_SOLICITUD_TITULAR')).toMatch(/sin tocar.*una persona/);
    expect(linea(salida, 'ATLAS_RECALIFICACION_CAPACIDAD')).toMatch(/haría: publicar.*DRAFT/);
    // El de demostración no entra sin pedirlo.
    expect(salida).not.toContain('EXTRACTO_CAPACIDAD_PAGO');
  });

  it('con --deploy-aprobadas sólo desplegaría la que tiene las dos firmas', async () => {
    const { code, salida } = await correr(PUBLICAR, [
      '--base',
      motor.url,
      '--environments',
      'STAGING',
      '--estado',
      '--deploy-aprobadas',
    ]);
    expect(code).toBe(0);
    expect(salida.match(/haría: desplegar/g)).toHaveLength(1);
    expect(linea(salida, 'PARTNER_KYB_REVIEW')).toMatch(/haría: desplegar/);
    expect(linea(salida, 'RIESGO_ONBOARDING_CLIENTE')).toMatch(/sin tocar.*faltan firmas/);
    expect(linea(salida, 'ATLAS_BNPL_UNDERWRITING')).toMatch(/sin tocar.*no existe/);
  });

  it('un guion que falla no corta a los demás, y la corrida sale 1', async () => {
    // El Motor de mentira no sirve la API de escritura: los dos guiones mueren, y deben morir LOS DOS.
    const { code, salida } = await correr(PUBLICAR, [
      '--base',
      motor.url,
      '--dry-run',
      '--solo',
      'ATLAS_BNPL_UNDERWRITING,ATLAS_RECALIFICACION_CAPACIDAD',
    ]);
    expect(code).toBe(1);
    expect(salida).toContain('node scripts/atlas-underwriting-v2.mjs --base');
    expect(linea(salida, 'ATLAS_BNPL_UNDERWRITING')).toMatch(/FALLÓ/);
    expect(linea(salida, 'ATLAS_RECALIFICACION_CAPACIDAD')).toMatch(/FALLÓ/);
  });

  it('se niega a desplegar sin entorno, a publicar sin catálogo y a aceptar un código inventado', async () => {
    const sinEntorno = await correr(PUBLICAR, ['--base', motor.url, '--deploy-aprobadas']);
    expect(sinEntorno.code).toBe(2);
    const sinMotor = await correr(PUBLICAR, ['--base', 'http://127.0.0.1:9', '--estado']);
    expect(sinMotor.code).toBe(2);
    const inventado = await correr(PUBLICAR, ['--base', motor.url, '--solo', 'NO_EXISTE']);
    expect(inventado.code).toBe(2);
  });
});

describe('verificar-artefactos-publicados.mjs', () => {
  let motor: { url: string; server: Server };
  beforeAll(async () => (motor = await levantar(MOTOR)));
  afterAll(() => motor.server.close());

  it('sale 1 y nombra el exigido que falta', async () => {
    const { code, salida } = await correr(VERIFICAR, ['--base', motor.url]);
    expect(code).toBe(1);
    expect(salida).toMatch(/FALTA\s+ATLAS_BNPL_UNDERWRITING/);
    expect(salida).toMatch(/existe\s+PARTNER_KYB_REVIEW/);
  });

  it('con --exigir-despliegue, estar en el catálogo no basta', async () => {
    const codes = 'IDENTIDAD_CARNET_MOVIL,PARTNER_KYB_REVIEW';
    const catalogo = await correr(VERIFICAR, ['--base', motor.url, '--codes', codes]);
    expect(catalogo.code).toBe(0);
    const despliegue = await correr(VERIFICAR, [
      '--base',
      motor.url,
      '--codes',
      codes,
      '--exigir-despliegue',
      '--environments',
      'STAGING',
    ]);
    expect(despliegue.code).toBe(1);
    expect(despliegue.salida).toMatch(/decide\s+IDENTIDAD_CARNET_MOVIL@STAGING/);
    expect(despliegue.salida).toMatch(/SIN DESPLIEGUE\s+PARTNER_KYB_REVIEW@STAGING/);
  });
});
