/**
 * JSON Source Map
 *
 * Builds a lookup table from JSON-Pointer-style paths (e.g. `name/0/given/1`)
 * to line / character positions in the raw JSON source text.
 *
 * This is used by the diagnostic formatter to produce LSP-compatible ranges
 * so FHIR validation issues highlight the exact source location of the
 * offending element in IDE integrations.
 *
 * The implementation is a small single-pass JSON tokeniser. It intentionally
 * avoids third-party dependencies and handles the subset of JSON the FHIR
 * validator is given (objects, arrays, strings, numbers, booleans, null).
 */

export interface SourcePosition {
    /** Zero-based line number */
    line: number;
    /** Zero-based character offset within the line */
    character: number;
}

export interface SourceRange {
    start: SourcePosition;
    end: SourcePosition;
}

export class JsonSourceMap {
    private readonly ranges: Map<string, SourceRange> = new Map();

    set(path: string, range: SourceRange): void {
        this.ranges.set(path, range);
    }

    /**
     * Resolve a JSON path (slash-separated, e.g. `name/0/given/1`) to its
     * source range. Returns `undefined` if the path is not present.
     *
     * Falls back to the closest ancestor range when an exact match is not
     * found — this makes LSP ranges still point to a useful region when the
     * validator reports on a synthetic sub-path (e.g. a computed constraint).
     */
    lookup(path: string): SourceRange | undefined {
        const normalised = path.replace(/^\/+|\/+$/g, '');
        if (this.ranges.has(normalised)) {
            return this.ranges.get(normalised);
        }

        // Walk up ancestors until we hit a known range
        let current = normalised;
        while (current.length > 0) {
            const lastSlash = current.lastIndexOf('/');
            if (lastSlash < 0) {
                current = '';
                break;
            }
            current = current.slice(0, lastSlash);
            if (this.ranges.has(current)) {
                return this.ranges.get(current);
            }
        }

        // Finally, try the document root
        return this.ranges.get('');
    }

    /** Number of mapped paths (mainly for tests and diagnostics). */
    get size(): number {
        return this.ranges.size;
    }
}

/**
 * Build a `JsonSourceMap` from a raw JSON source string.
 *
 * The returned map covers every object property and array element in the
 * document. Paths use slash separators; array indices are numeric, e.g.
 * `name/0/given/1`. The document root is mapped to the empty string key.
 *
 * Malformed input produces a best-effort map (partial coverage) instead of
 * throwing so the caller can still emit LSP diagnostics with line-0 ranges
 * for unresolved paths.
 */
export function buildJsonSourceMap(source: string): JsonSourceMap {
    const map = new JsonSourceMap();
    if (!source) return map;

    const parser = new JsonTokeniser(source);
    try {
        parser.skipWhitespace();
        const startIdx = parser.index;
        parser.parseValue('', map);
        const endIdx = parser.index;
        map.set('', {
            start: parser.positionAt(startIdx),
            end: parser.positionAt(endIdx),
        });
    } catch {
        // Best-effort: return whatever was captured before the parse failed
    }

    return map;
}

// ============================================================================
// Internal Tokeniser
// ============================================================================

class JsonTokeniser {
    public index = 0;
    private readonly source: string;
    private readonly lineStarts: number[];

    constructor(source: string) {
        this.source = source;
        this.lineStarts = computeLineStarts(source);
    }

    positionAt(offset: number): SourcePosition {
        // Binary search for the line containing offset
        let lo = 0;
        let hi = this.lineStarts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >>> 1;
            if (this.lineStarts[mid] <= offset) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return {
            line: lo,
            character: offset - this.lineStarts[lo],
        };
    }

