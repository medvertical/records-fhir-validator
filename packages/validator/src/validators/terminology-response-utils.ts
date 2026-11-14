export type TerminologyResponseRecord = Record<string, unknown>;

export function isTerminologyResponseRecord(
  value: unknown,
): value is TerminologyResponseRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getParametersEntries(
  value: unknown,
): TerminologyResponseRecord[] | null {
  if (
    !isTerminologyResponseRecord(value) ||
    value.resourceType !== 'Parameters' ||
    !Array.isArray(value.parameter)
  ) {
    return null;
  }
  return value.parameter.filter(isTerminologyResponseRecord);
}

/** An authoritative scalar cannot depend on response ordering or conflicting FHIR value choices. */
export function getSingleParameterValue(
  response: unknown,
  name: string,
  valueKey: `value${string}`,
): unknown {
  const entries = getParametersEntries(response);
  if (!entries || !isTerminologyResponseRecord(response) || !Array.isArray(response.parameter)
    || entries.length !== response.parameter.length || response.implicitRules !== undefined
    || response.modifierExtension !== undefined
    || entries.some(entry => typeof entry.name !== 'string' || !entry.name.trim())) return undefined;
  const matches = entries.filter(entry => entry.name === name);
  if (matches.length !== 1) return undefined;
  const parameter = matches[0];
  const values = Object.keys(parameter).filter(key => key.startsWith('value'));
  if (values.length !== 1 || values[0] !== valueKey || parameter.resource !== undefined
    || parameter.part !== undefined || parameter.modifierExtension !== undefined) return undefined;
  return parameter[valueKey];
}

export function getOperationOutcomeIssueValues(value: unknown): unknown[] | null {
  if (
    !isTerminologyResponseRecord(value) ||
    value.resourceType !== 'OperationOutcome' ||
    !Array.isArray(value.issue)
  ) {
    return null;
  }
  return value.issue;
}

export function getNestedString(
  value: unknown,
  ...path: string[]
): string | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (!isTerminologyResponseRecord(current)) return undefined;
    current = current[segment];
  }
  return typeof current === 'string' ? current : undefined;
}
