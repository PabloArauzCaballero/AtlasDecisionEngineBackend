/** Stable, safe failure contract crossing the domain/HTTP boundary. */
import { HttpStatus } from '@nestjs/common';

export class DomainException extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainException';
  }
}
