import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RUNTIME_DECISION_ROLE } from '../../common/security/platform-roles';
import { Audience, Roles, TenantId } from '../../common/security/security.decorators';

/**
 * Cuántas veces referencia el Motor una clave del almacén.
 *
 * AtlasBackend pregunta esto antes de BORRAR un archivo de un expediente
 * (`ObjectRefCounterService.contarEnElMotor`): si el Motor sigue usando el objeto —el PDF de un
 * extracto, las dos caras del carnet o la selfie de una verificación— no se puede destruir. La ruta
 * no existía: la respuesta era siempre 404, el conteo quedaba «incierto» y AtlasBackend no borraba
 * NUNCA un archivo, mientras la papelera prometía hacerlo.
 *
 * Audiencia `runtime` y el rol de ejecución, porque quien pregunta es la integración de AtlasBackend
 * con su credencial de ejecución (`DECISION_ENGINE_API_KEY`), no una persona. Sólo cuenta: no
 * devuelve ejecuciones, titulares ni claves, así que no filtra nada más allá de un número.
 */
@ApiTags('Workers')
@Controller('v1/workers/storage')
@Audience('runtime')
@Roles(RUNTIME_DECISION_ROLE)
export class StorageReferencesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('references')
  @ApiOperation({ summary: 'Cuántas ejecuciones del Motor referencian una clave del almacén' })
  @ApiOkResponse({ schema: { type: 'object', properties: { references: { type: 'integer' } } } })
  async references(
    @TenantId() tenantId: bigint,
    @Query('key') key?: string,
  ): Promise<{ references: number }> {
    const clave = (key ?? '').trim();
    if (!clave || clave.length > 512) {
      throw new BadRequestException('Falta `key` (clave del almacén, hasta 512 caracteres).');
    }
    const [extractos, identidad] = await Promise.all([
      this.prisma.bankStatementRun.count({ where: { tenantId, fileObjectKey: clave } }),
      this.prisma.identityVerificationRun.count({
        where: {
          tenantId,
          OR: [
            { documentObjectKey: clave },
            { documentBackObjectKey: clave },
            { selfieObjectKey: clave },
          ],
        },
      }),
    ]);
    return { references: extractos + identidad };
  }
}
