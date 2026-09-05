import { ConfigService } from '@nestjs/config';
import type { AuditService } from '../src/common/audit/audit.service';
import { DomainException } from '../src/common/errors/domain-exception';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import {
  SemanticModelSettingsService,
  type EffectiveModelSettings,
} from '../src/modules/workers/semantic-analysis/model-settings/semantic-model-settings.service';

/**
 * La configuración del proveedor semántico desde el portal.
 *
 * Lo que se protege: que sin fila mande el entorno (ningún despliegue existente
 * cambia), que no se pueda elegir un gateway sin credencial ni un modelo con la
 * forma equivocada, que cada cambio quede auditado y avise a quien escucha, y
 * que el sondeo del worker detecte un cambio hecho por OTRO proceso.
 */

interface Fila {
  id: number;
  gateway: 'LITELLM' | 'OPENROUTER';
  fastModel: string;
  deepModel: string;
  version: number;
  updatedBy: string;
  updatedAt: Date;
  createdAt: Date;
}

const PRINCIPAL: AuthenticatedPrincipal = {
  id: 'ana@atlas',
  tenantId: 7n,
  roles: ['RISK_ANALYST'],
  audience: 'management',
  requestId: 'req-1',
  authMethod: 'jwt',
};

function montar(
  entorno: Record<string, unknown>,
  filaInicial: Fila | null = null,
): {
  service: SemanticModelSettingsService;
  base: { fila: Fila | null };
  auditados: string[];
} {
  const base = { fila: filaInicial };
  const auditados: string[] = [];

  const tabla = {
    findUnique: ({ select }: { select?: { version: boolean } }) =>
      Promise.resolve(
        base.fila === null ? null : select?.version ? { version: base.fila.version } : base.fila,
      ),
    upsert: ({
      create,
      update,
    }: {
      create: Omit<Fila, 'version' | 'updatedAt' | 'createdAt'>;
      update: Omit<Fila, 'id' | 'version' | 'updatedAt' | 'createdAt'> & {
        version: { increment: number };
      };
    }) => {
      base.fila =
        base.fila === null
          ? { ...create, version: 1, updatedAt: new Date(), createdAt: new Date() }
          : {
              ...base.fila,
              gateway: update.gateway,
              fastModel: update.fastModel,
              deepModel: update.deepModel,
              updatedBy: update.updatedBy,
              version: base.fila.version + update.version.increment,
              updatedAt: new Date(),
            };
      return Promise.resolve(base.fila);
    },
    deleteMany: () => {
      base.fila = null;
      return Promise.resolve({ count: 1 });
    },
  };
  const prisma = {
    semanticModelSetting: tabla,
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ semanticModelSetting: tabla }),
  } as unknown as PrismaService;
  const audit = {
    append: (input: { eventType: string }) => {
      auditados.push(input.eventType);
      return Promise.resolve({});
    },
  } as unknown as AuditService;

  const service = new SemanticModelSettingsService(
    prisma,
    new ConfigService({ SEMANTIC_MODEL_SETTINGS_REFRESH_MS: 0, ...entorno }),
    audit,
  );
  return { service, base, auditados };
}

const CON_LOS_DOS = {
  SEMANTIC_ANALYSIS_PROVIDER: 'cascade',
  LITELLM_API_KEY: 'sk-gateway',
  OPENROUTER_API_KEY: 'sk-or-v1-prueba',
};

describe('SemanticModelSettingsService — sin fila manda el entorno', () => {
  it('resuelve el gateway y los modelos del entorno, y lo dice', async () => {
    const { service } = montar({
      ...CON_LOS_DOS,
      SEMANTIC_CASCADE_REMOTE_PROVIDER: 'openrouter',
      OPENROUTER_FAST_MODEL: 'google/gemini-2.5-flash',
    });

    const efectiva = await service.current();

    expect(efectiva.source).toBe('environment');
    expect(efectiva.version).toBe(0);
    expect(efectiva.gateway).toBe('openrouter');
    expect(efectiva.fastModel).toBe('google/gemini-2.5-flash');
    expect(efectiva.deepModel).toBe('anthropic/claude-sonnet-4.5');
  });

  it('en cascada sin remoto declarado, el gateway es LiteLLM, como antes', async () => {
    const { service } = montar(CON_LOS_DOS);
    expect((await service.current()).gateway).toBe('litellm');
    expect((await service.current()).fastModel).toBe('semantic-classifier-fast');
  });

  it('describe qué gateways tienen credencial sin decir cuál', async () => {
    const { service } = montar({ SEMANTIC_ANALYSIS_PROVIDER: 'litellm', LITELLM_API_KEY: 'sk-x' });

    const descripcion = await service.describe();

    expect(descripcion.applies).toBe(true);
    expect(descripcion.litellm.available).toBe(true);
    expect(descripcion.openrouter.available).toBe(false);
    expect(JSON.stringify(descripcion)).not.toContain('sk-x');
  });

  it('no aplica en los modos sin escalón remoto', async () => {
    const { service } = montar({ SEMANTIC_ANALYSIS_PROVIDER: 'transformer' });
    expect(service.applies()).toBe(false);
    expect((await service.describe()).applies).toBe(false);
  });
});

