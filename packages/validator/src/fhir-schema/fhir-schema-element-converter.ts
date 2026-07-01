import type {
  FHIRSchemaBinding,
  FHIRSchemaElement,
  SDElement,
  StructureDefinition,
} from './fhir-schema-types';

export type TargetProfileTypeResolver = (canonical: string) => StructureDefinition | undefined;

export function convertElement(
  el: SDElement,
  resolveTargetProfile?: TargetProfileTypeResolver,
): FHIRSchemaElement {
  const result: FHIRSchemaElement = {};

  if (el.type && el.type.length === 1) {
    const typeCode = el.type[0].code;
    result.type = typeCode;

    if (typeCode === 'Reference' && el.type[0].targetProfile) {
      result.refers = el.type[0].targetProfile;
      const targetTypes = resolveReferenceTargetTypes(el.type[0].targetProfile, resolveTargetProfile);
      if (targetTypes) {
        result.referenceTargetTypes = targetTypes;
      }
    }

    if ((typeCode === 'Extension') && el.type[0].profile?.length) {
      result.extensionUrl = el.type[0].profile[0];
    }
  } else if (el.type && el.type.length > 1) {
    result.type = 'choice';
  }

  if (el.min !== undefined) result.min = el.min;
  if (el.max === '*') {
    result.collection = true;
  } else if (el.max !== undefined) {
    const maxNum = parseInt(el.max, 10);
    if (!isNaN(maxNum)) {
      result.max = maxNum;
      if (maxNum > 1) result.collection = true;
    }
  }

  if (el.min && el.min > 0) result.required = true;

  if (el.binding?.valueSet) {
    result.binding = {
      valueSet: el.binding.valueSet,
      strength: el.binding.strength as FHIRSchemaBinding['strength'],
    };
  }

  if (el.constraint && el.constraint.length > 0) {
    result.constraints = el.constraint.map(c => ({
      key: c.key,
      severity: c.severity === 'error' ? 'error' : 'warning',
      human: c.human,
      expression: c.expression,
    }));
  }

  const fixedValue = getFirstPrefixedValue(el, 'fixed');
  if (fixedValue !== undefined) result.fixed = fixedValue;

  const patternValue = getFirstPrefixedValue(el, 'pattern');
  if (patternValue !== undefined) result.pattern = patternValue;

  return result;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getFirstPrefixedValue(el: SDElement, prefix: 'fixed' | 'pattern'): unknown {
  for (const [key, value] of Object.entries(el)) {
    if (key.startsWith(prefix) && value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function resolveReferenceTargetTypes(
  targetProfiles: string[],
  resolveTargetProfile?: TargetProfileTypeResolver,
): string[] | undefined {
  const targetTypes = new Set<string>();

  for (const profile of targetProfiles) {
    const targetType = resolveReferenceTargetType(profile, resolveTargetProfile);
    if (!targetType) {
      return undefined;
    }
    targetTypes.add(targetType);
  }

  return targetTypes.size > 0 ? Array.from(targetTypes) : undefined;
}

function resolveReferenceTargetType(
  canonical: string,
  resolveTargetProfile?: TargetProfileTypeResolver,
): string | undefined {
  const stripped = canonical.split('|')[0];
  if (
    stripped === 'http://hl7.org/fhir/StructureDefinition/Resource' ||
    stripped === 'http://hl7.org/fhir/StructureDefinition/DomainResource'
  ) {
    return undefined;
  }

  const coreMatch = stripped.match(/^http:\/\/hl7\.org\/fhir\/StructureDefinition\/([A-Z][A-Za-z]+)$/);
  if (coreMatch) {
    return coreMatch[1];
  }

  const resolved = resolveTargetProfile?.(stripped) ?? resolveTargetProfile?.(canonical);
  return typeof resolved?.type === 'string' ? resolved.type : undefined;
}
