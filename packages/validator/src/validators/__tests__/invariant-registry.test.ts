import { describe, expect, it } from 'vitest';

import { InvariantRegistry } from '../invariant-registry';

describe('InvariantRegistry', () => {
  it('marks AllergyIntolerance ait-1/ait-2 as specialised to avoid duplicate generic FHIRPath output', () => {
    expect(InvariantRegistry.isSpecialised('ait-1')).toBe(true);
    expect(InvariantRegistry.getHandlerFile('ait-1')).toBe('resource-specific-constraints-validator.ts');
    expect(InvariantRegistry.isSpecialised('ait-2')).toBe(true);
    expect(InvariantRegistry.getHandlerFile('ait-2')).toBe('resource-specific-constraints-validator.ts');
  });

  it('marks Composition cmp-1/cmp-2 as specialised to avoid duplicate generic FHIRPath output', () => {
    expect(InvariantRegistry.isSpecialised('cmp-1')).toBe(true);
    expect(InvariantRegistry.getHandlerFile('cmp-1')).toBe('resource-specific-constraints-validator.ts');
    expect(InvariantRegistry.isSpecialised('cmp-2')).toBe(true);
    expect(InvariantRegistry.getHandlerFile('cmp-2')).toBe('resource-specific-constraints-validator.ts');
  });

  it('routes CodeSystem and ValueSet name invariants through their presence-aware validator', () => {
    expect(InvariantRegistry.getHandlerFile('csd-0'))
      .toBe('canonical-resource-invariant-validator.ts');
    expect(InvariantRegistry.getHandlerFile('vsd-0'))
      .toBe('canonical-resource-invariant-validator.ts');
  });

  it('marks Questionnaire que-0 as specialised to avoid duplicate generic FHIRPath output', () => {
    expect(InvariantRegistry.isSpecialised('que-0')).toBe(true);
    expect(InvariantRegistry.getHandlerFile('que-0')).toBe('questionnaire-validator.ts');
  });
});
