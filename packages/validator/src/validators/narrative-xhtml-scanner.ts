// The reference validator's lists (XhtmlValidator in 6.10.0): the HTML 4.0
// formatting elements narrative may use, without the deprecated ones (u, s,
// strike) and the change marks of section 9.4 (ins, del). XHTML names are
// case-sensitive.
const ALLOWED_ELEMENTS = new Set([
  'p', 'br', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span', 'b', 'em', 'i', 'strong',
  'small', 'big', 'tt', 'dfn', 'q', 'var', 'abbr', 'acronym', 'cite', 'blockquote', 'hr', 'address', 'bdo',
  'kbd', 'sub', 'sup', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'pre', 'table', 'caption', 'colgroup', 'col',
  'thead', 'tr', 'tfoot', 'tbody', 'th', 'td', 'code', 'samp', 'img', 'map', 'area',
]);

const GLOBAL_ATTRIBUTES = new Set([
  'title', 'style', 'class', 'id', 'lang', 'xml:lang', 'dir', 'accesskey', 'tabindex',
  'span', 'width', 'align', 'valign', 'char', 'charoff', 'abbr', 'axis', 'headers', 'scope', 'rowspan', 'colspan',
  // Only a hint there, not a finding.
  'xml:space',
]);

const ELEMENT_ATTRIBUTES = new Set([
  'a.href', 'a.name', 'a.charset', 'a.type', 'a.hreflang', 'a.rel', 'a.rev', 'a.shape', 'a.coords',
  'img.src', 'img.border', 'img.alt', 'img.longdesc', 'img.height', 'img.width', 'img.usemap', 'img.ismap',
  'div.xmlns', 'blockquote.cite', 'q.cite', 'map.name',
  'area.shape', 'area.coords', 'area.href', 'area.nohref', 'area.alt',
  'table.summary', 'table.width', 'table.border', 'table.frame', 'table.rules', 'table.cellspacing',
  'table.cellpadding', 'pre.space', 'td.nowrap',
]);

const FORBIDDEN_PATTERNS = [/<script[\s>]/i, /javascript:/i];

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

    // XHTML is XML: an empty element such as <br> must close itself.
    const openTags: string[] = [];
    const tagRegex = /<\/?((?:[a-zA-Z][a-zA-Z0-9]*:)?[a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(scannable)) !== null) {
      const fullMatch = match[0];
      const tagName = match[1];
      if (fullMatch.endsWith('/>')) continue;
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
    const tagName = match[2];
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
    const tagName = match[2];
    for (const attribute of parseTagAttributeNames(match[3])) {
      if (attribute.startsWith('xmlns') || GLOBAL_ATTRIBUTES.has(attribute)) continue;
      if (!ELEMENT_ATTRIBUTES.has(`${tagName}.${attribute}`)) invalid.push({ element: tagName, attribute });
    }
  }
  return invalid;
}

/**
 * Ids and `<a name>` anchors that more than one node below the root carries,
 * with how often, in the reference validator's order (checkForDuplicateIds):
 * ids and anchor names share one namespace, and an anchor naming its own
 * element's id counts once.
 */
export function findDuplicateNarrativeIds(div: string): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  const count = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  const tags = withoutCommentsAndCdata(div)
    .matchAll(/<(?:[a-zA-Z][a-zA-Z0-9]*:)?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g);
  let isRoot = true;
  for (const [, tagName, attributeText] of tags) {
    if (isRoot) {
      isRoot = false;
      continue;
    }
    const attributes = new Map(parseTagAttributes(attributeText));
    const rawId = attributes.get('id');
    const id = rawId === undefined ? undefined : decodeXhtmlEntities(rawId);
    if (id !== undefined) count(id);
    const rawName = tagName === 'a' ? attributes.get('name') : undefined;
    const name = rawName === undefined ? undefined : decodeXhtmlEntities(rawName);
    if (name !== undefined && name !== id) count(name);
  }
  return [...counts.keys()]
    .filter(id => (counts.get(id) ?? 0) > 1)
    .sort()
    .map(id => ({ id, count: counts.get(id) ?? 0 }));
}

const URL_PUNCTUATION = new Set([...";?:@&=+$.,/%-_~#[]!'()*|"]);

/**
 * `<a href>` and `<img src>` values the reference validator rejects
 * (UrlUtil.checkValidUrl): empty, or with a character that is no letter,
 * digit or URL punctuation — a space, `"`, `<`, `{`. A `data:` URL answers to
 * its own rules instead.
 */
export function findInvalidNarrativeUrls(div: string): Array<{ url: string; invalid: string[] }> {
  const findings: Array<{ url: string; invalid: string[] }> = [];
  const tags = withoutCommentsAndCdata(div)
    .matchAll(/<(?:[a-zA-Z][a-zA-Z0-9]*:)?(a|img)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g);
  for (const [, tagName, attributeText] of tags) {
    const raw = new Map(parseTagAttributes(attributeText)).get(tagName === 'a' ? 'href' : 'src');
    if (raw === undefined) continue;
    const url = decodeXhtmlEntities(raw);
    if (url.startsWith('data:')) continue;
    const invalid = [...url].filter(ch => !/[\p{L}\p{Nl}\p{Nd}]/u.test(ch) && !URL_PUNCTUATION.has(ch));
    if (url.length === 0 || invalid.length > 0) findings.push({ url, invalid });
  }
  return findings;
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

/** The named references XML itself defines; FHIR parses narrative XHTML as XML, without the XHTML DTD. */
const XML_ENTITY_NAMES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

/** HTML named entities (`&trade;`) no XML parser without the DTD resolves, as the reference validator reports them. */
export function findIllegalXhtmlEntities(xhtml: string): string[] {
  const names = [...withoutCommentsAndCdata(xhtml).matchAll(/&([a-zA-Z][a-zA-Z0-9]*);/g)]
    .map(match => match[1])
    .filter(name => !XML_ENTITY_NAMES.has(name));
  return [...new Set(names)].map(name => `&${name};`);
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
  return parseTagAttributes(value).map(([name]) => name);
}

function parseTagAttributes(value: string): Array<[name: string, value: string | undefined]> {
  const attributes: Array<[string, string | undefined]> = [];
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
    const name = value.slice(nameStart, index);
    index = skipWhitespace(value, index);
    if (value[index] !== '=') {
      attributes.push([name, undefined]);
      continue;
    }
    index = skipWhitespace(value, index + 1);
    const quote = value[index];
    if (quote === '"' || quote === "'") {
      const valueStart = index + 1;
      index = valueStart;
      while (index < value.length && value[index] !== quote) index += 1;
      attributes.push([name, value.slice(valueStart, index)]);
      if (index < value.length) index += 1;
    } else {
      const valueStart = index;
      while (
        index < value.length
        && !isWhitespace(value[index])
        && value[index] !== '/'
        && value[index] !== '>'
      ) index += 1;
      attributes.push([name, value.slice(valueStart, index)]);
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
