import type { ElementDefinition } from '../structure-definition-types.js';
import { matchesPattern } from '../../validators/slice-utils.js';

export function codingMatchesPattern(coding: unknown, pattern: Record<string, unknown>): boolean {
  if (!coding || typeof coding !== 'object' || Array.isArray(coding)) return false;
  const candidate = coding as Record<string, unknown>;
  return Object.entries(pattern).every(([key, value]) => candidate[key] === value);
}

export function codeableConceptMatchesPattern(value: unknown, pattern: Record<string, unknown>): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;

  return Object.entries(pattern).every(([key, expected]) => {
    if (key === 'coding' && Array.isArray(expected)) {
      const candidateCodings = Array.isArray(candidate.coding) ? candidate.coding : [];
      return expected.every(patternCoding =>
        candidateCodings.some(candidateCoding =>
          codingMatchesPattern(candidateCoding, patternCoding as Record<string, unknown>),
        ),
      );
    }
    return candidate[key] === expected;
  });
}

export function elementMatchesOwnPattern(elementDef: ElementDefinition, value: unknown): boolean {
  const patternOrFixed = getPatternOrFixedValue(elementDef);
  if (patternOrFixed !== undefined) return matchesPattern(value, patternOrFixed);

  const patternCoding = (elementDef as ElementDefinition & { patternCoding?: Record<string, unknown> }).patternCoding;
  if (patternCoding) return codingMatchesPattern(value, patternCoding);

  const patternCodeableConcept = (
    elementDef as ElementDefinition & { patternCodeableConcept?: Record<string, unknown> }
  ).patternCodeableConcept;
  return patternCodeableConcept
    ? codeableConceptMatchesPattern(value, patternCodeableConcept)
    : false;
}

export function getPatternOrFixedValue(elementDef: ElementDefinition): unknown {
  const candidate = elementDef as ElementDefinition & Record<string, unknown>;
  if (candidate.pattern !== undefined) return candidate.pattern;
  if (candidate.fixed !== undefined) return candidate.fixed;
  for (const key of Object.keys(candidate)) {
    if ((key.startsWith('pattern') || key.startsWith('fixed')) && key !== 'pattern' && key !== 'fixed') {
      return candidate[key];
    }
  }
  return undefined;
}
