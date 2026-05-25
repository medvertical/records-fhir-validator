import type {
  FHIRSchemaBinding,
  FHIRSchemaElement,
  SDElement,
} from './fhir-schema-types';

export function convertElement(el: SDElement): FHIRSchemaElement {
  const result: FHIRSchemaElement = {};

  if (el.type && el.type.length === 1) {
    const typeCode = el.type[0].code;
    result.type = typeCode;

    if (typeCode === 'Reference' && el.type[0].targetProfile) {
      result.refers = el.type[0].targetProfile;
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

  const fixedValue = el.fixedString ?? el.fixedCode ?? el.fixedUri ?? el.fixedBoolean;
  if (fixedValue !== undefined) result.fixed = fixedValue;

  const patternValue = el.patternCodeableConcept ?? el.patternCoding ?? el.patternIdentifier;
  if (patternValue !== undefined) result.pattern = patternValue;

  return result;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
