import type { SubsumptionOutcome } from './terminology-api-types';

export function validateCodeSucceeded(parameters: any): boolean {
  if (parameters?.resourceType !== 'Parameters' || !Array.isArray(parameters.parameter)) {
    return false;
  }
  const resultParam = parameters.parameter.find((p: any) => p.name === 'result');
  return resultParam?.valueBoolean === true;
}

export function extractSubsumptionOutcome(parameters: any): SubsumptionOutcome | undefined {
  if (parameters?.resourceType !== 'Parameters' || !Array.isArray(parameters.parameter)) {
    return undefined;
  }
  const outcomeParam = parameters.parameter.find((p: any) => p.name === 'outcome');
  return outcomeParam?.valueCode as SubsumptionOutcome | undefined;
}

export function operationOutcomeCannotResolveBinding(outcome: any): boolean {
  return outcome?.resourceType === 'OperationOutcome' &&
    Array.isArray(outcome.issue) &&
    outcome.issue.some((issue: any) =>
      issue?.code === 'not-found' ||
      /could not be (?:found|resolved)|unable to (?:find|resolve)|not.*resolved/i.test(issue?.details?.text ?? '')
    );
}
