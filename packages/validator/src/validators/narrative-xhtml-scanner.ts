const ALLOWED_ELEMENTS = new Set([
  'div', 'p', 'br', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'b', 'i', 'u', 's', 'strike', 'em', 'strong', 'small', 'big', 'sub', 'sup', 'tt', 'code', 'pre',
  'blockquote', 'q', 'dfn', 'abbr', 'acronym', 'cite', 'samp', 'kbd', 'var', 'ins', 'del',
  'a', 'img', 'hr',
]);

const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  '*': new Set(['id', 'class', 'style', 'title', 'lang', 'xml:lang', 'dir', 'xmlns']),
  a: new Set(['href', 'name', 'rel', 'rev', 'target']),
  img: new Set(['src', 'alt', 'height', 'width', 'longdesc', 'usemap']),
  table: new Set(['border', 'cellpadding', 'cellspacing', 'summary', 'width']),
  th: new Set(['colspan', 'rowspan', 'headers', 'scope', 'abbr', 'axis', 'align', 'valign']),
  td: new Set(['colspan', 'rowspan', 'headers', 'abbr', 'axis', 'align', 'valign']),
  col: new Set(['span', 'width', 'align', 'valign']),
  colgroup: new Set(['span', 'width', 'align', 'valign']),
  ol: new Set(['start', 'type']),
  ul: new Set(['type']),
  li: new Set(['value']),
  blockquote: new Set(['cite']),
  q: new Set(['cite']),
  ins: new Set(['cite', 'datetime']),
  del: new Set(['cite', 'datetime']),
};

const FORBIDDEN_PATTERNS = [/<script[\s>]/i, /javascript:/i];
const VOID_ELEMENTS = new Set([
  'br', 'hr', 'img', 'area', 'base', 'col', 'embed',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

export function findXxeDeclarations(div: string): Array<'doctype' | 'entity'> {
  const scannable = withoutCommentsAndCdata(div);
  return [
    ...(/<!DOCTYPE\b/i.test(scannable) ? ['doctype' as const] : []),
    ...(/<!ENTITY\b/i.test(scannable) ? ['entity' as const] : []),
  ];
}

export function isNarrativeXhtmlWellformed(div: string): boolean {
  try {
    const scannable = withoutCommentsAndCdata(div);
    if (/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#x[0-9a-fA-F]+);)/.test(scannable)) {
      return false;
    }

    const openTags: string[] = [];
    const tagRegex = /<\/?((?:[a-zA-Z][a-zA-Z0-9]*:)?[a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(scannable)) !== null) {
      const fullMatch = match[0];
      const tagName = match[1].toLowerCase();
      const localName = tagName.includes(':') ? tagName.split(':')[1] : tagName;
      if (fullMatch.endsWith('/>') || VOID_ELEMENTS.has(localName)) continue;
      if (fullMatch.startsWith('</')) {
        if (openTags.length === 0 || openTags.pop() !== tagName) return false;
      } else {
        openTags.push(tagName);
      }
    }
    return openTags.length === 0;
  } catch {
    return false;
  }
}

export function hasValidNarrativeRoot(div: string): boolean {
  const trimmed = div.replace(/^<\?xml[^?]*\?>/, '').replace(/^\s+/, '');
  const divMatch = trimmed.match(/^<([a-zA-Z][a-zA-Z0-9]*:)?div\b[^>]*>/);
  if (!divMatch) return false;
  const rootTag = divMatch[0];
  const prefix = divMatch[1];
  if (prefix) {
    const namespacePrefix = prefix.slice(0, -1);
    const namespace = rootTag.match(
      new RegExp(`\\bxmlns:${namespacePrefix}\\s*=\\s*(["'])([^"']*)\\1`),
    );
    return namespace?.[2] === 'http://www.w3.org/1999/xhtml';
  }
  return rootTag.match(/\bxmlns\s*=\s*(["'])([^"']*)\1/)?.[2]
    === 'http://www.w3.org/1999/xhtml';
}

export function findForbiddenNarrativePatterns(div: string): string[] {
  return FORBIDDEN_PATTERNS.filter(pattern => pattern.test(div)).map(pattern => pattern.source);
}

export function findDisallowedNarrativeElements(div: string): string[] {
  const disallowed: string[] = [];
  const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*:)?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(div)) !== null) {
    const tagName = match[2].toLowerCase();
    if (!ALLOWED_ELEMENTS.has(tagName) && !disallowed.includes(tagName)) {
      disallowed.push(tagName);
    }
  }
  return disallowed;
}

export function findInvalidNarrativeAttributes(
  div: string,
): Array<{ element: string; attribute: string }> {
  const invalid: Array<{ element: string; attribute: string }> = [];
  const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*:)?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(div)) !== null) {
    const tagName = match[2].toLowerCase();
    for (const rawName of parseTagAttributeNames(match[3])) {
      const attribute = rawName.toLowerCase();
      if (attribute.startsWith('xmlns')) continue;
      const globalAllowed = ALLOWED_ATTRIBUTES['*'];
      const elementAllowed = ALLOWED_ATTRIBUTES[tagName] || new Set();
      if (!globalAllowed.has(attribute) && !elementAllowed.has(attribute)) {
        invalid.push({ element: tagName, attribute });
      }
    }
  }
  return invalid;
}

