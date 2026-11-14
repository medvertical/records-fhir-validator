import { z } from 'zod';
import type { PackageRef } from './canonical-pin-manifest-candidates.js';

const identity = z.string().regex(/^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*)+#\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
const aliasSchema = z.object({ source: identity, requested: identity, resolved: identity,
  reason: z.string().min(1) }).strict();
export type PackageDependencyAlias = z.infer<typeof aliasSchema>;

function ref(identity: string): PackageRef {
  const [name, version] = identity.split('#');
  return { name, version };
}
function key(source: string, requested: string): string { return `${source}\0${requested}`; }

/** Published metadata is retained; only explicitly named dependency edges can be rebound. */
export class PackageDependencyAliases {
  private readonly bindings = new Map<string, Readonly<PackageDependencyAlias>>();

  constructor(aliases: readonly PackageDependencyAlias[] = [], pins: Readonly<Record<string, string>> = {}) {
    for (const alias of z.array(aliasSchema).parse(aliases)) {
      const source = ref(alias.source), requested = ref(alias.requested), resolved = ref(alias.resolved);
      if (requested.name === resolved.name || requested.name.toLowerCase() !== resolved.name
        || resolved.name !== resolved.name.toLowerCase() || source.name !== source.name.toLowerCase()
        || requested.version !== resolved.version || pins[source.name] !== source.version
        || pins[resolved.name] !== resolved.version
        || (Object.hasOwn(pins, requested.name) && pins[requested.name] !== requested.version)) {
        throw new Error('Dependency alias requires a case-only package correction, exact source and unchanged pinned version');
      }
      const identity = key(alias.source, alias.requested);
      if (this.bindings.has(identity)) throw new Error('Duplicate package dependency alias');
      this.bindings.set(identity, Object.freeze(alias));
    }
  }

  resolve(source: PackageRef, dependency: PackageRef, pins: Readonly<Record<string, string>>): PackageRef | undefined {
    const alias = this.bindings.get(key(`${source.name}#${source.version}`, `${dependency.name}#${dependency.version}`));
    if (!alias) return undefined;
    const resolved = ref(alias.resolved);
    return pins[source.name] === source.version && pins[resolved.name] === resolved.version
      && (!Object.hasOwn(pins, dependency.name) || pins[dependency.name] === dependency.version) ? resolved : undefined;
  }
}
