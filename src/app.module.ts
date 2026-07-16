import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './common/config/env.schema';
import { AuditModule } from './common/audit/audit.module';
import { CacheModule } from './common/cache/cache.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { SecurityModule } from './common/security/security.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { ArtifactModule } from './modules/artifacts/artifact.module';
import { AuditQueryModule } from './modules/audit-query/audit-query.module';
import { DeploymentModule } from './modules/deployments/deployment.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { GraphModule } from './modules/graph/graph.module';
import { HealthModule } from './modules/health/health.module';
import { ManualReviewModule } from './modules/manual-review/manual-review.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { TestingModule } from './modules/testing/testing.module';
import { TraceabilityModule } from './modules/traceability/traceability.module';
import { VariableModule } from './modules/variables/variable.module';
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
    CryptoModule,
    CacheModule,
    AuditModule,
    SecurityModule,
    HealthModule,
    IdentitySessionModule,
    GraphModule,
    VariableModule,
    ArtifactModule,
    TestingModule,
    GovernanceModule,
    DeploymentModule,
    RuntimeModule,
    ManualReviewModule,
    AuditQueryModule,
    TraceabilityModule,
  ],
})
export class AppModule {}
