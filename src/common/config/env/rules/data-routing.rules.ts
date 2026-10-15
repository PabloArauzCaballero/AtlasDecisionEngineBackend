import type { EnvRule } from './env-rule';

export const requireWellFormedDataRoutingRules: EnvRule = (value, ctx) => {
  // Solo la sintaxis: la forma de las reglas y la existencia de cada conexión las valida
  // el router al construirse, que es quien conoce el registro. Comprobar aquí el JSON
  // convierte un error de tecleo en un fallo de arranque con el nombre de la variable.
  if (value.DATA_ROUTING_RULES) {
    try {
      const parsed: unknown = JSON.parse(value.DATA_ROUTING_RULES);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['DATA_ROUTING_RULES'],
        message: 'Must be a JSON object mapping module names to routing rules',
      });
    }
  }
};
