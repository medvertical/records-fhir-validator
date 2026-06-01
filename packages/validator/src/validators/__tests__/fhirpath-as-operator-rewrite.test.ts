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
  it('rewrites a dotted-path `is` into a collection-safe all()', () => {
    expect(rewriteCollectionTypeOperators('component.value is Quantity'))
      .toBe('component.value.all($this is Quantity)');
  });

  it('rewrites a bare path `is`', () => {
    expect(rewriteCollectionTypeOperators('value is Quantity'))
      .toBe('value.all($this is Quantity)');
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
