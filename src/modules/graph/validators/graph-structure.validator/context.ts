import type { ArtifactGraphSnapshot, ValidationIssue } from '../../graph.types';
import type { GraphLookups } from '../graph-lookups';

/** Lo que cada regla de forma necesita y dónde deja lo que encuentra. */
export interface StructureContext {
  readonly snapshot: ArtifactGraphSnapshot;
  readonly lookups: GraphLookups;
  readonly errors: ValidationIssue[];
  readonly warnings: ValidationIssue[];
  readonly outputs: ArtifactGraphSnapshot['variables'];
}
