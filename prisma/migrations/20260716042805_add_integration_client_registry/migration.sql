-- Integration client registry: replaces header-declared identity for
-- API key callers with a database-backed client / credential / scope / tenant model.

-- CreateEnum
CREATE TYPE "IntegrationClientStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "IntegrationCredentialStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "integration_client" (
    "id" BIGSERIAL NOT NULL,
    "client_key" VARCHAR(120) NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "audience" VARCHAR(20) NOT NULL,
    "status" "IntegrationClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "integration_client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_credential" (
    "id" BIGSERIAL NOT NULL,
    "client_id" BIGINT NOT NULL,
    "secret_hash" VARCHAR(128) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "status" "IntegrationCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "integration_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_scope" (
    "id" BIGSERIAL NOT NULL,
    "client_id" BIGINT NOT NULL,
    "scope" VARCHAR(80) NOT NULL,
    CONSTRAINT "integration_scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_tenant_access" (
    "id" BIGSERIAL NOT NULL,
    "client_id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    CONSTRAINT "integration_tenant_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_client_client_key_key" ON "integration_client"("client_key");

-- CreateIndex
CREATE INDEX "integration_client_status_idx" ON "integration_client"("status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_credential_secret_hash_key" ON "integration_credential"("secret_hash");

-- CreateIndex
CREATE INDEX "integration_credential_client_id_status_idx" ON "integration_credential"("client_id", "status");

-- CreateIndex
CREATE INDEX "integration_credential_expires_at_idx" ON "integration_credential"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_scope_client_id_scope_key" ON "integration_scope"("client_id", "scope");

-- CreateIndex
CREATE INDEX "integration_tenant_access_tenant_id_idx" ON "integration_tenant_access"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_tenant_access_client_id_tenant_id_key" ON "integration_tenant_access"("client_id", "tenant_id");

-- AddForeignKey
ALTER TABLE "integration_credential" ADD CONSTRAINT "integration_credential_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "integration_client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_scope" ADD CONSTRAINT "integration_scope_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "integration_client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_tenant_access" ADD CONSTRAINT "integration_tenant_access_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "integration_client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
