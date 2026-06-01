import type { ValidationIssue } from '../../types';
import { UCUM_SYSTEM_URL, quantityUsesUcum, ucumCodeHasAnnotation, validateUcumCode } from '../../validators/ucum-validator';

export const UCUM_BEARING_TYPES = new Set<string>([
  'Quantity', 'SimpleQuantity', 'MoneyQuantity',
  'Age', 'Distance', 'Duration', 'Count',
]);

export function validateUcumAtPath(
  resource: any,
  elementDef: any,
  path: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const elementTypes: string[] = elementDef.type?.map((t: any) => t.code) || [];
  const isPolymorphic = path.endsWith('[x]');

  const segments = path.split('.');
  const leafSeg = segments[segments.length - 1];
  const parentSegments = segments.slice(1, -1);

  interface ContainerHit { value: any; path: string; }
  let containers: ContainerHit[] = [{ value: resource, path: segments[0] || resource?.resourceType || 'Resource' }];
  for (const seg of parentSegments) {
    const next: ContainerHit[] = [];
    for (const c of containers) {
      if (c.value === null || c.value === undefined) continue;
      const v = c.value[seg];
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

  interface LeafHit { value: any; leafName: string; basePath: string; }
  const leaves: LeafHit[] = [];
  for (const c of containers) {
    if (isPolymorphic) {
      const stem = leafSeg.replace('[x]', '');
      for (const t of elementTypes) {
        if (!UCUM_BEARING_TYPES.has(t)) continue;
        const key = stem + t.charAt(0).toUpperCase() + t.slice(1);
        const v = c.value[key];
        if (v !== undefined && v !== null) leaves.push({ value: v, leafName: key, basePath: c.path });
      }
    } else {
      const v = c.value[leafSeg];
      if (v !== undefined && v !== null) leaves.push({ value: v, leafName: leafSeg, basePath: c.path });
    }
  }

  for (const hit of leaves) {
    const items = Array.isArray(hit.value) ? hit.value : [hit.value];
    for (let idx = 0; idx < items.length; idx++) {
      const q = items[idx];
      if (!quantityUsesUcum(q)) continue;
      const result = validateUcumCode(q.code);
      const arrayPart = Array.isArray(hit.value) ? `[${idx}]` : '';
      const finalPath = `${hit.basePath}.${hit.leafName}${arrayPart}.code`;

      if (result.valid) {
        if (ucumCodeHasAnnotation(q.code)) {
          issues.push({
            id: `terminology-ucum-annotation-${Date.now()}-${idx}`,
            aspect: 'terminology',
            severity: 'information',
            code: 'terminology-ucum-annotation',
            message: `UCUM code '${q.code}' at ${finalPath} contains a human-readable annotation. UCUM annotations are ignored semantically, so validation should not depend on them`,
            path: finalPath,
            timestamp: new Date(),
          });
        }
        continue;
      }

      issues.push({
        id: `terminology-ucum-invalid-${Date.now()}-${idx}`,
        aspect: 'terminology',
        severity: 'error',
        code: 'terminology-code-invalid',
        message: buildInvalidUcumMessage(q.code, finalPath, result.message, result.suggestion),
        path: finalPath,
        timestamp: new Date(),
        details: buildInvalidUcumIssueDetails(q.code, finalPath, result.message, result.suggestion),
      });
    }
  }

  return issues;
}

function extractUcumSuggestion(message: string | undefined): { code: string; display?: string } | undefined {
  if (!message) return undefined;
  const match = message.match(/Did you mean\s+([^\s]+)(?:\s+\(([^)]+)\))?/i);
  if (!match?.[1]) return undefined;
  return {
    code: match[1],
    ...(match[2] ? { display: match[2] } : {}),
  };
}

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
  message: string | undefined,
  parserSuggestion?: { code: string; display?: string },
): { code: string; display?: string } | undefined {
  // Prefer ucum-lhc's own suggestion engine; the static table is a curated
  // fallback for the handful of corrections it does not propose (gap P-5).
  return parserSuggestion ?? extractUcumSuggestion(message) ?? COMMON_UCUM_CORRECTIONS[code];
}

export function buildInvalidUcumIssueDetails(
  code: string,
  fieldPath: string,
  message: string | undefined,
  parserSuggestion?: { code: string; display?: string },
): Record<string, unknown> {
  const suggestion = getUcumSuggestion(code, message, parserSuggestion);
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
  const suggestion = getUcumSuggestion(code, message, parserSuggestion);
  const base = `Invalid UCUM code '${code}' at ${fieldPath}`;
  if (suggestion) {
    const reason = message ? `: ${message}` : '.';
    return `${base}${reason} Use '${suggestion.code}' in Quantity.code.`;
  }
  return message ? `${base}: ${message}` : `${base}.`;
}
