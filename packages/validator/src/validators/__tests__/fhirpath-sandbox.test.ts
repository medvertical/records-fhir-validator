import { describe, it, expect } from 'vitest';
import { checkFhirpathSandbox } from '../fhirpath-sandbox';

describe('checkFhirpathSandbox — happy path', () => {
  it('accepts the FHIR core dom-3 constraint', () => {
    const dom3 = `contained.contained.empty() and contained.where(('#'+id in (%resource.descendants().reference | %resource.descendants().as(canonical) | %resource.descendants().as(uri) | %resource.descendants().ofType(Reference).reference | %resource.descendants().ofType(Reference).type | %resource.descendants().ofType(Reference).identifier.system | %resource.descendants().ofType(Reference).identifier.value)).not()).empty()`;
    const r = checkFhirpathSandbox(dom3);
    expect(r.ok).toBe(true);
    expect(r.metrics.expressionLength).toBeLessThan(4096);
    expect(r.metrics.functionCallCount).toBeLessThan(64);
    expect(r.metrics.nestingDepth).toBeLessThan(16);
  });

  it('accepts a simple invariant', () => {
    expect(checkFhirpathSandbox('Patient.name.exists()').ok).toBe(true);
  });

  it('accepts the compliesWithProfile-style cardinality check', () => {
    expect(checkFhirpathSandbox(
      "extension.where(url='http://hl7.org/fhir/StructureDefinition/structuredefinition-compliesWithProfile').exists() implies differential.element.where(min > 0).exists()"
    ).ok).toBe(true);
  });
});

describe('checkFhirpathSandbox — limits', () => {
  it('rejects expressions longer than the configured length', () => {
    const big = 'a'.repeat(5000);
    const r = checkFhirpathSandbox(big);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Expression length/);
    expect(r.metrics.expressionLength).toBe(5000);
  });

  it('rejects too many function calls', () => {
    // 70 nested where()s — pathological by construction
    let expr = 'Patient.name';
    for (let i = 0; i < 70; i++) expr += `.where(family='x')`;
    const r = checkFhirpathSandbox(expr);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Function-call count/);
    expect(r.metrics.functionCallCount).toBeGreaterThan(64);
  });

  it('rejects deeply nested parentheses', () => {
    // 20 levels deep
    let expr = 'Patient';
    for (let i = 0; i < 20; i++) expr = `(${expr})`;
    const r = checkFhirpathSandbox(expr);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Nesting depth/);
    expect(r.metrics.nestingDepth).toBe(20);
  });

  it('rejects empty expression', () => {
    expect(checkFhirpathSandbox('').ok).toBe(false);
    expect(checkFhirpathSandbox(undefined as any).ok).toBe(false);
  });

  it('respects custom limits', () => {
    const tight = checkFhirpathSandbox('Patient.name.exists()', {
      functionCallCount: 0,
    });
    expect(tight.ok).toBe(false);
    expect(tight.reason).toMatch(/Function-call count/);
  });
});

describe('checkFhirpathSandbox — string-literal awareness', () => {
  it('does not count function-shaped names inside string literals', () => {
    // Three real calls: `where`, `matches`, `exists`. The string contains
    // text that LOOKS like calls (`where(`, `extra(`) but it's quoted.
    const expr = "Patient.where(name.given.matches('where(extra(stuff))')).exists()";
    const r = checkFhirpathSandbox(expr);
    expect(r.ok).toBe(true);
    expect(r.metrics.functionCallCount).toBe(3);
  });

  it('handles backslash-escaped quotes inside string literals', () => {
    const expr = `Patient.name.given.matches('it\\'s ok')`;
    const r = checkFhirpathSandbox(expr);
    expect(r.ok).toBe(true);
  });

  it('counts identifier-paren even with whitespace between them', () => {
    const r = checkFhirpathSandbox('Patient.name.exists ()');
    expect(r.metrics.functionCallCount).toBe(1);
  });
});

describe('checkFhirpathSandbox — metrics observability', () => {
  it('returns measured metrics even when accepting', () => {
    const r = checkFhirpathSandbox(
      'Patient.identifier.where(use="official").value.exists()',
    );
    expect(r.ok).toBe(true);
    expect(r.metrics.functionCallCount).toBe(2);
    expect(r.metrics.nestingDepth).toBe(1);
    expect(r.metrics.expressionLength).toBeGreaterThan(0);
  });
});
