import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { ValueSet } from './valueset-types.js';
import { codeSystemCanonicalsEquivalent } from './code-system-canonical-aliases.js';

type InlineValueSet = ValueSet & { id?: string; contained?: InlineValueSet[] };

/** Carry the loaded package definitions with a lookup instead of relying on a server's IG catalog. */
export async function loadInlineValueSet(
  loader: Pick<ValueSetPackageLoader, 'loadValueSetResource'>,
  canonical: string,
  fhirVersion?: FhirVersion,
  system?: string,
): Promise<InlineValueSet | undefined> {
  const root = await loader.loadValueSetResource(canonical, fhirVersion);
  const requestedVersion = canonical.split('|')[1];
  if (!root || (requestedVersion && root.version !== requestedVersion)) return undefined;
  if (root.compose && !root.compose.include?.length) return undefined;
  const contained: InlineValueSet[] = [];
  const identities = new Map<string, string>();
  const excludedSystems = new Set<string>();
  const materialize = async (resource: ValueSet, ancestors: Set<string>, depth: number): Promise<InlineValueSet> => {
    const copy: InlineValueSet = {
      resourceType: 'ValueSet', url: resource.url, status: resource.status,
      ...(resource.version ? { version: resource.version } : {}),
      ...(resource.compose ? { compose: structuredClone(resource.compose) } : { expansion: structuredClone(resource.expansion) }),
    };
    if (depth >= 20) return copy;
    const omitted = new Set<object>();
    for (const entry of [...(copy.compose?.include ?? []), ...(copy.compose?.exclude ?? [])]) {
      if (system && entry.system && !codeSystemCanonicalsEquivalent(entry.system, system)) {
        omitted.add(entry);
        continue;
      }
      if (!entry.valueSet) continue;
      for (const [index, reference] of entry.valueSet.entries()) {
        if (ancestors.has(reference)) continue;
        let identity = identities.get(reference);
        if (!identity) {
          const nested = await loader.loadValueSetResource(reference, fhirVersion);
          const version = reference.split('|')[1];
          if (!nested || (version && nested.version !== version)) continue;
          identity = `vs-${identities.size + 1}`;
          identities.set(reference, identity);
          const definition = await materialize(nested, new Set([...ancestors, reference]), depth + 1);
          if (nested.compose?.include?.length && definition.compose?.include?.length === 0) excludedSystems.add(reference);
          contained.push({ ...definition, id: identity });
        }
        if (excludedSystems.has(reference)) omitted.add(entry);
        entry.valueSet[index] = `#${identity}`;
      }
    }
    if (copy.compose?.include) copy.compose.include = copy.compose.include.filter(entry => !omitted.has(entry));
    if (copy.compose?.exclude) copy.compose.exclude = copy.compose.exclude.filter(entry => !omitted.has(entry));
    return copy;
  };
  const definition = await materialize(root, new Set([canonical]), 0);
  if (contained.length) definition.contained = contained;
  return definition;
}
