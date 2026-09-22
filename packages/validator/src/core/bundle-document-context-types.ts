import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinition } from './structure-definition-types.js';

export interface BundleDocumentContextChildResult {
  index: number;
  entryResource: Record<string, unknown>;
  resourceType: string;
  issues: ValidationIssue[];
  structureDef?: StructureDefinition;
  validatedProfile?: string;
  targetProfileIssues?: Record<string, ValidationIssue[]>;
}
