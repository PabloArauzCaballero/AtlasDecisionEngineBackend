-- Audit authentication/authorization denials.
--
-- Guards run before interceptors, so 401/403/429 rejections never reached the access
-- audit interceptor and were never recorded. The filter now records them, which means a
-- rejected request must be storable: a 401 has no authenticated principal or tenant, so
-- those columns become nullable, and the source IP and status are captured instead.

-- AlterTable
ALTER TABLE "decision_access_audit" ADD COLUMN     "ip_address" VARCHAR(64),
ADD COLUMN     "status" INTEGER,
ALTER COLUMN "principal_id" DROP NOT NULL,
ALTER COLUMN "tenant_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "decision_access_audit_decision_occurred_at_idx" ON "decision_access_audit"("decision", "occurred_at");
