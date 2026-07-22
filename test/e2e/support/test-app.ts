import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { DomainExceptionFilter } from '../../../src/common/errors/domain-exception.filter';
import { AccessDenialAuditorService } from '../../../src/common/security/access-denial-auditor.service';
import { provisionE2eClients } from './integration-clients';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON() {
  return this.toString();
};

export async function createTestApp(): Promise<INestApplication> {
  // API key identity resolves from the database, so the credentials the specs use must
  // exist before the app serves a single request.
  await provisionE2eClients();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(app.get(ConfigService), app.get(AccessDenialAuditorService)),
  );
  await app.init();
  return app;
}
