interface NumberSource {
  lexical: string;
  numeric: number;
}

// Object identity and property/index keep equal numbers with different source
// precision separate. Weak keys neither serialize nor retain clinical inputs.
const sources = new WeakMap<object, Map<string, NumberSource>>();

export function recordNumberSource(owner: object, key: string, lexical: string, numeric: number): void {
  if (!Number.isFinite(numeric) || !Object.is(Number(lexical), numeric)) return;
  let fields = sources.get(owner);
  if (!fields) { fields = new Map(); sources.set(owner, fields); }
  fields.set(key, { lexical, numeric });
}

export function numberSource(owner: object, key: string, current: number): string | undefined {
  const source = sources.get(owner)?.get(key);
  return source && Object.is(source.numeric, current) ? source.lexical : undefined;
}

/** Preserve source context across the engine's own datatype/resource projections. */
export function copyNumberSources<T>(source: unknown, target: T): T {
  const pending: Array<[unknown, unknown]> = [[source, target]];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const [from, to] = pending.pop()!;
    if (!from || !to || typeof from !== 'object' || typeof to !== 'object' || from === to || seen.has(to)) continue;
    seen.add(to);
    for (const [key, value] of Object.entries(from)) {
      if (key === '__path__' || !Object.hasOwn(to, key)) continue;
      const copied: unknown = Reflect.get(to, key);
      if (typeof value === 'number' && typeof copied === 'number' && Object.is(value, copied)) {
        const lexical = numberSource(from, key, value);
        if (lexical !== undefined) recordNumberSource(to, key, lexical, copied);
      } else if (value && copied && typeof value === 'object' && typeof copied === 'object') pending.push([value, copied]);
    }
  }
  return target;
}
