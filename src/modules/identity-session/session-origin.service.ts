import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain-exception';

@Injectable()
export class SessionOriginService {
  constructor(private readonly config: ConfigService) {}

  assertAllowed(origin: string | undefined): void {
    const production = this.config.get<string>('NODE_ENV') === 'production';
    if (!origin) {
      if (production) throw this.forbidden();
      return;
    }
    const allowed = (this.config.get<string>('CORS_ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!allowed.includes(origin)) throw this.forbidden();
  }

  private forbidden(): DomainException {
    return new DomainException(
      'UNTRUSTED_ORIGIN',
      'Request origin is not allowed',
      HttpStatus.FORBIDDEN,
    );
  }
}
