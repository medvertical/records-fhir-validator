import { describe, it, expect } from 'vitest';
import {
  recordsValidator,
  toInternalFhirVersion,
  type PublicFhirVersion,
  type RecordsValidatorSingleton,
} from '../index';

describe('toInternalFhirVersion (K-2 phase 1)', () => {
  it('routes R4B through R4 — same StructureDefinitions and FHIRPath context', () => {
    expect(toInternalFhirVersion('R4B')).toBe('R4');
  });

  it('passes R4 / R5 / R6 through unchanged', () => {
    const cases: Array<[PublicFhirVersion, 'R4' | 'R5' | 'R6']> = [
      ['R4', 'R4'],
      ['R5', 'R5'],
      ['R6', 'R6'],
    ];
    for (const [input, expected] of cases) {
      expect(toInternalFhirVersion(input)).toBe(expected);
    }
  });

  it('compiles when callers pin the input type to PublicFhirVersion', () => {
    // Pure type-level smoke: the call site below must type-check with
    // 'R4B' as a literal because PublicFhirVersion includes it.
    const v: PublicFhirVersion = 'R4B';
    expect(toInternalFhirVersion(v)).toBe('R4');
  });

  it('exports a typed singleton facade without eager initialization', () => {
    const singleton: RecordsValidatorSingleton = recordsValidator;
    const validate: RecordsValidatorSingleton['validate'] = singleton.validate.bind(singleton);
    const validateAll: RecordsValidatorSingleton['validateAll'] = singleton.validateAll.bind(singleton);

    expect(singleton.isCreated()).toBe(false);
    expect(typeof validate).toBe('function');
    expect(typeof validateAll).toBe('function');
  });
});
