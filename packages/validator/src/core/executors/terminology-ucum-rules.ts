import type { ValidationIssue } from '@records-fhir/validation-types';
import { createTerminologyIssue } from '../../terminology/terminology-issue.js';
import {
  UCUM_SYSTEM_URL,
  quantityUsesUcum,
  UcumCodeValidator,
  ucumCodeHasAnnotation,
} from '../../validators/ucum-validator.js';

export const UCUM_BEARING_TYPES = new Set<string>([
  'Quantity', 'SimpleQuantity', 'MoneyQuantity',
  'Age', 'Distance', 'Duration', 'Count',
]);

export function validateUcumAtPath(
  resource: unknown,
  elementDef: unknown,
  path: string,
  ucumValidator: UcumCodeValidator = new UcumCodeValidator(),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const definition = asRecord(elementDef);
  const elementTypes = Array.isArray(definition?.type)
    ? definition.type
      .map(type => asRecord(type)?.code)
      .filter((code): code is string => typeof code === 'string')
    : [];
  const isPolymorphic = path.endsWith('[x]');

  const segments = path.split('.');
  const leafSeg = segments.at(-1);
  if (!leafSeg) return issues;
  const parentSegments = segments.slice(1, -1);

  interface ContainerHit { value: unknown; path: string; }
  const resourceRecord = asRecord(resource);
  let containers: ContainerHit[] = [{
    value: resource,
    path: segments[0]
      || (typeof resourceRecord?.resourceType === 'string' ? resourceRecord.resourceType : 'Resource'),
  }];
  for (const seg of parentSegments) {
    const next: ContainerHit[] = [];
    for (const c of containers) {
      const container = asRecord(c.value);
      if (!container) continue;
      const v = container[seg];
      if (Array.isArray(v)) {
        v.forEach((item, index) => {
          if (item !== null && item !== undefined) {
            next.push({ value: item, path: `${c.path}.${seg}[${index}]` });
          }
        });
      } else if (v !== undefined && v !== null) {
        next.push({ value: v, path: `${c.path}.${seg}` });
      }
    }
    containers = next;
  }

  interface LeafHit { value: unknown; leafName: string; basePath: string; }
  const leaves: LeafHit[] = [];
  for (const c of containers) {
    const container = asRecord(c.value);
    if (!container) continue;
    if (isPolymorphic) {
      const stem = leafSeg.replace('[x]', '');
      for (const t of elementTypes) {
        if (!UCUM_BEARING_TYPES.has(t)) continue;
        const key = stem + t.charAt(0).toUpperCase() + t.slice(1);
        const v = container[key];
        if (v !== undefined && v !== null) leaves.push({ value: v, leafName: key, basePath: c.path });
      }
    } else {
      const v = container[leafSeg];
      if (v !== undefined && v !== null) leaves.push({ value: v, leafName: leafSeg, basePath: c.path });
    }
  }

  for (const hit of leaves) {
    const items = Array.isArray(hit.value) ? hit.value : [hit.value];
    for (let idx = 0; idx < items.length; idx++) {
      const q = items[idx];
      if (!quantityUsesUcum(q)) continue;
      const result = ucumValidator.validate(q.code);
      const arrayPart = Array.isArray(hit.value) ? `[${idx}]` : '';
      const finalPath = `${hit.basePath}.${hit.leafName}${arrayPart}.code`;

      if (result.valid) {
        if (ucumCodeHasAnnotation(q.code)) {
          issues.push(createTerminologyIssue({
            severity: 'information',
            code: 'terminology-ucum-annotation',
            message: `UCUM code '${q.code}' at ${finalPath} contains a human-readable annotation. UCUM annotations are ignored semantically, so validation should not depend on them`,
            path: finalPath,
            details: {
              code: q.code,
              system: UCUM_SYSTEM_URL,
            },
          }));
        }
        continue;
      }

      issues.push(createTerminologyIssue({
        severity: 'error',
        code: 'terminology-code-invalid',
        message: buildInvalidUcumMessage(q.code, finalPath, result.message, result.suggestion),
        path: finalPath,
        details: buildInvalidUcumIssueDetails(q.code, finalPath, result.message, result.suggestion),
      }));
    }
  }

  return issues;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const suggestionValidator = new UcumCodeValidator();

const COMMON_UCUM_CORRECTIONS: Record<string, { code: string; display?: string }> = {
  pH: { code: '[pH]', display: 'pH' },
  'mm Hg': { code: 'mm[Hg]', display: 'millimeter of mercury' },
  day: { code: 'd', display: 'day' },
  days: { code: 'd', display: 'day' },
  mcg: { code: 'ug', display: 'microgram' },
  '\u00b5g': { code: 'ug', display: 'microgram' },
  '\u03bcg': { code: 'ug', display: 'microgram' },
  '\u00b5mol/L': { code: 'umol/L', display: 'micromole per liter' },
  '\u03bcmol/L': { code: 'umol/L', display: 'micromole per liter' },
  Celcius: { code: 'Cel', display: 'degree Celsius' },
  Celsius: { code: 'Cel', display: 'degree Celsius' },
  cel: { code: 'Cel', display: 'degree Celsius' },
};

function getUcumSuggestion(
  code: string,
  parserSuggestion?: { code: string; display?: string },
): { code: string; display?: string } | undefined {
  // Prefer ucum-lhc's own suggestion engine; the static table is a curated
  // fallback for the handful of corrections it does not propose (gap P-5).
  return parserSuggestion ?? COMMON_UCUM_CORRECTIONS[code] ?? suggestionValidator.validate(code).suggestion;
}

export function buildInvalidUcumIssueDetails(
  code: string,
  fieldPath: string,
  _message: string | undefined,
  parserSuggestion?: { code: string; display?: string },
): Record<string, unknown> {
  const suggestion = getUcumSuggestion(code, parserSuggestion);
  return {
    system: UCUM_SYSTEM_URL,
    code,
    fieldPath,
    ...(suggestion ? { suggestedCode: suggestion.code } : {}),
    ...(suggestion?.display ? { suggestedDisplay: suggestion.display } : {}),
    fixHint: suggestion
      ? `Replace UCUM code '${code}' with '${suggestion.code}'. Keep the human-readable unit label separate from Quantity.code if needed.`
      : `Replace UCUM code '${code}' with a valid UCUM expression for ${UCUM_SYSTEM_URL}.`,
  };
}

export function buildInvalidUcumMessage(
  code: string,
  fieldPath: string,
  message: string | undefined,
  parserSuggestion?: { code: string; display?: string },
): string {
  const suggestion = getUcumSuggestion(code, parserSuggestion);
  const base = `Invalid UCUM code '${code}' at ${fieldPath}`;
  if (suggestion) {
    const reason = message ? `: ${message}` : '.';
    return `${base}${reason} Use '${suggestion.code}' in Quantity.code.`;
  }
  return message ? `${base}: ${message}` : `${base}.`;
}
