// Syntax only: accepting an SCG expression proves neither concept membership
// nor semantic validity. The normative ABNF is owned by SNOMED International:
// https://docs.snomed.org/snomed-ct-specifications/snomed-ct-compositional-grammar-specification/design/5-syntax-specification
export const SNOMED_EXPRESSION_SYNTAX_LIMITS = Object.freeze({
  maxInputLength: 65_536,
  maxNestingDepth: 64,
});

export type SnomedExpressionSyntaxResult =
  | { kind: 'named-id'; conceptId: string }
  | { kind: 'expression' }
  | { kind: 'invalid'; offset: number; expected: string }
  | {
    kind: 'unverified';
    reason: 'input-length-limit' | 'nesting-depth-limit';
    offset: number;
    limit: number;
  };

type SyntaxFailure = Extract<SnomedExpressionSyntaxResult, { kind: 'invalid' | 'unverified' }>;
type ParserState = { input: string; offset: number; failure?: SyntaxFailure };

export function classifySnomedExpressionSyntax(input: string): SnomedExpressionSyntaxResult {
  const { maxInputLength } = SNOMED_EXPRESSION_SYNTAX_LIMITS;
  if (input.length > maxInputLength) {
    return { kind: 'unverified', reason: 'input-length-limit', offset: maxInputLength, limit: maxInputLength };
  }
  const unicodeOffset = malformedUnicodeOffset(input);
  if (unicodeOffset !== undefined) {
    return { kind: 'invalid', offset: unicodeOffset, expected: 'Unicode scalar value' };
  }
  const state: ParserState = { input, offset: 0 };
  skipWhitespace(state);
  if (input.startsWith('===', state.offset) || input.startsWith('<<<', state.offset)) {
    state.offset += 3;
    skipWhitespace(state);
  }
  if (!parseSubExpression(state, 0)) return syntaxFailure(state);
  skipWhitespace(state);
  if (state.offset !== input.length) {
    return { kind: 'invalid', offset: state.offset, expected: 'end of expression' };
  }
  return isBareConceptId(input)
    ? { kind: 'named-id', conceptId: input }
    : { kind: 'expression' };
}

function syntaxFailure(state: ParserState): SyntaxFailure {
  return state.failure ?? { kind: 'invalid', offset: state.offset, expected: 'SNOMED CT expression' };
}

function invalid(state: ParserState, expected: string): false {
  state.failure ??= { kind: 'invalid', offset: state.offset, expected };
  return false;
}

function expectCharacter(state: ParserState, character: string): boolean {
  if (state.input[state.offset] !== character) return invalid(state, character);
  state.offset++;
  return true;
}

function isDigit(input: string, offset: number): boolean {
  const character = input.charCodeAt(offset);
  return character >= 0x30 && character <= 0x39;
}

function isBareConceptId(input: string): boolean {
  if (input.length < 6 || input.length > 18) return false;
  for (let offset = 0; offset < input.length; offset++) {
    if (!isDigit(input, offset)) return false;
  }
  return input[0] !== '0';
}

function skipWhitespace(state: ParserState): void {
  while (state.offset < state.input.length) {
    const character = state.input.charCodeAt(state.offset);
    if (character !== 0x20 && character !== 0x09 && character !== 0x0d && character !== 0x0a) return;
    state.offset++;
  }
}