describe('SemanticModelSettingsService — lo que no se puede guardar', () => {
  const OPENROUTER = {
    gateway: 'openrouter' as const,
    fastModel: 'openai/gpt-4.1-mini',
    deepModel: 'anthropic/claude-sonnet-4.5',
  };

  it('rechaza guardar cuando el modo no usa gateway: no tendría efecto', async () => {
    const { service, auditados } = montar({
      SEMANTIC_ANALYSIS_PROVIDER: 'transformer',
      OPENROUTER_API_KEY: 'sk',
    });

    await expect(service.update(OPENROUTER, PRINCIPAL)).rejects.toMatchObject({
      code: 'SEMANTIC_MODEL_SETTINGS_NOT_APPLICABLE',
    });
    expect(auditados).toHaveLength(0);
  });

  it('rechaza un gateway sin credencial en el entorno', async () => {
    const { service } = montar({ SEMANTIC_ANALYSIS_PROVIDER: 'litellm', LITELLM_API_KEY: 'sk' });

    const error = await service.update(OPENROUTER, PRINCIPAL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).code).toBe('SEMANTIC_MODEL_GATEWAY_UNAVAILABLE');
    expect((error as DomainException).message).toContain('OPENROUTER_API_KEY');
  });

  it('rechaza un alias donde va un modelo físico, y al revés', async () => {
    const { service } = montar(CON_LOS_DOS);

    await expect(
      service.update({ ...OPENROUTER, fastModel: 'semantic-classifier-fast' }, PRINCIPAL),
    ).rejects.toMatchObject({ code: 'SEMANTIC_MODEL_INVALID' });
    await expect(
      service.update(
        {
          gateway: 'litellm',
          fastModel: 'openai/gpt-4.1-mini',
          deepModel: 'semantic-classifier-deep',
        },
        PRINCIPAL,
      ),
    ).rejects.toMatchObject({ code: 'SEMANTIC_MODEL_INVALID' });
  });
});

describe('SemanticModelSettingsService — guardar, avisar y volver', () => {
  it('escribe la fila, sube la versión, audita y avisa a los suscriptores', async () => {
    const { service, base, auditados } = montar(CON_LOS_DOS);
    const avisos: EffectiveModelSettings[] = [];
    service.onChange((s) => avisos.push(s));

    const primera = await service.update(
      { gateway: 'openrouter', fastModel: 'openai/gpt-4.1-mini', deepModel: 'openai/gpt-4.1' },
      PRINCIPAL,
    );
    const segunda = await service.update(
      {
        gateway: 'litellm',
        fastModel: 'semantic-classifier-fast',
        deepModel: 'semantic-classifier-deep',
      },
      PRINCIPAL,
    );

    expect(primera.effective).toMatchObject({
      gateway: 'openrouter',
      deepModel: 'openai/gpt-4.1',
      source: 'portal',
      version: 1,
      updatedBy: 'ana@atlas',
    });
    expect(segunda.effective).toMatchObject({ gateway: 'litellm', version: 2 });
    expect(base.fila?.version).toBe(2);
    expect(auditados).toEqual([
      'SEMANTIC_MODEL_SETTINGS_UPDATED',
      'SEMANTIC_MODEL_SETTINGS_UPDATED',
    ]);
    expect(avisos.map((a) => a.version)).toEqual([1, 2]);
  });

  it('reset quita la fila, audita y devuelve el entorno', async () => {
    const { service, base, auditados } = montar(CON_LOS_DOS, {
      id: 1,
      gateway: 'OPENROUTER',
      fastModel: 'openai/gpt-4.1-mini',
      deepModel: 'openai/gpt-4.1',
      version: 4,
      updatedBy: 'otro',
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    const avisos: number[] = [];
    service.onChange((s) => avisos.push(s.version));

    const tras = await service.reset(PRINCIPAL);

    expect(base.fila).toBeNull();
    expect(tras.effective.source).toBe('environment');
    expect(tras.effective.gateway).toBe('litellm');
    expect(auditados).toEqual(['SEMANTIC_MODEL_SETTINGS_RESET']);
    expect(avisos).toEqual([0]);
  });

  it('reset sin fila no audita nada: no hay cambio que registrar', async () => {
    const { service, auditados } = montar(CON_LOS_DOS);
    await service.reset(PRINCIPAL);
    expect(auditados).toHaveLength(0);
  });
});

describe('SemanticModelSettingsService — el sondeo del worker', () => {
  it('detecta un cambio escrito por OTRO proceso y avisa', async () => {
    const { service, base } = montar({
      ...CON_LOS_DOS,
      // Memoria larga: sin el sondeo, `current()` seguiría sirviendo lo viejo.
      SEMANTIC_MODEL_SETTINGS_REFRESH_MS: 60_000,
    });
    const avisos: EffectiveModelSettings[] = [];
    service.onChange((s) => avisos.push(s));
    expect((await service.current()).version).toBe(0);

    // Otro proceso escribe la fila directamente.
    base.fila = {
      id: 1,
      gateway: 'OPENROUTER',
      fastModel: 'openai/gpt-4.1-mini',
      deepModel: 'anthropic/claude-sonnet-4.5',
      version: 1,
      updatedBy: 'operaciones@atlas',
      updatedAt: new Date(),
      createdAt: new Date(),
    };
    // Sin sondeo, la memoria sigue sirviendo el entorno.
    expect((await service.current()).version).toBe(0);

    await (service as unknown as { refreshIfChanged(): Promise<void> }).refreshIfChanged();

    expect(avisos).toHaveLength(1);
    expect(avisos[0].gateway).toBe('openrouter');
    expect((await service.current()).version).toBe(1);
  });

  it('un sondeo sin cambios no avisa', async () => {
    const { service } = montar(CON_LOS_DOS);
    const avisos: unknown[] = [];
    service.onChange((s) => avisos.push(s));
    await service.current();

    await (service as unknown as { refreshIfChanged(): Promise<void> }).refreshIfChanged();

    expect(avisos).toHaveLength(0);
  });
});
