/**
 * Publica el manifiesto de catálogo del motor para el panel de sistemas de ATLAS.
 *
 * ## Por qué está en el plano de GESTIÓN y no es público
 *
 * El manifiesto enumera cada ruta que el proceso sirve y cada tabla que su base contiene. No
 * contiene un solo dato de negocio, pero sí es el mapa completo de la superficie de ataque, y
 * regalarlo sin identidad sería gratuito. Vive donde viven las demás lecturas de gobierno:
 * audiencia `management`, con los roles que ya leen auditoría y despliegues.
 *
 * ## Por qué no expone escritura
 *
 * Es un espejo. Atlas Backend federa lo que aquí se lee y guarda su copia gobernada —con
 * revisión humana, dueño y narrativa— en su propio catálogo. Si este endpoint aceptara
 * escrituras, habría dos sitios donde corregir la misma tabla y ninguno sería el bueno.
 */
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audience, Roles } from '../../common/security/security.decorators';
import { CatalogManifestDto } from './platform-catalog.dto';
import { PlatformCatalogService } from './platform-catalog.service';

@ApiTags('Platform Catalog')
@Controller('v1/platform')
export class PlatformCatalogController {
  constructor(private readonly catalog: PlatformCatalogService) {}

  @Get('catalog-manifest')
  @ApiOperation({
    operationId: 'platformCatalogManifest',
    summary: 'Describe this block: the routes it serves and the tables it owns',
  })
  @ApiOkResponse({
    description: 'Manifiesto del bloque con sus endpoints y sus entidades de datos.',
    type: CatalogManifestDto,
  })
  @Audience('management')
  @Roles('OPERATIONS', 'PLATFORM_ADMIN', 'AUDITOR', 'COMPLIANCE')
  manifest(): Promise<CatalogManifestDto> {
    return this.catalog.manifest();
  }
}
