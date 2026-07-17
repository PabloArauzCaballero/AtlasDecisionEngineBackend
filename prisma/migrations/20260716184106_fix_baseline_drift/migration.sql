-- Converge the database with schema.prisma.
--
-- The init migration was produced by a retired custom baseline generator and drifted
-- from the Prisma schema, so `migrate deploy` from an empty database did NOT produce the
-- schema the code expects. Every statement here is a delta prisma migrate diff reported
-- between the applied migrations and schema.prisma:
--   * updated_at defaults: @updatedAt is client-managed, so the DB must not carry a
--     default. Prisma always supplies the value on write.
--   * index names: cosmetic, but they keep future diffs clean instead of replaying.
--
-- After this, migrate diff reports no drift and the baseline is reproducible.

-- AlterTable
ALTER TABLE "decision_artifact" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "decision_runtime_binding" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "decision_runtime_idempotency" ALTER COLUMN "updated_at" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "decision_artifact_variable_dependency_artifact_version_ed998aa3" RENAME TO "decision_artifact_variable_dependency_artifact_version_id_v_key";

-- RenameIndex
ALTER INDEX "decision_compiled_artifact_artifact_version_id_compile_637a49df" RENAME TO "decision_compiled_artifact_artifact_version_id_compiled_che_key";

-- RenameIndex
ALTER INDEX "decision_deployment_artifact_version_id_environment_id_44010ecd" RENAME TO "decision_deployment_artifact_version_id_environment_id_is_a_idx";

-- RenameIndex
ALTER INDEX "decision_execution_variable_execution_id_variable_vers_d12cb520" RENAME TO "decision_execution_variable_execution_id_variable_version_i_key";

-- RenameIndex
ALTER INDEX "decision_policy_artifact_link_policy_requirement_id_ar_97d6bb39" RENAME TO "decision_policy_artifact_link_policy_requirement_id_artifac_key";

-- RenameIndex
ALTER INDEX "decision_policy_requirement_business_objective_id_poli_73f0ddf6" RENAME TO "decision_policy_requirement_business_objective_id_policy_co_key";

-- RenameIndex
ALTER INDEX "decision_policy_test_link_policy_requirement_id_test_s_00bff04a" RENAME TO "decision_policy_test_link_policy_requirement_id_test_suite__key";

-- RenameIndex
ALTER INDEX "decision_rule_edge_artifact_version_id_from_node_id_pr_3072ff6f" RENAME TO "decision_rule_edge_artifact_version_id_from_node_id_priorit_idx";

-- RenameIndex
ALTER INDEX "decision_runtime_binding_tenant_id_artifact_code_envir_5f96d830" RENAME TO "decision_runtime_binding_tenant_id_artifact_code_environmen_idx";

-- RenameIndex
ALTER INDEX "decision_runtime_binding_tenant_id_artifact_code_envir_86e1e4c2" RENAME TO "decision_runtime_binding_tenant_id_artifact_code_environmen_key";

-- RenameIndex
ALTER INDEX "decision_runtime_idempotency_tenant_id_artifact_code_i_67398aa9" RENAME TO "decision_runtime_idempotency_tenant_id_artifact_code_idempo_key";

-- RenameIndex
ALTER INDEX "decision_variable_source_variable_version_id_source_sy_2fc6ae50" RENAME TO "decision_variable_source_variable_version_id_source_system__key";

-- RenameIndex
ALTER INDEX "decision_variable_version_variable_definition_id_effec_d9b6ea28" RENAME TO "decision_variable_version_variable_definition_id_effective__idx";

-- RenameIndex
ALTER INDEX "decision_variable_version_variable_definition_id_versi_54b7391c" RENAME TO "decision_variable_version_variable_definition_id_version_nu_key";

-- RenameIndex
ALTER INDEX "decision_version_status_history_artifact_version_id_ch_e72757cd" RENAME TO "decision_version_status_history_artifact_version_id_changed_idx";
