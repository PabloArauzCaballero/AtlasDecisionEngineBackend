/** Joins governance, version state and runtime binding resolution for safe publication. */
import { Module } from '@nestjs/common';
import { EventsModule } from '../../common/events/events.module';
import { ArtifactModule } from '../artifacts/artifact.module';
import { GovernanceModule } from '../governance/governance.module';
import { ModelMonitoringModule } from '../model-monitoring/model-monitoring.module';
import { DeploymentController } from './deployment.controller';
import { DeploymentResolverService } from './deployment-resolver.service';
import { DeploymentService } from './deployment.service';

@Module({
  // `ModelMonitoringModule` por la línea base: se congela al PROMOVER, que es el único momento
  // en que la población de referencia todavía es la de la versión anterior.
  imports: [ArtifactModule, GovernanceModule, EventsModule, ModelMonitoringModule],
  controllers: [DeploymentController],
  providers: [DeploymentService, DeploymentResolverService],
  exports: [DeploymentService, DeploymentResolverService],
})
export class DeploymentModule {}
