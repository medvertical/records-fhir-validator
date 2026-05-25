import type { StructureDefinition } from '../structure-definition-types';
import { extractFixedValue, extractPatternValue, matchesPattern, valuesMatch } from '../../validators/slice-utils';

function elementRuleMatchesValue(elementDef: any, value: any): boolean {
  const fixed = extractFixedValue(elementDef);
  if (fixed !== undefined && !valuesMatch(value, fixed)) return false;

  const pattern = extractPatternValue(elementDef);
  if (pattern !== undefined && !matchesPattern(value, pattern)) return false;

  return fixed !== undefined || pattern !== undefined;
}

export function shouldSkipRulesForSiblingSliceTarget(
  elementDef: any,
  value: any,
  structureDef: StructureDefinition,
): boolean {
  if (!elementDef.id?.includes(':')) return false;
  if (elementRuleMatchesValue(elementDef, value)) return false;

  const siblingRuleElements = structureDef.snapshot?.element.filter(candidate =>
    candidate !== elementDef &&
    candidate.path === elementDef.path &&
    candidate.id?.includes(':') &&
    (extractFixedValue(candidate) !== undefined || extractPatternValue(candidate) !== undefined),
  ) ?? [];

  return siblingRuleElements.some(candidate => elementRuleMatchesValue(candidate, value));
}

export function hasElementDefinitionRules(elementDef: Record<string, unknown>): boolean {
  return Object.keys(elementDef).some((key) =>
    key.startsWith('fixed') ||
    key.startsWith('pattern') ||
    key.startsWith('minValue') ||
    key.startsWith('maxValue') ||
    key === 'minLength' ||
    key === 'maxLength'
  );
}

export function shouldSkipSnapshotElement(elementDef: any, resourceType: string): boolean {
  if (elementDef.sliceName) return true;
  if (typeof elementDef.id === 'string' && elementDef.id.includes(':')) return true;

  const path = typeof elementDef.path === 'string' ? elementDef.path : '';

  if (resourceType === 'StructureDefinition') {
    return (
      path.startsWith('StructureDefinition.snapshot.element.') ||
      path.startsWith('StructureDefinition.differential.element.')
    );
  }

  if (resourceType === 'Bundle') {
    return /^Bundle\.entry\.resource\./.test(path);
  }

  if (resourceType === 'Parameters') {
    return /^Parameters\.parameter(\.part)*\.resource\./.test(path);
  }

  return false;
}
