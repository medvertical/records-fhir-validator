import type { ProfileSourceContext } from '../../persistence/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { UcumCodeValidator } from '../../validators/ucum-validator.js';
import { validateCodingHygiene } from './terminology-coding-hygiene-rules.js';
import { validateKnownLoincDisplays } from './terminology-display-rules.js';
import { validateDeepLocalCodings } from './terminology-local-coding-rules.js';
import type { TerminologyValidationPort } from './terminology-validation-port.js';

interface TerminologyGlobalRuleContext {
  resource: unknown;
  existingIssues: ValidationIssue[];
  valueSetValidator: TerminologyValidationPort;
  ucumValidator: UcumCodeValidator;
  fhirVersion: 'R4' | 'R5' | 'R6';
  sourceContext?: ProfileSourceContext;
}

export type TerminologyGlobalRule = () => ValidationIssue[] | Promise<ValidationIssue[]>;

export function createTerminologyGlobalRules(
  context: TerminologyGlobalRuleContext,
): TerminologyGlobalRule[] {
  return [
    () => validateKnownLoincDisplays(context.resource),
    () => validateCodingHygiene(
      context.resource,
      context.existingIssues,
      context.ucumValidator,
    ),
    () => validateDeepLocalCodings(
      context.resource,
      context.existingIssues,
      context.valueSetValidator,
      context.fhirVersion,
      context.sourceContext,
    ),
  ];
}
