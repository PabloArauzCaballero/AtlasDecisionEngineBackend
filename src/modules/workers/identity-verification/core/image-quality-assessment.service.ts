import { Inject, Injectable } from '@nestjs/common';
import { IDENTITY_OPTIONS, type IdentityOptions } from './identity-options';
import type { DetectedFace, ImageQuality } from './ports/identity.ports';

export interface ImageQualityAssessment {
  score: number;
  warnings: string[];
  acceptable: boolean;
}

/**
 * Traduce la medida física de una imagen a «sirve» o «no sirve».
 *
 * Absorbido del paquete original; sólo cambia el origen de los umbrales
 * (`IdentityOptions` en vez de su `IdentityConfigService`). La distinción entre
 * documento y selfie no es cosmética: en la selfie además importa cuánto ocupa
 * el rostro en el encuadre, y un rostro diminuto pasa cualquier medida global
 * de nitidez y exposición.
 */
@Injectable()
export class ImageQualityAssessmentService {
  constructor(@Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions) {}

  document(quality: ImageQuality): ImageQualityAssessment {
    return this.assess(quality, this.options.minDocumentQuality);
  }

  selfie(quality: ImageQuality, face?: DetectedFace): ImageQualityAssessment {
    const result = this.assess(quality, this.options.minSelfieQuality);
    if (face) {
      const faceArea = Math.max(0, face.box.width) * Math.max(0, face.box.height);
      if (faceArea < this.options.minFaceAreaRatio) result.warnings.push('FACE_TOO_SMALL');
      if (face.quality !== null && face.quality < this.options.minSelfieQuality) {
        result.warnings.push('LOW_FACE_QUALITY');
      }
    }
    return {
      ...result,
      acceptable:
        result.acceptable &&
        !result.warnings.includes('FACE_TOO_SMALL') &&
        !result.warnings.includes('LOW_FACE_QUALITY'),
    };
  }

  private assess(quality: ImageQuality, minimumScore: number): ImageQualityAssessment {
    const warnings = [...quality.warnings];
    if (quality.score < minimumScore && !warnings.includes('QUALITY_SCORE_TOO_LOW')) {
      warnings.push('QUALITY_SCORE_TOO_LOW');
    }
    return { score: quality.score, warnings, acceptable: quality.score >= minimumScore };
  }
}
