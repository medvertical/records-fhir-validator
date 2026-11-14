import { describe, expect, it } from 'vitest';
import { parseFhirJson } from './fhir-json-input.js';
import { FhirPathDecimalInput } from '../validators/fhirpath-decimal-input.js';
import fhirpath from 'fhirpath';
import { getFhirPathModel } from '../core/fhirpath-context.js';
import { numberSource } from './number-source.js';

describe('raw JSON decimal input', () => {
  it('retains original tokens outside the serializable FHIR payload', () => {
    const parsed = parseFhirJson('{"resourceType":"Observation","valueQuantity":{"value":19.00}}');
    const resource = parsed.resources[0];
    expect(JSON.stringify(resource)).toBe('{"resourceType":"Observation","valueQuantity":{"value":19}}');
    const projection = new FhirPathDecimalInput('R4').project(resource);
    expect(fhirpath.evaluate(projection, 'value.value.toString()', {}, getFhirPathModel())).toEqual(['19.00']);
  });

  it('keeps unsafe-looking JSON keys as own data without changing prototypes', () => {
    const resource = parseFhirJson('{"resourceType":"Observation","__proto__":{"value":19.00}}').resources[0];
    const projection = new FhirPathDecimalInput('R4').project(resource);
    expect(Object.getPrototypeOf(resource)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(projection)).toBe(Object.prototype);
    expect(Object.hasOwn(projection, '__proto__')).toBe(true);
    expect(Object.hasOwn(Object.prototype, 'value')).toBe(false);
  });

  it('retains the last duplicate property token and each array occurrence', () => {
    const parsed = parseFhirJson('{"resourceType":"Observation","value":5.0,"\\u0076alue":5.00,'
      + '"list":[5.0,5.00,"5.00"],"quantity":{"value":5.0},"quantity":{"value":5.000}}');
    const resource = parsed.resources[0];
    const list = resource.list as number[];
    expect(numberSource(resource, 'value', 5)).toBe('5.00');
    expect(numberSource(list, '0', 5)).toBe('5.0');
    expect(numberSource(list, '1', 5)).toBe('5.00');
    expect(numberSource(list, '2', 5)).toBeUndefined();
    expect(numberSource(resource.quantity as object, 'value', 5)).toBe('5.000');
  });

  it.each(['{}', '[]', 'null', '{"resourceType":false}', '{"resourceType":""}'])('rejects a non-resource %s', value => {
    expect(() => parseFhirJson(value)).toThrow('resourceType');
  });

  it('enforces byte, depth and node limits', () => {
    const source = '{"resourceType":"Observation","valueQuantity":{"value":19.00}}';
    expect(() => parseFhirJson(source, { maxBytes: 5 })).toThrow('byte limit');
    expect(() => parseFhirJson(source, { maxDepth: 1 })).toThrow('depth limit');
    expect(() => parseFhirJson(source, { maxNodes: 1 })).toThrow('node limit');
  });
});
