import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateLocalCodeSystemCoding } from './terminology-external-code-system-rules.js';
import type { ProfileSourceContext } from '../../persistence/index.js';
import { isKnownCodeSystemConcept } from './terminology-display-rules.js';
import type { TerminologyCodeSystemValidationPort } from './terminology-validation-port.js';

function isCodingPath(path: string): boolean {
  return /\.coding\[\d+\]$/.test(path) || /\.(?:value|answer|pattern|fixed)Coding$/.test(path);
}

/**
 * Validate Coding instances below complex datatypes (for example
 * Identifier.type.coding). Core resource snapshots often stop at the
 * datatype boundary, so the StructureDefinition-driven terminology pass
 * cannot see these children.
 */
export async function validateDeepLocalCodings(
  resource: unknown,
  existingIssues: ValidationIssue[],
  valuesetValidator: Pick<TerminologyCodeSystemValidationPort, 'validateCodeInLocalCodeSystemOnly'>,
  fhirVersion: 'R4' | 'R5' | 'R6',
  sourceContext?: ProfileSourceContext,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const seen = new Set(existingIssues.map((issue) => `${issue.code}|${issue.path}`));
  const root = resourceTypeOf(resource);
  const visited = new WeakSet<object>();

  const visit = async (value: unknown, path: string): Promise<void> => {
    if (value === null || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        await visit(value[index], `${path}[${index}]`);
      }
      return;
    }
    if (!isRecord(value)) return;

    if (isCodingPath(path)) {
      let localIssues = await validateLocalCodeSystemCoding(value, path, valuesetValidator, fhirVersion, sourceContext);
      if (isKnownCodeSystemConcept(value.system, value.code)) {
        localIssues = localIssues.filter((issue) => issue.code !== 'terminology-codesystem-unresolvable');
      }
      for (const issue of localIssues) {
        const key = `${issue.code}|${issue.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({ ...issue, resourceType: root });
      }
    }

    for (const [key, child] of Object.entries(value)) {
      // Bundle entries are validated as their own resources by the recursive
      // batch path; do not duplicate their terminology findings on Bundle.
      if (root === 'Bundle' && key === 'resource' && /^Bundle\.entry\[\d+\]$/.test(path)) continue;
      await visit(child, `${path}.${key}`);
    }
  };

  await visit(resource, root);
  return issues;
}

function resourceTypeOf(value: unknown): string {
  return isRecord(value) && typeof value.resourceType === 'string' ? value.resourceType : 'Resource';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
