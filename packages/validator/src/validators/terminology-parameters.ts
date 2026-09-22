import type { SubsumptionOutcome } from './terminology-api-types.js';
import type { CodeBindingOutcome } from './valueset-types.js';
import {
  getNestedString,
  getOperationOutcomeIssueValues,
  getParametersEntries,
  isTerminologyResponseRecord,
} from './terminology-response-utils.js';

const SUBSUMPTION_OUTCOMES = new Set<SubsumptionOutcome>([
  'subsumes',
  'subsumed-by',
  'equivalent',
  'not-subsumed',
  'unknown',
]);

const UNRESOLVABLE_DEFINITION = /(?:value\s?set|code\s?system).*?(?:could not be (?:found|resolved)|not (?:found|supported|resolved))|unable to (?:find|resolve).*?(?:value\s?set|code\s?system)|does not support (?:this |the )?(?:code\s?system|value\s?set)/i;

export function validateCodeSucceeded(parameters: unknown): boolean {
  const entries = getParametersEntries(parameters);
  if (!entries) return false;
  const resultParam = entries.find(parameter => parameter.name === 'result');
  return resultParam?.valueBoolean === true;
}

export function extractSubsumptionOutcome(parameters: unknown): SubsumptionOutcome | undefined {
  const entries = getParametersEntries(parameters);
  if (!entries) return undefined;
  const outcomeParam = entries.find(parameter => parameter.name === 'outcome');
  const outcome = outcomeParam?.valueCode;
  return typeof outcome === 'string' && SUBSUMPTION_OUTCOMES.has(outcome as SubsumptionOutcome)
    ? outcome as SubsumptionOutcome
    : undefined;
}

export function operationOutcomeCannotResolveBinding(outcome: unknown): boolean {
  const entries = getParametersEntries(outcome);
  const issues = getOperationOutcomeIssueValues(outcome)
    ?? entries?.flatMap(entry => getOperationOutcomeIssueValues(entry.resource) ?? [])
    ?? [];
  return entries?.some(entry => entry.name === 'message'
    && typeof entry.valueString === 'string' && UNRESOLVABLE_DEFINITION.test(entry.valueString)) === true
    || issues.some(issue =>
    isTerminologyResponseRecord(issue) &&
    (
      issue.code === 'not-found' || issue.code === 'not-supported' ||
      UNRESOLVABLE_DEFINITION.test(getNestedString(issue, 'diagnostics') ?? '') ||
      UNRESOLVABLE_DEFINITION.test(getNestedString(issue, 'details', 'text') ?? '') ||
      /could not be (?:found|resolved)|unable to (?:find|resolve)|not.*resolved/i.test(
        getNestedString(issue, 'details', 'text') ?? '',
      )
    )
  );
}

/** HTTP success only describes transport; unresolved definitions are not code rejections. */
export function valueSetValidationOutcome(parameters: unknown): CodeBindingOutcome {
  if (operationOutcomeCannotResolveBinding(parameters)) return 'unverified';
  const entries = getParametersEntries(parameters);
  const result = entries?.find(parameter => parameter.name === 'result')?.valueBoolean;
  if (result === true) return 'valid';
  if (result !== false) return 'unverified';
  const message = entries?.find(parameter => parameter.name === 'message')?.valueString;
  if (typeof message === 'string' && UNRESOLVABLE_DEFINITION.test(message)) {
    return 'unverified';
  }
  return 'invalid';
}
