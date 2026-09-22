import { describe, expect, it } from 'vitest';
import { rewriteCollectionTypeOperators } from '../fhirpath-as-operator-rewrite';

describe('rewriteCollectionTypeOperators — as', () => {
  it('rewrites a simple path cast', () => {
    expect(rewriteCollectionTypeOperators('value as Quantity')).toBe('value.ofType(Quantity)');
  });

  it('rewrites a $this cast', () => {
    expect(rewriteCollectionTypeOperators('$this as dateTime')).toBe('$this.ofType(dateTime)');
  });

  it('rewrites a dotted-path collection cast', () => {
    expect(rewriteCollectionTypeOperators('component.value as Quantity'))
      .toBe('component.value.ofType(Quantity)');
  });

  it('rewrites a cast inside a parenthesised sub-expression (parens retained)', () => {
    expect(rewriteCollectionTypeOperators('(value as Quantity).code.exists()'))
      .toBe('(value.ofType(Quantity)).code.exists()');
  });

  it('rewrites a cast applied to a parenthesised group operand', () => {
    expect(rewriteCollectionTypeOperators('(value | extension.value) as Quantity'))
      .toBe('(value | extension.value).ofType(Quantity)');
  });

  it('rewrites multiple casts in one expression', () => {
    expect(rewriteCollectionTypeOperators('(value as Quantity).exists() or (value as string).exists()'))
      .toBe('(value.ofType(Quantity)).exists() or (value.ofType(string)).exists()');
  });

  it('does not touch expressions without an `as` operator', () => {
    const expr = 'name.given.exists() and class.code = 1';
    expect(rewriteCollectionTypeOperators(expr)).toBe(expr);
  });

  it('does not mis-trigger on identifiers containing "as"', () => {
    const expr = "class.where(code = 'AMB').exists()";
    expect(rewriteCollectionTypeOperators(expr)).toBe(expr);
  });
});

describe('rewriteCollectionTypeOperators — is', () => {
  it.each([
    "value.matches('value is Quantity')",
    "value.matches('value as Quantity')",
    "value.matches('patient\\'s value is Quantity')",
    '`value is Quantity`.exists()',
  ])('preserves quoted text in %s', expression => {
    expect(rewriteCollectionTypeOperators(expression)).toBe(expression);
  });

  it('rewrites operators outside literals in the same expression', () => {
    expect(rewriteCollectionTypeOperators("value.matches('value is Quantity') and value is Quantity"))
      .toBe("value.matches('value is Quantity') and value.select($this is Quantity)");
  });

  it('rewrites a dotted-path `is` into a collection-safe select()', () => {
    expect(rewriteCollectionTypeOperators('component.value is Quantity'))
      .toBe('component.value.select($this is Quantity)');
  });

  it('rewrites a bare path `is`', () => {
    expect(rewriteCollectionTypeOperators('value is Quantity'))
      .toBe('value.select($this is Quantity)');
  });

  // `.all()` would make `is` on EMPTY input vacuously true, flipping
  // `who.exists(resolve() is Practitioner) implies ...` constraints into
  // false positives for unresolvable references (US Core provenance-1).
  it('rewrites a function-call `is` operand so empty input stays empty', () => {
    expect(rewriteCollectionTypeOperators('who.exists((resolve() is Practitioner) or (resolve() is Device)) implies onBehalfOf.exists()'))
      .toBe('who.exists((resolve().select($this is Practitioner)) or (resolve().select($this is Device))) implies onBehalfOf.exists()');
  });

  it('leaves a $this `is` operand untouched (already singleton context)', () => {
    expect(rewriteCollectionTypeOperators('value.all($this is Quantity)'))
      .toBe('value.all($this is Quantity)');
  });

  it('does not mis-trigger on identifiers containing "is"', () => {
    const expr = "basis.where(code = 'x').exists()";
    expect(rewriteCollectionTypeOperators(expr)).toBe(expr);
  });
});

describe('rewriteCollectionTypeOperators — reserved FHIR member names', () => {
  it('quotes XHTML narrative div member access before compile', () => {
    expect(rewriteCollectionTypeOperators('text.div.exists()'))
      .toBe('text.`div`.exists()');
  });

  it('does not rewrite already-delimited div identifiers', () => {
    expect(rewriteCollectionTypeOperators('text.`div`.exists()'))
      .toBe('text.`div`.exists()');
  });

  it('does not rewrite div text inside string literals', () => {
    expect(rewriteCollectionTypeOperators("extension.where(url = 'http://example.org/text.div').exists()"))
      .toBe("extension.where(url = 'http://example.org/text.div').exists()");
  });

  it('does not rewrite longer identifiers that start with div', () => {
    expect(rewriteCollectionTypeOperators('text.diversity.exists()'))
      .toBe('text.diversity.exists()');
  });
});
