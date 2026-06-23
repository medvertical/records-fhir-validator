import { describe, expect, it } from 'vitest';
import {
  clearConstraintExpressionCache,
  getConstraintExpressionCacheStats,
  getOrCompileFHIRPathExpression,
} from '../constraint-expression-cache';
import { sdFHIRPathExpressionCache } from '../sd-fhirpath-expression-cache';

const invalidExpression = 'Patient.name.';

describe('FHIRPath expression caches', () => {
  it('negative-caches ConstraintValidator compile failures', () => {
    clearConstraintExpressionCache();

    expect(() => getOrCompileFHIRPathExpression(invalidExpression, 'R4')).toThrow();
    expect(getConstraintExpressionCacheStats()).toEqual(expect.objectContaining({
      hits: 0,
      misses: 1,
      compileErrors: 1,
      size: 1,
    }));

    expect(() => getOrCompileFHIRPathExpression(invalidExpression, 'R4')).toThrow();
    expect(getConstraintExpressionCacheStats()).toEqual(expect.objectContaining({
      hits: 1,
      misses: 1,
      compileErrors: 1,
      size: 1,
    }));
  });

  it('negative-caches SD executor compile failures', () => {
    sdFHIRPathExpressionCache.clear();

    expect(sdFHIRPathExpressionCache.getOrCompile(invalidExpression, 'R4')).toBeNull();
    expect(sdFHIRPathExpressionCache.getStats()).toEqual(expect.objectContaining({
      hits: 0,
      misses: 1,
      compileErrors: 1,
      size: 1,
    }));

    expect(sdFHIRPathExpressionCache.getOrCompile(invalidExpression, 'R4')).toBeNull();
    expect(sdFHIRPathExpressionCache.getStats()).toEqual(expect.objectContaining({
      hits: 1,
      misses: 1,
      compileErrors: 1,
      size: 1,
    }));
  });
});
