import { Module } from '@nestjs/common';
import { ArtifactModule } from '../artifacts/artifact.module';
import { GovernanceModule } from '../governance/governance.module';
import { DeploymentController } from './deployment.controller';
import { DeploymentResolverService } from './deployment-resolver.service';
import { DeploymentService } from './deployment.service';

@Module({
  imports: [ArtifactModule, GovernanceModule],
  controllers: [DeploymentController],
  providers: [DeploymentService, DeploymentResolverService],
  exports: [DeploymentService, DeploymentResolverService],
})
export class DeploymentModule {}
