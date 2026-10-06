/**
 * Where XHTML elements may stand, as the reference validator (6.10's
 * XhtmlValidator) checks it: a list item belongs in a list, a row in a table,
 * a paragraph holds no blocks. CQF Measures' narratives put `<li>` straight
 * into table cells.
 */

interface XhtmlElement {
  name: string;
  children: XhtmlElement[];
  text: boolean;
}

const PARAGRAPHS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'address', 'span', 'caption', 'dd', 'dt']);
const PHRASES = new Set(['a', 'b', 'em', 'i', 'strong', 'small', 'big', 'sub', 'sup', 'code', 'tt', 'dfn', 'q', 'var',
  'abbr', 'acronym', 'cite', 'bdo', 'kbd', 'samp']);
const EMPTY = new Set(['br', 'img', 'hr', 'area']);
const BLOCKS = new Set(['div', 'pre', 'table', 'ul', 'ol']);
const PARENTS: Record<string, string[]> = {
  tr: ['table', 'thead', 'tfoot', 'tbody'], tbody: ['table'], thead: ['table'], tfoot: ['table'], caption: ['table'],
  colgroup: ['table'], col: ['colgroup', 'table'], th: ['tr', 'thead', 'tfoot'], td: ['tr', 'thead', 'tfoot'],
  li: ['ul', 'ol'], dd: ['dl'], dt: ['dl'],
};
const CHILDREN: Record<string, string[]> = {
  table: ['tbody', 'tr', 'caption', 'thead', 'tfoot', 'col', 'colgroup'], tr: ['td', 'th'], tbody: ['tr'], thead: ['tr'],
  tfoot: ['tr'], ul: ['li'], ol: ['li'], dl: ['dd', 'dt'], map: ['area'],
};

/** The reference validator's messages for each misplaced element of a well-formed narrative div. */
export function findXhtmlNestingViolations(div: string): string[] {
  const root = parseXhtmlTree(div);
  return root ? checkChildren(root, 'div') : [];
}

function checkChildren(parent: XhtmlElement, path: string): string[] {
  return parent.children.flatMap(element => {
    const elementPath = `${path}/${element.name}`;
    const found: string[] = [];
    if (PARAGRAPHS.has(element.name) || PHRASES.has(element.name)) {
      const blocks = descendants(element, element.name, BLOCKS);
      if (blocks.length > 0) found.push(`Found block structures inside a paragraph/text element ${element.name} at ${elementPath}: ${blocks.join(',')}`);
    }
    if (PHRASES.has(element.name)) {
      const nested = descendants(element, element.name, new Set([element.name]));
      if (nested.length > 0) found.push(`Elements of type ${element.name} at ${elementPath} cannot contain nested ${element.name} at ${nested.join(',')}`);
    }
    if (EMPTY.has(element.name) && (element.children.length > 0 || element.text)) {
      found.push(`Elements of type ${element.name} cannot have children`);
    }
    const parents = PARENTS[element.name];
    if (parents && !parents.includes(parent.name)) {
      found.push(`Elements of type ${element.name} must be in a ${parents.join('|')}, not a ${parent.name} at ${elementPath}`);
    }
    const allowed = CHILDREN[element.name];
    const illegal = allowed
      ? [...(element.text ? ['@text'] : []), ...element.children.map(child => child.name).filter(name => !allowed.includes(name))]
      : [];
    if (illegal.length > 0) found.push(`Elements of type ${element.name} at ${elementPath} cannot have the following children: ${illegal.join(',')}`);
    return [...found, ...checkChildren(element, elementPath)];
  });
}

function descendants(element: XhtmlElement, path: string, names: ReadonlySet<string>): string[] {
  return element.children.flatMap(child => {
    const childPath = `${path}/${child.name}`;
    return [...(names.has(child.name) ? [childPath] : []), ...descendants(child, childPath, names)];
  });
}

function parseXhtmlTree(div: string): XhtmlElement | null {
  const scannable = div.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[?!][^>]*>/g, '');
  const top: XhtmlElement = { name: '', children: [], text: false };
  const open = [top];
  for (const [, closing, name, , selfClosing, text] of scannable.matchAll(/<(\/?)(?:[\w-]+:)?([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    const current = open[open.length - 1];
    if (text !== undefined) {
      if (hasContent(text)) current.text = true;
    } else if (closing) {
      if (open.length > 1) open.pop();
    } else {
      const element: XhtmlElement = { name, children: [], text: false };
      current.children.push(element);
      if (!selfClosing) open.push(element);
    }
  }
  return top.children[0] ?? null;
}

/** Text beyond XML whitespace, character references decoded: US Core indents its lists with `&#9;`. */
function hasContent(text: string): boolean {
  const decoded = text.replace(/&#(x[0-9a-fA-F]+|\d+);/g, (_, code: string) => {
    const point = code.startsWith('x') ? parseInt(code.slice(1), 16) : Number(code);
    return point <= 0x10FFFF ? String.fromCodePoint(point) : '?';
  });
  return /[^ \t\r\n]/.test(decoded);
}
