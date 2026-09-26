import type { PrismaService } from '../src/common/prisma/prisma.service';
import { DomainException } from '../src/common/errors/domain-exception';
import { FinancialInstitutionService } from '../src/modules/workers/bank-statement/institutions/financial-institution.service';
import type { InstitutionCatalogService } from '../src/modules/workers/bank-statement/institutions/institution-catalog.service';

/**
 * La carga de logotipos, que es la única superficie de este módulo por la que entra un archivo
 * que compuso una persona.
 *
 * ## Por qué existe esta batería
 *
 * Porque el guard que la protege se escribió sin una sola prueba, y ése es exactamente el patrón
 * que acaba de costarle una tarde a la cola de revisión manual de este mismo motor: un control de
 * seguridad que nadie ejercita no se rompe con estruendo, se queda callado. El día que alguien
 * añada un formato admitido —o simplifique la comprobación del SVG «porque parece redundante»—
 * nada se pondría rojo.
 *
 * ## Qué protege, y por qué el SVG es el caso serio
 *
 * Un SVG **es un documento XML**, se sirve desde el mismo origen que el portal, y un `<script>` o
 * un `onload=` dentro se ejecuta con la sesión de quien administra el padrón — que es justamente
 * la persona con permiso para cambiar qué documentos acepta el motor. Un PNG no puede hacer eso;
 * un SVG sí. Por eso se rechaza en vez de sanearse: sanear XML ajeno es una carrera que se pierde,
 * y quien sube el logotipo de un banco puede exportarlo otra vez sin guiones.
 *
 * Se prueba a través de `setLogo` y no del ayudante suelto a propósito: lo que protege al portal
 * es el CAMINO completo —tipo, tamaño y marcado activo, en ese orden—, y un ayudante correcto que
 * nadie llama no protege nada. Es el mismo error, una capa más adentro.
 */

/** PNG de 1×1. Lo mínimo que pasa por «imagen de verdad» sin ser un SVG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

/** El caso legítimo: un logotipo vectorial sin nada ejecutable dentro. */
const SVG_LIMPIO = base64(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
    '<rect width="128" height="128" rx="26" fill="#12455E"/>' +
    '<text x="64" y="64" fill="#fff" text-anchor="middle">BNB</text></svg>',
);

interface Escenario {
  service: FinancialInstitutionService;
  escrito: () => Record<string, unknown> | null;
}

function montar(): Escenario {
  let escrito: Record<string, unknown> | null = null;
  const fila = { id: 1n, code: 'BNB', name: 'Banco Nacional de Bolivia S.A.' };

  const prisma = {
    financialInstitution: {
      findUnique: () => Promise.resolve(fila),
      update: ({ data }: { data: Record<string, unknown> }) => {
        escrito = data;
        return Promise.resolve({
          ...fila,
          kind: 'MULTIPLE_BANK',
          licenseStatus: 'LICENSED',
          retailDeposits: true,
          markers: [],
          exclusions: [],
          note: null,
          website: null,
          logoData: data.logoData ?? null,
          logoContentType: data.logoContentType ?? null,
          logoSource: data.logoSource ?? null,
          logoSourceUrl: data.logoSourceUrl ?? null,
          logoUpdatedAt: data.logoUpdatedAt ?? null,
          isActive: true,
          updatedAt: new Date('2026-08-26T12:00:00.000Z'),
          updatedBy: 'analista',
        });
      },
    },
  } as unknown as PrismaService;

  const catalog = { invalidate: () => undefined } as unknown as InstitutionCatalogService;
  return { service: new FinancialInstitutionService(prisma, catalog), escrito: () => escrito };
}

/** Lo que lanzó, o `null` si no lanzó. Nunca deja pasar un éxito por un fallo esperado. */
async function fallo(work: Promise<unknown>): Promise<DomainException | null> {
  try {
    await work;
    return null;
  } catch (error) {
    return error instanceof DomainException ? error : null;
  }
}

