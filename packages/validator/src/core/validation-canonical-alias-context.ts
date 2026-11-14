import { AsyncLocalStorage } from 'node:async_hooks';

export interface ValidationCanonicalAliases {
  profiles?: Readonly<Record<string, string>>;
  codeSystems?: Readonly<Record<string, string>>;
}
interface AliasContext { profiles: ReadonlyMap<string, string>; codeSystems: ReadonlyMap<string, string> }
const current = new AsyncLocalStorage<AliasContext>();

export function createValidationCanonicalAliasContext(aliases: ValidationCanonicalAliases = {}): AliasContext {
  const compile = (entries: Readonly<Record<string, string>> = {}) => {
    if (Object.keys(entries).length > 256) throw new Error('Canonical alias budget exceeded');
    const result = new Map<string, string>();
    for (const [source, target] of Object.entries(entries)) {
      if (!source || !target || /[\s|]/.test(source + target) || source.length > 2000 || target.length > 2000
        || source === target || Object.hasOwn(entries, target)) throw new Error('Invalid or chained canonical alias');
      result.set(source, target);
    }
    return result;
  };
  return { profiles: compile(aliases.profiles), codeSystems: compile(aliases.codeSystems) };
}

/** Every engine invocation establishes its own scope, including a neutral engine nested in a module run. */
export function withValidationCanonicalAliases<T>(context: AliasContext, run: () => T): T {
  return current.run(context, run);
}

export function selectedCanonicalAlias(kind: keyof AliasContext, canonical: string): string {
  return current.getStore()?.[kind].get(canonical) ?? canonical;
}
