import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './common/config/env.schema';
import { AuditModule } from './common/audit/audit.module';
import { CacheModule } from './common/cache/cache.module';
import { EventsModule } from './common/events/events.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { SecurityModule } from './common/security/security.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { ArtifactModule } from './modules/artifacts/artifact.module';
import { AuditQueryModule } from './modules/audit-query/audit-query.module';
import { CodeImportModule } from './modules/code-import/code-import.module';
import { DeploymentModule } from './modules/deployments/deployment.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { GraphModule } from './modules/graph/graph.module';
import { HealthModule } from './modules/health/health.module';
import { LiveExecutionModule } from './modules/live-execution/live-execution.module';
import { ManualReviewModule } from './modules/manual-review/manual-review.module';
import { NestedTreesModule } from './modules/nested-trees/nested-trees.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OutboxRelayModule } from './modules/outbox-relay/outbox-relay.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { SecurityReviewModule } from './modules/security-review/security-review.module';
import { SeedingModule } from './modules/seeding/seeding.module';
import { TestingModule } from './modules/testing/testing.module';
import { TraceabilityModule } from './modules/traceability/traceability.module';
import { TutorialModule } from './modules/tutorials/tutorial.module';
import { VariableModule } from './modules/variables/variable.module';
import { ViewsModule } from './modules/views/views.module';
import { IdentitySessionModule } from './modules/identity-session/identity-session.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    ObservabilityModule,
    PrismaModule,
    SeedingModule,
    CryptoModule,
    CacheModule,
    AuditModule,
    EventsModule,
    SecurityModule,
    HealthModule,
    IdentitySessionModule,
    GraphModule,
    NestedTreesModule,
    VariableModule,
    ArtifactModule,
    CodeImportModule,
    TestingModule,
    GovernanceModule,
    DeploymentModule,
    RuntimeModule,
    LiveExecutionModule,
    ManualReviewModule,
    NotificationsModule,
    OutboxRelayModule,
    AuditQueryModule,
    TraceabilityModule,
    SecurityReviewModule,
    ViewsModule,
    TutorialModule,
  ],
})
export class AppModule {}
