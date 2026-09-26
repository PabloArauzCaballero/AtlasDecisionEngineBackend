/**
 * Escenarios de prueba de la locución.
 *
 * Existen por lo mismo que los de los otros tres workers: para poder demostrar
 * la vista sin inventar datos y sin depender de que alguien tenga a mano una
 * entrada válida. Aquí además hacen falta más que en ningún otro, porque una
 * locución **cuesta dinero**: el escenario es la forma de recorrer la pantalla
 * entera sin encargar una síntesis nueva cada vez.
 *
 * Los tres se apoyan en las plantillas que el propio worker siembra —no
 * inventan texto suelto— porque el catálogo es el que decide qué se puede poner
 * en boca de la marca, y un escenario que se lo saltara probaría un camino que
 * en la vida real no existe.
 */

export interface AudioTtsFixture {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  /** Vista previa segura: el texto tal como quedará, sin locutar. */
  readonly preview: string;
  readonly templateCode: string;
  readonly variables: Record<string, string>;
  readonly expectsFailure: boolean;
}

/** Plantillas que el worker siembra por tenant la primera vez que se usa. */
export const DEFAULT_AUDIO_TEMPLATES = [
  {
    code: 'onboarding.fallback.generic',
    strategy: 'FALLBACK' as const,
    templateText: 'Bienvenido. Estamos listos para comenzar.',
    fallbackTemplateCode: null,
  },
  {
    code: 'onboarding.welcome.generic',
    strategy: 'STATIC' as const,
    templateText: 'Bienvenido. Estamos listos para comenzar.',
    fallbackTemplateCode: 'onboarding.fallback.generic',
  },
  {
    code: 'onboarding.welcome.named',
    strategy: 'DYNAMIC' as const,
    templateText: 'Bienvenido, {{name}}. Estamos listos para comenzar.',
    fallbackTemplateCode: 'onboarding.fallback.generic',
  },
] as const;

export const AUDIO_TTS_FIXTURES: readonly AudioTtsFixture[] = [
  {
    code: 'bienvenida-generica',
    name: 'Bienvenida sin nombre',
    description:
      'Una frase fija, sin variables. Es la que más veces se sirve de caché: la segunda vez y todas las siguientes no cuestan nada.',
    preview: 'Bienvenido. Estamos listos para comenzar.',
    templateCode: 'onboarding.welcome.generic',
    variables: {},
    expectsFailure: false,
  },
  {
    code: 'bienvenida-con-nombre',
    name: 'Bienvenida con nombre',
    description:
      'Una frase con una variable dentro. Cada nombre distinto es un audio distinto, así que muestra dónde deja de servir la caché.',
    preview: 'Bienvenido, Ana. Estamos listos para comenzar.',
    templateCode: 'onboarding.welcome.named',
    variables: { name: 'Ana' },
    expectsFailure: false,
  },
  {
    /*
     * El escenario que FALLA a propósito.
     *
     * Locutar texto libre no está permitido —el catálogo es lo que decide qué
     * se dice con la voz de la marca—, y quien lo intente merece ver el rechazo
     * antes que descubrirlo en producción. Sin este escenario, la pantalla sólo
     * enseñaría caminos felices.
     */
    code: 'plantilla-inexistente',
    name: 'Plantilla que no existe',
    description:
      'Pide locutar un código que no está en el catálogo. Termina en error controlado: sirve para ver cómo se explica un rechazo.',
    preview: 'onboarding.welcome.inexistente',
    templateCode: 'onboarding.welcome.inexistente',
    variables: {},
    expectsFailure: true,
  },
];

export function findAudioTtsFixture(code: string): AudioTtsFixture | undefined {
  return AUDIO_TTS_FIXTURES.find((fixture) => fixture.code === code);
}
