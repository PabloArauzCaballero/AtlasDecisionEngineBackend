/**
 * Adaptador del compilador de paquetes: junta la validación, el ejemplo y el esquema.
 *
 * Los tres van juntos a propósito. Si el formato que se acepta, el ejemplo que se descarga y
 * el esquema que se publica vivieran en sitios distintos, se desincronizarían — y el síntoma
 * sería el peor posible: alguien descarga el ejemplo, lo sube y se lo rechazan.
 */
import { Injectable } from '@nestjs/common';
import type {
  CompiledBundle,
  TemplateBundleCompilerPort,
} from '../../application/ports/template-bundle-compiler.port';
import type { TemplateBundle } from '../../domain/contracts/template-bundle';
import { bundleJsonSchema } from '../validation/bundle.schema';
import { EXAMPLE_TEMPLATE_BUNDLE } from './bundle-example';
import { bundleToContract } from './bundle-to-contract';

@Injectable()
export class BundleCompilerAdapter implements TemplateBundleCompilerPort {
  compile(input: unknown): CompiledBundle {
    return bundleToContract(input);
  }

  example(): TemplateBundle {
    // Copia profunda: el ejemplo se sirve por HTTP y quien lo reciba no debe poder mutar la
    // constante del proceso a través de una referencia compartida.
    return JSON.parse(JSON.stringify(EXAMPLE_TEMPLATE_BUNDLE)) as TemplateBundle;
  }

  jsonSchema(): unknown {
    return bundleJsonSchema();
  }
}
