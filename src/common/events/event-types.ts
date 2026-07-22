/**
 * Catalogue of versioned domain event types — the single source of truth.
 *
 * Producers publish these through the outbox and consumers subscribe by them, so a
 * divergent literal on either side silently severs the pipeline. Payload interfaces
 * document contract v1 (schemaVersion '1'); breaking a shape means bumping the
 * schemaVersion on the envelope, never mutating these in place.
 */
export const DecisionEventType = {
  VERSION_SUBMITTED_FOR_REVIEW: 'version.submitted_for_review',
  VERSION_CHANGES_REQUESTED: 'version.changes_requested',
  VERSION_APPROVED: 'version.approved',
  VERSION_REJECTED: 'version.rejected',
  VERSION_PUBLISHED: 'version.published',
  SECURITY_RISK_DETECTED: 'security.risk_detected',
} as const;

export type DecisionEventType = (typeof DecisionEventType)[keyof typeof DecisionEventType];

/** v1 payload of {@link DecisionEventType.VERSION_SUBMITTED_FOR_REVIEW}. */
export interface VersionSubmittedForReviewPayload {
  versionId: string;
  approvalRequestId: string;
  artifactCode: string;
  versionNumber: number;
  workflowCode: string;
  /** Version author (createdBy) — the principal review outcomes notify back to. */
  authorId: string;
  /** Roles required by the approval steps, in step order. */
  reviewerRoles: string[];
}

/** v1 payload shared by changes_requested / approved / rejected. */
export interface VersionReviewOutcomePayload {
  versionId: string;
  approvalRequestId: string;
  artifactCode: string;
  versionNumber: number;
  authorId: string;
  decidedBy: string;
  comments: string | null;
}

/** v1 payload of {@link DecisionEventType.VERSION_PUBLISHED}. */
export interface VersionPublishedPayload {
  versionId: string;
  artifactCode: string;
  versionNumber: number;
  deploymentId: string;
  environmentCode: string;
}
