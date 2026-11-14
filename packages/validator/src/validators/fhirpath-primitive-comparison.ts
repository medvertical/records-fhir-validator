import fhirpath from 'fhirpath';

interface AstNode { type?: string; text?: string; start?: { line: number; column: number }; length?: number; children?: AstNode[] }
type Span = { start: number; end: number };
const primitiveTypes = new Set(['boolean', 'string', 'uri', 'url', 'canonical', 'code', 'oid', 'id', 'uuid',
  'markdown', 'base64Binary', 'integer', 'unsignedInt', 'positiveInt', 'integer64', 'decimal', 'date', 'dateTime', 'instant', 'time']);

/** FHIR primitives compare their system values; sibling metadata remains navigable elsewhere. */
export function comparisonValues(inputs: readonly unknown[]): unknown[] {
  return inputs.flatMap(value => {
    if (!value || typeof value !== 'object') return [value];
    const typeInfo = Reflect.get(value, 'getTypeInfo'), convert = Reflect.get(value, 'convertData');
    if (typeof typeInfo !== 'function' || typeof convert !== 'function') return [value];
    const type: unknown = Reflect.apply(typeInfo, value, []);
    if (!type || typeof type !== 'object' || Reflect.get(type, 'namespace') !== 'FHIR'
      || !primitiveTypes.has(String(Reflect.get(type, 'name')))) return [value];
    const scalar: unknown = Reflect.apply(convert, value, []);
    return scalar === null || scalar === undefined ? [] : [scalar];
  });
}

/** Use parser locations rather than rewriting equality-looking text inside literals or comments. */
export function rewritePrimitiveComparisons(expression: string): string {
  if (!expression.includes('=')) return expression;
  const offsets = [0];for (let i = 0; i < expression.length; i++) if (expression[i] === '\n') offsets.push(i + 1);
  const ast: unknown = fhirpath.parse(expression);
  const parentheses = parenthesisPairs(expression);
  const edits = new Map<number, string[]>();
  const insert = (at: number, text: string) => edits.set(at, [...edits.get(at) ?? [], text]);
  const bounds = (node: AstNode, depth = 0): Span | undefined => {
    if (depth > 200) throw new Error('FHIRPath comparison exceeded depth limit');
    const spans = (node.children ?? []).flatMap(child => { const span = bounds(child, depth + 1);return span ? [span] : []; });
    if (node.start && typeof node.length === 'number') {
      const start = offsets[node.start.line - 1] + node.start.column - 1;
      if (Number.isSafeInteger(start) && start >= 0 && start + node.length <= expression.length) spans.push({ start, end: start + node.length });
    }
    if (!spans.length) return undefined;
    const span = { start: Math.min(...spans.map(value => value.start)), end: Math.max(...spans.map(value => value.end)) };
    if (node.type === 'FunctionInvocation' && node.start && typeof node.length === 'number') {
      const nameEnd = offsets[node.start.line - 1] + node.start.column - 1 + node.length;
      const pair = parentheses.find(pair => pair.start >= nameEnd);
      if (!pair) throw new Error('Cannot locate FHIRPath function parentheses');
      span.end = pair.end + 1;
    } else if (node.type === 'ParenthesizedTerm') {
      const pair = parentheses.filter(pair => pair.start < span.start && pair.end >= span.end).at(-1);
      if (!pair) throw new Error('Cannot locate FHIRPath grouping parentheses');
      span.start = pair.start;span.end = pair.end + 1;
    }
    return span;
  };
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 200) throw new Error('FHIRPath comparison exceeded depth limit');
    if (!value || typeof value !== 'object') return;
    const node = value as AstNode;
    if (node.type === 'EqualityExpression' && (node.text === '=' || node.text === '!=')) {
      for (const child of node.children ?? []) {
        const span = bounds(child);
        if (!span) throw new Error('Cannot locate a FHIRPath comparison operand');
        insert(span.start, '(');insert(span.end, ').recordsComparisonValue()');
      }
    }
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  visit(ast);
  let output = expression;
  for (const at of [...edits.keys()].sort((a, b) => b - a)) output = output.slice(0, at) + edits.get(at)!.join('') + output.slice(at);
  return output;
}

function parenthesisPairs(source: string): Span[] {
  const stack: number[] = [], pairs: Span[] = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "'" || char === '`') {
      const quote = char;
      while (++i < source.length) {
        if (source[i] === '\\') i++;
        else if (source[i] === quote) break;
      }
    } else if (source.startsWith('//', i)) {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);i = end < 0 ? source.length : end + 1;
    } else if (char === '(') stack.push(i);
    else if (char === ')') {
      const start = stack.pop();if (start !== undefined) pairs.push({ start, end: i });
    }
  }
  return pairs.sort((a, b) => a.start - b.start);
}
