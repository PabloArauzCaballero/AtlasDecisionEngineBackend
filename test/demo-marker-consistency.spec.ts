import { DEMO_REQUEST_LIKE, DEMO_REQUEST_PREFIX } from '../src/common/seeding/demo-marker';

/**
 * El sembrador ESCRIBE la marca y el monitoreo la BUSCA. Esta prueba es el único sitio donde
 * las dos mitades se miran a la cara.
 *
 * El fallo que persigue no es que el aviso salga mal: es que salga APAGADO. Si el patrón que
 * usa `decision-coverage.service.ts` deja de casar con el `requestId` que escribe
 * `audit-demo.seed.ts`, el sembrador sigue funcionando —borra por prefijo y siembra igual— y
 * la única consecuencia visible es que la cobertura informa 0 % de siembra sobre una base
 * entera de demostración. Nadie lo nota, porque un aviso ausente no se parece a un error: se
 * parece a una base limpia.
 *
 * Por eso se comprueba el GUION explícitamente. Un `LIKE 'bnpl-cartera-demo%'` sin él casaría
 * también con cualquier prefijo futuro que empiece igual, y un `startsWith` sin él en el
 * sembrador escribiría ids que el patrón con guion no encuentra. Es el carácter que puede
 * divergir sin que nada más se rompa.
 */
describe('marca de siembra de demostración', () => {
  it('el patrón del monitoreo deriva del prefijo del sembrador, con el guion incluido', () => {
    expect(DEMO_REQUEST_LIKE).toBe(`${DEMO_REQUEST_PREFIX}-%`);
  });

  /**
   * El formato real que escribe `audit-demo.seed.ts`: `${DEMO_REQUEST_PREFIX}-${caso.folio}`.
   * Se reproduce aquí en vez de importarse porque lo que se comprueba es el CONTRATO entre las
   * dos piezas, y una prueba que importara la función perdería el sentido el día que alguien
   * cambie cómo se compone el id sin cambiar la constante.
   */
  const comoLoEscribeElSembrador = (folio: string) => `${DEMO_REQUEST_PREFIX}-${folio}`;

  /** Traducción fiel del `LIKE` de Postgres para el único comodín que este patrón usa. */
  const casaConElPatron = (requestId: string) =>
    requestId.startsWith(DEMO_REQUEST_LIKE.slice(0, -1));

  it('encuentra las ejecuciones que el sembrador escribe', () => {
    expect(casaConElPatron(comoLoEscribeElSembrador('BNPL-2026-0229'))).toBe(true);
    expect(casaConElPatron(comoLoEscribeElSembrador('BNPL-2026-0071-repite'))).toBe(true);
  });

  it('NO se lleva por delante las decisiones reales ni las de humo', () => {
    // Los tres formatos que conviven de verdad en una base de desarrollo.
    expect(casaConElPatron('7a6922e4-9d6e-4d02-adf5-c2d7ba087f30')).toBe(false);
    expect(casaConElPatron('credit-app-CRA-d793c835-dd0f-4fba-b81a-8b3e376faa12')).toBe(false);
    expect(casaConElPatron('smoke-1787331793901-52478')).toBe(false);
  });

  it('no casa con un prefijo vecino que sólo comparta el principio', () => {
    // Sin el guion, `bnpl-cartera-demo-v2-…` y `bnpl-cartera-demozz` entrarían los dos.
    expect(casaConElPatron(`${DEMO_REQUEST_PREFIX}zz-0001`)).toBe(false);
  });
});
