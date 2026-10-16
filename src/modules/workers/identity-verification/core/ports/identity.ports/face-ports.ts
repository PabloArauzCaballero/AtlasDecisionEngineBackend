import { FaceBoundingBox } from './image-ports';

export interface DetectedFace {
  box: FaceBoundingBox;
  quality: number | null;
}

export interface FaceDetectionResult {
  faces: DetectedFace[];
  provider: string;
  modelVersion?: string;
}

export interface FaceDetectorPort {
  detectFaces(input: { image: Buffer; correlationId: string }): Promise<FaceDetectionResult>;
  health(): Promise<{ ready: boolean; detail?: string }>;
}

export interface FaceMatchResult {
  /**
   * Parecido en [0,1], o `null` cuando el proveedor no pudo comparar las dos
   * imágenes —normalmente porque no halló un rostro utilizable en el recorte
   * del documento—. `null` NUNCA debe colapsarse a `0`: «no pudimos mirar» y
   * «es otra persona» tienen consecuencias opuestas para quien se verifica.
   */
  similarityScore: number | null;
  /** `false` cuando la comparación no llegó a ocurrir; ver `similarityScore`. */
  comparable: boolean;
  notComparableReason?: 'NO_FACE_IN_DOCUMENT' | 'NO_FACE_IN_SELFIE' | 'PROVIDER_REJECTED_INPUT';
  providerDecision?: string;
  calibratedDecision?: 'MATCH' | 'REVIEW' | 'NO_MATCH';
  quality?: { documentFace?: number; selfieFace?: number };
  provider: string;
  modelVersion?: string;
  metadata?: Record<string, unknown>;
}

export interface FaceMatchPort {
  compare(input: {
    documentFace: Buffer;
    selfieFace: Buffer;
    correlationId: string;
  }): Promise<FaceMatchResult>;
  health(): Promise<{ ready: boolean; detail?: string }>;
}

// --- Prueba de vida --------------------------------------------------------

export interface LivenessResult {
  outcome: 'PASSED' | 'FAILED' | 'NOT_RUN' | 'INCONCLUSIVE';
  score?: number;
  provider: string;
  modelVersion?: string;
}

export interface LivenessPort {
  verify(input: { selfie: Buffer; correlationId: string }): Promise<LivenessResult>;
  health(): Promise<{ ready: boolean; detail?: string }>;
}