describe('carga del logotipo de una entidad del padrón', () => {
  it('admite un SVG limpio y lo guarda marcado como cargado a mano', async () => {
    const { service, escrito } = montar();

    const entidad = await service.setLogo(
      1n,
      'BNB',
      { base64: SVG_LIMPIO, contentType: 'image/svg+xml' },
      'analista',
    );

    expect(entidad.hasLogo).toBe(true);
    /*
     * `UPLOADED` y no la fuente de la semilla: es lo que impide que la siguiente sincronización de
     * logotipos pise el que alguien subió a mano. Un trabajo que se deshace solo es peor que no
     * poder hacerlo.
     */
    expect(entidad.logoSource).toBe('UPLOADED');
    expect(escrito()?.logoContentType).toBe('image/svg+xml');
  });

  it('RECHAZA un SVG con un guion dentro', async () => {
    const { service, escrito } = montar();
    const conScript = base64(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/v1/artifacts")</script></svg>',
    );

    const error = await fallo(
      service.setLogo(1n, 'BNB', { base64: conScript, contentType: 'image/svg+xml' }, 'analista'),
    );

    expect(error?.code).toBe('INSTITUTION_LOGO_ACTIVE_SVG');
    // Y no escribió NADA. Un rechazo que deja la fila tocada no es un rechazo.
    expect(escrito()).toBeNull();
  });

  it('RECHAZA las otras formas de meter ejecución en un SVG', async () => {
    /*
     * Cuatro vectores y no uno: quitar `<script>` es lo primero que se le ocurre a cualquiera, y
     * por eso es lo que menos se usa. Un manejador en línea, un `javascript:` en un enlace, un
     * `<foreignObject>` con HTML dentro y un `<use>` que carga de fuera hacen lo mismo sin
     * escribir la palabra prohibida.
     */
    const vectores: ReadonlyArray<{ nombre: string; svg: string }> = [
      { nombre: 'manejador en línea', svg: '<svg onload="alert(1)"></svg>' },
      {
        nombre: 'enlace javascript:',
        svg: '<svg><a href="javascript:alert(1)"><rect width="10" height="10"/></a></svg>',
      },
      {
        nombre: 'foreignObject con HTML',
        svg: '<svg><foreignObject><iframe src="https://ajeno.example"></iframe></foreignObject></svg>',
      },
      { nombre: 'use remoto', svg: '<svg><use xlink:href="https://ajeno.example/x.svg#a"/></svg>' },
    ];

    for (const vector of vectores) {
      const { service, escrito } = montar();
      const error = await fallo(
        service.setLogo(
          1n,
          'BNB',
          { base64: base64(vector.svg), contentType: 'image/svg+xml' },
          'analista',
        ),
      );

      expect([vector.nombre, error?.code]).toEqual([vector.nombre, 'INSTITUTION_LOGO_ACTIVE_SVG']);
      expect([vector.nombre, escrito()]).toEqual([vector.nombre, null]);
    }
  });

  it('la comprobación del SVG NO se salta declarando otro tipo', async () => {
    /*
     * El intento obvio: mandar el mismo XML diciendo que es un PNG. El tipo lo elige quien sube,
     * así que si el guard dependiera de él no protegería de nadie. Aquí lo detiene la lista de
     * tipos admitidos —`text/xml` no está— y, si algún día se admitiera, seguiría sin poder
     * declararse a sí mismo inocente.
     */
    const { service } = montar();
    const error = await fallo(
      service.setLogo(
        1n,
        'BNB',
        { base64: base64('<svg onload="alert(1)"></svg>'), contentType: 'text/xml' },
        'analista',
      ),
    );

    expect(error?.code).toBe('INSTITUTION_LOGO_UNSUPPORTED_TYPE');
  });

  it('admite PNG y JPEG, y rechaza cualquier otro tipo', async () => {
    const { service } = montar();
    const png = await service.setLogo(
      1n,
      'BNB',
      { base64: PNG.toString('base64'), contentType: 'image/png' },
      'analista',
    );
    expect(png.hasLogo).toBe(true);

    for (const tipo of ['image/gif', 'text/html', 'application/pdf', 'image/svg']) {
      const error = await fallo(
        service.setLogo(1n, 'BNB', { base64: PNG.toString('base64'), contentType: tipo }, 'a'),
      );
      expect([tipo, error?.code]).toEqual([tipo, 'INSTITUTION_LOGO_UNSUPPORTED_TYPE']);
    }
  });

  it('rechaza el archivo vacío y el que pasa del tope', async () => {
    const { service } = montar();

    const vacio = await fallo(
      service.setLogo(1n, 'BNB', { base64: '', contentType: 'image/png' }, 'analista'),
    );
    expect(vacio?.code).toBe('INSTITUTION_LOGO_TOO_LARGE');

    // 256 KiB + 1. El tope está para que una foto arrastrada por error no acabe en una columna
    // que se lee en cada listado del padrón.
    const enorme = Buffer.alloc(256 * 1024 + 1, 0x41).toString('base64');
    const grande = await fallo(
      service.setLogo(1n, 'BNB', { base64: enorme, contentType: 'image/png' }, 'analista'),
    );
    expect(grande?.code).toBe('INSTITUTION_LOGO_TOO_LARGE');
  });

  it('acepta el prefijo `data:` que manda el navegador, sin tratarlo como contenido', async () => {
    const { service, escrito } = montar();
    await service.setLogo(
      1n,
      'BNB',
      { base64: `data:image/png;base64,${PNG.toString('base64')}`, contentType: 'image/png' },
      'analista',
    );

    // Los bytes guardados son la imagen, no la cabecera del `data:` interpretada como base64.
    expect(Buffer.from(escrito()?.logoData as Uint8Array).equals(PNG)).toBe(true);
  });

  it('una entidad que no está en el padrón no se puede decorar', async () => {
    const prisma = {
      financialInstitution: { findUnique: () => Promise.resolve(null) },
    } as unknown as PrismaService;
    const catalog = { invalidate: () => undefined } as unknown as InstitutionCatalogService;
    const service = new FinancialInstitutionService(prisma, catalog);

    const error = await fallo(
      service.setLogo(1n, 'NOEXISTE', { base64: SVG_LIMPIO, contentType: 'image/svg+xml' }, 'a'),
    );
    expect(error?.code).toBe('INSTITUTION_NOT_FOUND');
  });
});
