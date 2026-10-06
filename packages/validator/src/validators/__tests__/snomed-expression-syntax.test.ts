import { describe, expect, it } from 'vitest';
import {
  classifySnomedExpressionSyntax,
  SNOMED_EXPRESSION_SYNTAX_LIMITS,
} from '../snomed-expression-syntax';

describe('SNOMED Compositional Grammar syntax', () => {
  it.each(['100005', '161511005', '123456789012345678'])(
    'classifies bare %s as a named identifier without claiming membership or checksum validity', input => {
      expect(classifySnomedExpressionSyntax(input)).toEqual({ kind: 'named-id', conceptId: input });
    },
  );

  it.each([
    ['expression whitespace', ' \t\r\n123456\n\r\t '],
    ['equivalent definition', '===123456'],
    ['subtype definition', '<<< 123456'],
    ['focus conjunction', '123456+234567+345678'],
    ['concept labels', '123456 | Clinical  term | + 234567 | 肺炎 😀 |'],
    ['label edge whitespace', '123456|\t\r\nClinical term\t\r\n|'],
    ['non-ASCII label whitespace', '123456|a\u00a0b\u2028c|'],
    ['label Unicode scalar endpoints', '123456|\u0080\u{10ffff}|'],
    ['label punctuation', '123456|"\\:{}()=#+-<>|'],
    ['ungrouped attributes', '123456:234567=345678,456789=567890'],
    ['named attribute label', '123456:234567|Attribute|=345678|Value|'],
    ['one group', '123456:{234567=345678}'],
    ['groups without comma', '123456:{234567=345678}{456789=567890}'],
    ['groups with comma', '123456:{234567=345678},{456789=567890}'],
    ['ungrouped then groups', '123456:234567=345678,456789=567890,{678901=789012}{890123=901234}'],
    ['ungrouped then group without comma', '123456:234567=345678{456789=567890}'],
    ['nested conjunction', '123456:234567=(345678+456789)'],
    ['nested refinement', '123456:234567=(345678:{456789=(567890:678901=789012)})'],
    ['nested whitespace', '123456 : { 234567 = ( \t345678\n ) }'],
    ['positive integer', '123456:234567=#123'],
    ['signed integers', '123456:234567=#+0,345678=#-0,456789=#-23'],
    ['signed decimals', '123456:234567=#+0.050,345678=#-23.4'],
    ['unbounded numeric magnitude within input budget', '123456:234567=#123456789012345678901234567890.1234567890'],
    ['boolean case combinations', '123456:234567=tRuE,345678=FaLsE'],
    ['concrete Unicode string', '123456:234567="Schmerz 肺炎 😀\u{10ffff}"'],
    ['literal concrete whitespace', '123456:234567=" \t\r\n "'],
    ['escaped quote and backslash', String.raw`123456:234567="quoted \"word\" and \\ slash"`],
  ])('P: accepts %s without a membership or semantic result', (_label, input) => {
    expect(classifySnomedExpressionSyntax(input)).toEqual({ kind: 'expression' });
  });

  it.each([
    ['empty input', ''],
    ['whitespace only', ' \t\r\n'],
    ['identifier shorter than six digits', '10000'],
    ['identifier longer than eighteen digits', '1234567890123456789'],
    ['zero initial digit', '0123456'],
    ['alphabetic identifier suffix', '276885007x'],
    ['non-ASCII identifier digits', '１２３４５６'],
    ['internal identifier whitespace', '123 456'],
    ['trailing tokens', '123456 234567'],
    ['non-grammar exterior whitespace', '\u00a0123456'],
    ['vertical tab exterior whitespace', '123456\u000b'],
    ['form feed exterior whitespace', '123456\u000c'],
    ['bad definition status', '==123456'],
    ['repeated definition status', '===<<<123456'],
    ['bare parentheses', '(123456)'],
    ['missing next focus', '123456+'],
    ['extra focus plus', '123456++234567'],
    ['empty label', '123456||'],
    ['whitespace-only label', '123456| \t\r\n |'],
    ['unclosed label', '123456|term'],
    ['internal label tab', '123456|first\tsecond|'],
    ['internal label CR', '123456|first\rsecond|'],
    ['internal label LF', '123456|first\nsecond|'],
    ['label ASCII control', '123456|a\u0000b|'],
    ['label DEL', '123456|a\u007fb|'],
    ['empty refinement', '123456:'],
    ['empty group', '123456:{}'],
    ['attribute without value', '123456:234567='],
    ['attribute without equals', '123456:234567 345678'],
    ['missing attribute comma', '123456:234567=345678 456789=567890'],
    ['attribute-set trailing comma', '123456:234567=345678,'],
    ['group trailing comma', '123456:{234567=345678,}'],
    ['refinement double comma', '123456:234567=345678,,{456789=567890}'],
    ['group followed by ungrouped attribute', '123456:{234567=345678},456789=567890'],
    ['nested group in group', '123456:{{234567=345678}}'],
    ['unclosed group', '123456:{234567=345678'],
    ['unclosed expression value', '123456:234567=(345678'],
    ['empty expression value', '123456:234567=()'],
    ['definition status in subexpression', '123456:234567=(===345678)'],
    ['unparenthesized conjunction value', '123456:234567=345678+456789'],
    ['unparenthesized refined value', '123456:234567=345678:456789=567890'],
    ['number without hash', '123456:234567=-1'],
    ['number without integer', '123456:234567=#.5'],
    ['number without digits', '123456:234567=#-'],
    ['leading integer zero', '123456:234567=#01'],
    ['leading decimal zero', '123456:234567=#00.5'],
    ['decimal without fraction', '123456:234567=#1.'],
    ['numeric exponent', '123456:234567=#1e3'],
    ['numeric embedded whitespace', '123456:234567=#- 1'],
    ['boolean suffix', '123456:234567=trueish'],
    ['Boolean alternative spelling', '123456:234567=yes'],
    ['empty concrete string', '123456:234567=""'],
    ['unclosed concrete string', '123456:234567="term'],
    ['escape n', String.raw`123456:234567="a\nb"`],
    ['escape t', String.raw`123456:234567="a\tb"`],
    ['escape u', String.raw`123456:234567="a\u0041b"`],
    ['string ASCII control', '123456:234567="a\u0000b"'],
    ['string DEL', '123456:234567="a\u007fb"'],
    ['unpaired high surrogate', '123456|\ud800|'],
    ['unpaired low surrogate', '123456:234567="\udc00"'],
    ['high surrogate followed by ASCII', '123456|\ud800a|'],
    ['reversed surrogate pair', '123456|\udc00\ud800|'],
  ])('N: rejects %s by syntax only', (_label, input) => {
    expect(classifySnomedExpressionSyntax(input)).toMatchObject({
      kind: 'invalid', offset: expect.any(Number), expected: expect.any(String),
    });
  });

  it('consumes the complete input and reports the first remaining token', () => {
    expect(classifySnomedExpressionSyntax('123456x')).toEqual({
      kind: 'invalid', offset: 6, expected: 'end of expression',
    });
  });

  it('accepts an expression exactly at the input budget', () => {
    const input = `123456|${'x'.repeat(SNOMED_EXPRESSION_SYNTAX_LIMITS.maxInputLength - 8)}|`;
    expect(classifySnomedExpressionSyntax(input)).toEqual({ kind: 'expression' });
  });

  it('U: leaves input beyond the length budget unverified, including a malformed suffix', () => {
    const limit = SNOMED_EXPRESSION_SYNTAX_LIMITS.maxInputLength;
    const input = `123456|${'x'.repeat(limit - 8)}|`;
    for (const suffix of ['x', '\ud800']) {
      expect(classifySnomedExpressionSyntax(input + suffix)).toEqual({
        kind: 'unverified', reason: 'input-length-limit', offset: limit, limit,
      });
    }
  });

  it('accepts exactly the bounded expression nesting depth', () => {
    expect(classifySnomedExpressionSyntax(nestedExpression(SNOMED_EXPRESSION_SYNTAX_LIMITS.maxNestingDepth)))
      .toEqual({ kind: 'expression' });
  });

  it('U: leaves greater nesting unverified without declaring the remaining syntax invalid', () => {
    const limit = SNOMED_EXPRESSION_SYNTAX_LIMITS.maxNestingDepth;
    const input = nestedExpression(limit + 1);
    for (const suffix of ['', 'x']) {
      expect(classifySnomedExpressionSyntax(input + suffix)).toMatchObject({
        kind: 'unverified', reason: 'nesting-depth-limit', limit,
      });
    }
  });

  it('retains a proven syntax error before entering nested expression values', () => {
    expect(classifySnomedExpressionSyntax(`?${nestedExpression(65)}`)).toMatchObject({ kind: 'invalid', offset: 0 });
  });
});

function nestedExpression(depth: number): string {
  return '123456:234567=('.repeat(depth) + '345678' + ')'.repeat(depth);
}
