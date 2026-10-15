import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StatementUploadPolicy {
  constructor(private readonly config: ConfigService) {}

  /** Máximo aceptado para un archivo, en bytes. Lo publica el catálogo. */
  maxUploadBytes(): number {
    return this.config.get<number>('BANK_STATEMENT_MAX_UPLOAD_BYTES') ?? 10_485_760;
  }
}