function malformedUnicodeOffset(input: string): number | undefined {
  for (let offset = 0; offset < input.length; offset++) {
    const character = input.charCodeAt(offset);
    if (character >= 0xd800 && character <= 0xdbff) {
      const next = input.charCodeAt(offset + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return offset;
      offset++;
    } else if (character >= 0xdc00 && character <= 0xdfff) {
      return offset;
    }
  }
  return undefined;
}

function parseSubExpression(state: ParserState, depth: number): boolean {
  if (!parseConceptReference(state)) return false;
  skipWhitespace(state);
  while (state.input[state.offset] === '+') {
    state.offset++;
    skipWhitespace(state);
    if (!parseConceptReference(state)) return false;
    skipWhitespace(state);
  }
  if (state.input[state.offset] !== ':') return true;
  state.offset++;
  skipWhitespace(state);
  return parseRefinement(state, depth);
}

function parseConceptReference(state: ParserState): boolean {
  const start = state.offset;
  if (!isDigit(state.input, start) || state.input[start] === '0') {
    return invalid(state, '6–18 digit concept identifier with a nonzero first digit');
  }
  while (isDigit(state.input, state.offset)) state.offset++;
  if (state.offset - start < 6 || state.offset - start > 18) {
    return invalid(state, '6–18 digit concept identifier');
  }
  skipWhitespace(state);
  if (state.input[state.offset] !== '|') return true;
  state.offset++;
  skipWhitespace(state);
  return parseTerm(state);
}

function isTermCharacter(input: string, offset: number): boolean {
  const character = input.codePointAt(offset) ?? -1;
  return (character >= 0x21 && character <= 0x7b)
    || (character >= 0x7d && character <= 0x7e) || character >= 0x80;
}

function advanceScalar(state: ParserState): void {
  state.offset += (state.input.codePointAt(state.offset) ?? 0) > 0xffff ? 2 : 1;
}

function parseTerm(state: ParserState): boolean {
  if (!isTermCharacter(state.input, state.offset)) return invalid(state, 'nonempty concept term');
  do {
    advanceScalar(state);
    while (state.input[state.offset] === ' ') state.offset++;
  } while (isTermCharacter(state.input, state.offset));
  // Internal term spacing is SP only; HTAB/CR/LF may appear at its edges.
  skipWhitespace(state);
  return expectCharacter(state, '|');
}

function parseRefinement(state: ParserState, depth: number): boolean {
  if (state.input[state.offset] === '{') {
    if (!parseAttributeGroup(state, depth)) return false;
  } else if (!parseAttributeSet(state, depth)) return false;
  skipWhitespace(state);
  while (state.input[state.offset] === ',' || state.input[state.offset] === '{') {
    if (state.input[state.offset] === ',') {
      state.offset++;
      skipWhitespace(state);
    }
    if (!parseAttributeGroup(state, depth)) return false;
    skipWhitespace(state);
  }
  return true;
}

function parseAttributeGroup(state: ParserState, depth: number): boolean {
  if (!expectCharacter(state, '{')) return false;
  skipWhitespace(state);
  if (!parseAttributeSet(state, depth)) return false;
  skipWhitespace(state);
  return expectCharacter(state, '}');
}

function parseAttributeSet(state: ParserState, depth: number): boolean {
  if (!parseAttribute(state, depth)) return false;
  skipWhitespace(state);
  while (state.input[state.offset] === ',') {
    const separator = state.offset++;
    skipWhitespace(state);
    // A comma before a group belongs to refinement, not to attributeSet.
    if (state.input[state.offset] === '{') {
      state.offset = separator;
      return true;
    }
    if (!parseAttribute(state, depth)) return false;
    skipWhitespace(state);
  }
  return true;
}

function parseAttribute(state: ParserState, depth: number): boolean {
  if (!parseConceptReference(state) || !expectCharacter(state, '=')) return false;
  skipWhitespace(state);
  return parseAttributeValue(state, depth);
}

function parseAttributeValue(state: ParserState, depth: number): boolean {
  const character = state.input[state.offset];
  if (character === '(') {
    const { maxNestingDepth } = SNOMED_EXPRESSION_SYNTAX_LIMITS;
    if (depth >= maxNestingDepth) {
      state.failure = { kind: 'unverified', reason: 'nesting-depth-limit', offset: state.offset, limit: maxNestingDepth };
      return false;
    }
    state.offset++;
    skipWhitespace(state);
    if (!parseSubExpression(state, depth + 1)) return false;
    skipWhitespace(state);
    return expectCharacter(state, ')');
  }
  if (character === '"') return parseStringValue(state);
  if (character === '#') return parseNumericValue(state);
  if (character === 't' || character === 'T' || character === 'f' || character === 'F') {
    return parseBooleanValue(state);
  }
  return parseConceptReference(state);
}

function parseStringValue(state: ParserState): boolean {
  state.offset++;
  let characters = 0;
  while (state.offset < state.input.length) {
    const character = state.input.charCodeAt(state.offset);
    if (character === 0x22) {
      if (characters === 0) return invalid(state, 'nonempty concrete string');
      state.offset++;
      return true;
    }
    if (character === 0x5c) {
      const escaped = state.input.charCodeAt(state.offset + 1);
      if (escaped !== 0x22 && escaped !== 0x5c) return invalid(state, 'escaped quotation mark or backslash');
      state.offset += 2;
    } else if (character === 0x09 || character === 0x0d || character === 0x0a
      || (character >= 0x20 && character <= 0x21)
      || (character >= 0x23 && character <= 0x5b)
      || (character >= 0x5d && character <= 0x7e) || character >= 0x80) {
      advanceScalar(state);
    } else {
      return invalid(state, 'SCG concrete string character');
    }
    characters++;
  }
  return invalid(state, 'closing quotation mark');
}

function parseNumericValue(state: ParserState): boolean {
  state.offset++;
  if (state.input[state.offset] === '-' || state.input[state.offset] === '+') state.offset++;
  if (!isDigit(state.input, state.offset)) return invalid(state, 'integer or decimal concrete value');
  if (state.input[state.offset] === '0') state.offset++;
  else while (isDigit(state.input, state.offset)) state.offset++;
  if (state.input[state.offset] !== '.') return true;
  state.offset++;
  if (!isDigit(state.input, state.offset)) return invalid(state, 'digit after decimal point');
  while (isDigit(state.input, state.offset)) state.offset++;
  return true;
}

function parseBooleanValue(state: ParserState): boolean {
  for (const literal of ['true', 'false']) {
    if (state.input.slice(state.offset, state.offset + literal.length).toLowerCase() === literal) {
      state.offset += literal.length;
      return true;
    }
  }
  return invalid(state, 'true or false concrete value');
}
