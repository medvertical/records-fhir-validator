import type { ValidationIssue } from '@records-fhir/validation-types';
import type { SDFHIRPathTargetEvaluation } from './sd-fhirpath-expression-runtime.js';

export interface SDFHIRPathEvaluationPlan {
  immediateIssues?: ValidationIssue[];
  resolveTargets(): SDFHIRPathTargetEvaluation[];
}