    skipWhitespace(): void {
        while (this.index < this.source.length) {
            const ch = this.source.charCodeAt(this.index);
            if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
                this.index++;
            } else {
                break;
            }
        }
    }

    expect(char: string): void {
        if (this.source[this.index] !== char) {
            throw new Error(`Expected ${char} at ${this.index}`);
        }
        this.index++;
    }

    parseValue(path: string, map: JsonSourceMap): void {
        this.skipWhitespace();
        const ch = this.source[this.index];
        if (ch === '{') {
            this.parseObject(path, map);
        } else if (ch === '[') {
            this.parseArray(path, map);
        } else if (ch === '"') {
            this.parseString();
        } else if (ch === 't' || ch === 'f') {
            this.parseKeyword(ch === 't' ? 'true' : 'false');
        } else if (ch === 'n') {
            this.parseKeyword('null');
        } else {
            this.parseNumber();
        }
    }

    private parseObject(path: string, map: JsonSourceMap): void {
        this.expect('{');
        this.skipWhitespace();
        if (this.source[this.index] === '}') {
            this.index++;
            return;
        }
        for (;;) {
            this.skipWhitespace();
            const key = this.parseString();
            this.skipWhitespace();
            this.expect(':');
            this.skipWhitespace();

            const childPath = path === '' ? key : `${path}/${key}`;
            const valueStart = this.index;
            this.parseValue(childPath, map);
            const valueEnd = this.index;

            map.set(childPath, {
                start: this.positionAt(valueStart),
                end: this.positionAt(valueEnd),
            });

            this.skipWhitespace();
            if (this.source[this.index] === ',') {
                this.index++;
                continue;
            }
            if (this.source[this.index] === '}') {
                this.index++;
                return;
            }
            throw new Error(`Expected , or } at ${this.index}`);
        }
    }

    private parseArray(path: string, map: JsonSourceMap): void {
        this.expect('[');
        this.skipWhitespace();
        if (this.source[this.index] === ']') {
            this.index++;
            return;
        }
        let i = 0;
        for (;;) {
            this.skipWhitespace();
            const childPath = path === '' ? String(i) : `${path}/${i}`;
            const valueStart = this.index;
            this.parseValue(childPath, map);
            const valueEnd = this.index;

            map.set(childPath, {
                start: this.positionAt(valueStart),
                end: this.positionAt(valueEnd),
            });

            this.skipWhitespace();
            if (this.source[this.index] === ',') {
                this.index++;
                i++;
                continue;
            }
            if (this.source[this.index] === ']') {
                this.index++;
                return;
            }
            throw new Error(`Expected , or ] at ${this.index}`);
        }
    }

    private parseString(): string {
        this.expect('"');
        let result = '';
        while (this.index < this.source.length) {
            const ch = this.source[this.index];
            if (ch === '"') {
                this.index++;
                return result;
            }
            if (ch === '\\') {
                this.index++;
                const esc = this.source[this.index++];
                switch (esc) {
                    case '"': result += '"'; break;
                    case '\\': result += '\\'; break;
                    case '/': result += '/'; break;
                    case 'b': result += '\b'; break;
                    case 'f': result += '\f'; break;
                    case 'n': result += '\n'; break;
                    case 'r': result += '\r'; break;
                    case 't': result += '\t'; break;
                    case 'u': {
                        const hex = this.source.slice(this.index, this.index + 4);
                        this.index += 4;
                        result += String.fromCharCode(parseInt(hex, 16));
                        break;
                    }
                    default:
                        result += esc;
                }
                continue;
            }
            result += ch;
            this.index++;
        }
        throw new Error('Unterminated string');
    }

    private parseKeyword(keyword: string): void {
        if (this.source.slice(this.index, this.index + keyword.length) !== keyword) {
            throw new Error(`Expected ${keyword} at ${this.index}`);
        }
        this.index += keyword.length;
    }

    private parseNumber(): void {
        const match = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
        match.lastIndex = this.index;
        const result = match.exec(this.source);
        if (!result) {
            throw new Error(`Expected number at ${this.index}`);
        }
        this.index += result[0].length;
    }
}

function computeLineStarts(source: string): number[] {
    const starts: number[] = [0];
    for (let i = 0; i < source.length; i++) {
        const ch = source.charCodeAt(i);
        if (ch === 0x0a) {
            starts.push(i + 1);
        } else if (ch === 0x0d) {
            // Handle CR and CRLF
            const next = source.charCodeAt(i + 1);
            if (next === 0x0a) {
                starts.push(i + 2);
                i++;
            } else {
                starts.push(i + 1);
            }
        }
    }
    return starts;
}
