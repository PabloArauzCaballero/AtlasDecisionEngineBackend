import { Module } from '@nestjs/common';
import { SeedingService } from './seeding.service';

/**
 * Pulls the published seed set at application startup when the database is empty, and registers the
 * integration clients declared in this installation's environment. Relies on the global
 * {@link PrismaModule} for the shared PrismaService.
 */
@Module({
  providers: [SeedingService],
})
export class SeedingModule {}