const NAMED_ENTITY_DECODINGS: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

export function hasNonWhitespaceNarrativeContent(div: string): boolean {
  const scannable = withoutCommentsAndCdata(div);
  // txt-2 counts images only when they carry a src attribute.
  for (const image of scannable.matchAll(/<(?:[a-zA-Z][a-zA-Z0-9]*:)?img\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    if (parseTagAttributeNames(image[1]).includes('src')) return true;
  }
  const text = decodeXhtmlEntities(scannable.replace(/<[^>]*>/g, ''));
  return hasCharAboveSpace(text);
}

// Java's String.trim() strips only chars <= U+0020, so &nbsp; (U+00A0)
// counts as content. \S must not be used here because JS regexes treat
// U+00A0 as whitespace and would diverge from the reference validator.
function hasCharAboveSpace(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) > 0x20) return true;
  }
  return false;
}

function decodeXhtmlEntities(text: string): string {
  return text.replace(
    /&#x([0-9a-fA-F]+);|&#([0-9]+);|&([a-zA-Z][a-zA-Z0-9]*);/g,
    (_entity, hexCode, decimalCode, name) => {
      if (hexCode || decimalCode) {
        const codePoint = hexCode ? parseInt(hexCode, 16) : parseInt(decimalCode, 10);
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '\ufffd';
      }
      // Unknown named entities decode to the replacement char so they
      // still register as visible content.
      return NAMED_ENTITY_DECODINGS[name] ?? '\ufffd';
    },
  );
}

function withoutCommentsAndCdata(value: string): string {
  return value
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function parseTagAttributeNames(value: string): string[] {
  const attributes: string[] = [];
  let index = 0;
  while (index < value.length) {
    index = skipWhitespace(value, index);
    if (index >= value.length || value[index] === '/' || value[index] === '>') break;
    const nameStart = index;
    while (
      index < value.length
      && !isWhitespace(value[index])
      && !['=', '/', '>'].includes(value[index])
    ) index += 1;
    if (index === nameStart) {
      index += 1;
      continue;
    }
    attributes.push(value.slice(nameStart, index));
    index = skipWhitespace(value, index);
    if (value[index] !== '=') continue;
    index = skipWhitespace(value, index + 1);
    const quote = value[index];
    if (quote === '"' || quote === "'") {
      index += 1;
      while (index < value.length && value[index] !== quote) index += 1;
      if (index < value.length) index += 1;
    } else {
      while (
        index < value.length
        && !isWhitespace(value[index])
        && value[index] !== '/'
        && value[index] !== '>'
      ) index += 1;
    }
  }
  return attributes;
}

function skipWhitespace(value: string, index: number): number {
  while (index < value.length && isWhitespace(value[index])) index += 1;
  return index;
}

function isWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t' || value === '\f';
}
