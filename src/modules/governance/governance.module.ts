import { Module } from '@nestjs/common';
import { ArtifactModule } from '../artifacts/artifact.module';
import { TestingModule } from '../testing/testing.module';
import { GovernanceController } from './governance.controller';
import { GovernanceService } from './governance.service';

@Module({
  imports: [ArtifactModule, TestingModule],
  controllers: [GovernanceController],
  providers: [GovernanceService],
  exports: [GovernanceService],
})
export class GovernanceModule {}
