import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryHistoryDto } from '../src/modules/sql-console/sql-console.dto';

/**
 * El historial de la consola SQL respondía 400 a la petición que hace el propio portal
 * (`?limit=25`): la cadena de consulta llega como texto y no se convertía a número.
 * Se valida igual que lo hace el `ValidationPipe` global: `transform` sin conversión implícita.
 */
async function erroresDe(query: Record<string, string>) {
  const dto = plainToInstance(QueryHistoryDto, query, { enableImplicitConversion: false });
  return { dto, errores: await validate(dto) };
}

describe('GET /v1/sql-console/history · límite', () => {
  it('acepta el límite que manda el portal, que llega como texto', async () => {
    const { dto, errores } = await erroresDe({ limit: '25' });
    expect(errores).toHaveLength(0);
    expect(dto.limit).toBe(25);
  });

  it('sin límite también vale: se usa el valor por defecto', async () => {
    const { errores } = await erroresDe({});
    expect(errores).toHaveLength(0);
  });

  it('sigue rechazando lo que no es un entero entre 1 y 100', async () => {
    for (const limit of ['0', '101', 'abc', '2.5']) {
      const { errores } = await erroresDe({ limit });
      expect(errores.length).toBeGreaterThan(0);
    }
  });
});
