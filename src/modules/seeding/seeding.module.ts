import { Module } from '@nestjs/common';
import { SeedingService } from './seeding.service';

/**
 * Injects bootstrap seeds (always) and mockup seeds (development only) at application startup.
 * Relies on the global {@link PrismaModule} for the shared PrismaService.
 */
@Module({
  providers: [SeedingService],
})
export class SeedingModule {}
