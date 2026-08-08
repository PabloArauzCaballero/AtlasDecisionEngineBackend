/** Joins governance, version state and runtime binding resolution for safe publication. */
import { Module } from '@nestjs/common';
import { EventsModule } from '../../common/events/events.module';
import { ArtifactModule } from '../artifacts/artifact.module';
import { GovernanceModule } from '../governance/governance.module';
import { DeploymentController } from './deployment.controller';
import { DeploymentResolverService } from './deployment-resolver.service';
import { DeploymentService } from './deployment.service';

@Module({
  imports: [ArtifactModule, GovernanceModule, EventsModule],
  controllers: [DeploymentController],
  providers: [DeploymentService, DeploymentResolverService],
  exports: [DeploymentService, DeploymentResolverService],
})
export class DeploymentModule {}
