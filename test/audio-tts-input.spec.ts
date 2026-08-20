import { ConfigService } from '@nestjs/config';
import { validateAudioRequest } from '../src/modules/workers/audio-tts/audio-tts-input';
import { audioTtsAvailable } from '../src/modules/workers/audio-tts/audio-tts-config.bridge';

/**
 * Lo que decide si una locución se cobra dos veces.
 *
 * La clave de idempotencia es la única defensa contra pagar dos veces por la
 * misma frase, así que estas pruebas fijan sus dos propiedades: que ignore lo
 * que no cambia el audio (el orden en que llegaron las variables) y que NO
 * ignore lo que sí lo cambia (la voz con la que se dirá).
 */
const VOZ = 'elevenlabs|eleven_v3|voz-1|brand_es_latam_v1|1|mp3_44100_128|44100';

describe('solicitud de locución', () => {
  it('la misma locución produce la misma clave aunque cambie el orden de las variables', () => {
    const a = validateAudioRequest(
      { templateCode: 'onboarding.welcome.named', variables: { name: 'Ana', city: 'La Paz' } },
      VOZ,
    );
    const b = validateAudioRequest(
      { templateCode: 'onboarding.welcome.named', variables: { city: 'La Paz', name: 'Ana' } },
      VOZ,
    );
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });

  it('cambiar de voz produce una clave distinta: el audio no es función sólo del texto', () => {
    const request = { templateCode: 'onboarding.welcome.generic' };
    const conVozA = validateAudioRequest(request, VOZ);
    const conVozB = validateAudioRequest(
      request,
      'elevenlabs|eleven_v3|voz-2|brand_es_latam_v1|1|mp3_44100_128|44100',
    );
    expect(conVozA.idempotencyKey).not.toBe(conVozB.idempotencyKey);
  });

  it('cambiar el idioma produce una clave distinta', () => {
    const base = validateAudioRequest({ templateCode: 'onboarding.welcome.generic' }, VOZ);
    const otro = validateAudioRequest(
      { templateCode: 'onboarding.welcome.generic', language: 'en-US' },
      VOZ,
    );
    expect(base.idempotencyKey).not.toBe(otro.idempotencyKey);
  });

  it('una clave explícita fuerza una locución nueva de lo mismo', () => {
    const request = { templateCode: 'onboarding.welcome.generic' };
    expect(validateAudioRequest(request, VOZ).idempotencyKey).not.toBe(
      validateAudioRequest(request, VOZ, 'repetir-a-mano').idempotencyKey,
    );
  });

  it('rechaza un código de plantilla con formato inválido antes de encolar', () => {
    expect(() => validateAudioRequest({ templateCode: 'NO Válido!' }, VOZ)).toThrow(
      /AUDIO_REQUEST_INVALID|inválida/i,
    );
  });

  it('rechaza la solicitud sin plantilla', () => {
    expect(() => validateAudioRequest({}, VOZ)).toThrow();
  });
});

describe('disponibilidad del worker de locución', () => {
  it('encendido sin proveedor NO está disponible: aceptaría trabajo que va a fallar', () => {
    const config = new ConfigService({
      AUDIO_TTS_WORKER_ENABLED: true,
      AUDIO_TTS_PROVIDER: 'disabled',
    });
    expect(audioTtsAvailable(config)).toBe(false);
  });

  it('apagado con proveedor tampoco está disponible', () => {
    const config = new ConfigService({
      AUDIO_TTS_WORKER_ENABLED: false,
      AUDIO_TTS_PROVIDER: 'elevenlabs',
    });
    expect(audioTtsAvailable(config)).toBe(false);
  });

  it('encendido y con proveedor sí', () => {
    const config = new ConfigService({
      AUDIO_TTS_WORKER_ENABLED: true,
      AUDIO_TTS_PROVIDER: 'fake',
    });
    expect(audioTtsAvailable(config)).toBe(true);
  });
});
