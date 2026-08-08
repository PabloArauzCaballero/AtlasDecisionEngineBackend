// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Análisis estático CON TIPOS.
 *
 * El proyecto ya tenía `tsc --strict` y Prettier, y eso deja fuera una clase concreta de
 * defecto que ninguno de los dos ve: la promesa que nadie espera. En una base NestJS llena de
 * `async` —transacciones, `audit.append`, reclamaciones con lease— un `await` olvidado no
 * rompe la compilación ni el formato; produce una escritura que ocurre fuera de su
 * transacción, o un error que se pierde como rechazo no capturado. `no-floating-promises`
 * sólo existe con información de tipos, que es por lo que se configura `projectService`.
 *
 * Las reglas se eligen por lo que protegen, no por completitud:
 *  - `no-floating-promises` / `require-await` / `await-thenable`: corrección asíncrona.
 *  - `no-explicit-any` en error: la base tiene CERO `any` hoy y eso es un activo; la regla
 *    lo convierte en invariante en vez de en costumbre.
 *  - `no-unnecessary-condition` queda FUERA a propósito: con datos que vienen de JSON y de
 *    Prisma produce falsos positivos que empujan a borrar comprobaciones que sí hacen falta.
 *
 * `console` se prohíbe por la regla 40-observability: todo registro pasa por
 * `StructuredLoggerService`, que es quien redacta PII.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'site/**',
      'graphify-out/**',
      'runner/**',
      'scripts/**',
      'infra/**',
      '**/*.mjs',
      '**/*.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/require-await': 'error',
      // `unknown` + validación es la regla del proyecto (10-backend-architecture); estas dos
      // avisan cuando un valor sin tipar se usa como si lo tuviera.
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'error',

      // ---- Apagadas a conciencia, con el motivo ----
      // El motor y los validadores tratan grafos que llegan como JSON, donde un campo
      // declarado `unknown` puede ser cualquier cosa. `String(x)` es ahí la coerción
      // defensiva deliberada, y la validación del grafo ya rechaza las formas imposibles
      // antes de llegar. La regla marcaba 57 usos legítimos; el único caso real —el
      // `message` de una HttpException, que podía registrarse como `[object Object]`— se
      // corrigió con una función propia en `domain-exception.filter.ts`.
      '@typescript-eslint/no-base-to-string': 'off',
      // `Express.Request` se amplía con `principal` mediante `declare global { namespace }`,
      // que es la ÚNICA forma de aumentar los tipos de Express.
      '@typescript-eslint/no-namespace': 'off',
      // Reenviar el rechazo original tal cual es lo correcto en un envoltorio de timeout:
      // convertirlo en `Error` perdería el `DomainException` que el llamante espera.
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      // `HttpStatus` es un enum numérico y compararlo con un número (`status >= 500`) es
      // intencionado: la política de reintento se expresa por rangos, no por miembros.
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      // Un doble de prueba o un adaptador en memoria implementa un puerto asíncrono sin
      // esperar nada. Exigir un `await` inventado sólo añadiría ruido.
      '@typescript-eslint/require-await': 'off',
      // `[A-Z0-9_\-]` dentro de una clase de carácter: el escape sobra para el motor de
      // expresiones regulares, pero marca explícitamente que el guion es literal y no un
      // rango. Son dos docenas de patrones de validación de DTOs —la primera frontera de
      // entrada del servicio—; reescribirlos por una regla de estilo pone en juego código
      // de seguridad a cambio de nada.
      'no-useless-escape': 'off',
      // `DataType | string` colapsa a `string` para el compilador, y la regla tiene razón en
      // que ahí no queda ninguna garantía. Pero la unión está escrita para DOCUMENTAR el
      // catálogo cerrado admitiendo a la vez un tipo que aún no está en él: cerrarla es una
      // decisión de contrato de dominio —con su migración y su validador—, no un arreglo de
      // linter. La comprobación real la hace `data-types.ts` en ejecución.
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },
  {
    // Aumento de tipos de Express: es una declaración global, no un módulo.
    files: ['src/common/security/security.types.ts'],
    rules: { '@typescript-eslint/no-unsafe-declaration-merging': 'off' },
  },
  {
    // El Proxy de tenancy manipula el cliente Prisma por reflexión: `Reflect.get` devuelve
    // `any` y los métodos se desligan de su objeto a propósito. Es la naturaleza de un
    // Proxy, no un descuido; el fichero está comentado en detalle.
    files: ['src/common/prisma/tenant-rls.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // Las pruebas construyen dobles a mano y afirman sobre formas parciales; exigirles el
    // mismo rigor de tipos que al código de producción sólo produciría ruido y castings.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
