/** Composes approval persistence, blocking test evidence and version transitions. */
import { Module } from '@nestjs/common';
import { EventsModule } from '../../common/events/events.module';
import { ArtifactModule } from '../artifacts/artifact.module';
import { TestingModule } from '../testing/testing.module';
import { GovernanceController } from './governance.controller';
import { GovernanceService } from './governance.service';

@Module({
  imports: [ArtifactModule, TestingModule, EventsModule],
  controllers: [GovernanceController],
  providers: [GovernanceService],
  exports: [GovernanceService],
})
export class GovernanceModule {}
