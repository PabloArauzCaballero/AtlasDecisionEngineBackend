import { PdfWorkerError } from './codes-and-base';

/** Los templates incorporados se despliegan con el código; la API no los toca. */
export class TemplateBuiltinProtectedError extends PdfWorkerError {
  readonly code = 'TEMPLATE_BUILTIN_PROTECTED' as const;
  readonly httpStatus = 403;

  constructor(templateId: string, version: string) {
    super(
      `«${templateId}@${version}» es un template incorporado: se versiona con el código y no ` +
        'se puede modificar ni retirar por la API.',
      { templateId, version },
    );
  }
}

/**
 * No se puede consultar el contrato de salida de un artefacto.
 *
 * Dos situaciones con el mismo remedio distinto: el generador corre SUELTO y
 * nadie le provee el puerto: casar documentos con artefactos es una función que
 * sólo existe montado dentro del motor, que es quien tiene los contratos.
 */
export class ArtifactContractUnavailableError extends PdfWorkerError {
  readonly code = 'ARTIFACT_CONTRACT_UNAVAILABLE' as const;
  readonly httpStatus = 503;

  constructor() {
    super(
      'Este despliegue no puede consultar contratos de artefactos: el generador corre suelto y ' +
        'nadie provee ArtifactContractPort.',
      {},
    );
  }
}

/**
 * El artefacto pedido no existe, o no tiene una versión estable con contrato.
 *
 * Va aparte de `ARTIFACT_CONTRACT_UNAVAILABLE` porque son dos problemas con dos remedios
 * OPUESTOS: aquél lo arregla quien despliega —falta el proveedor—, éste quien escribió el
 * identificador. Con un solo código y un solo 503, un identificador mal escrito parecía una
 * avería del servicio y mandaba a diagnosticar al sitio equivocado.
 */
export class ArtifactNotFoundError extends PdfWorkerError {
  readonly code = 'ARTIFACT_NOT_FOUND' as const;
  readonly httpStatus = 404;

  constructor(artifactId: string, version?: string) {
    super(
      `No existe el contrato de salida de «${artifactId}${version ? `@${version}` : ''}». ` +
        'Sólo se pueden casar versiones aprobadas o desplegadas que declaren contrato.',
      { artifactId, version },
    );
  }
}
