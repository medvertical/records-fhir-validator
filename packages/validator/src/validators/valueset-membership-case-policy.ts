import { normalizeKnownCodeSystemCanonical, codeSystemCanonicalCandidates } from './code-system-canonical-aliases.js';
import { finiteTerminologyAuthorityFailure } from './finite-terminology-authority.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { ValueSet } from './valueset-types.js';

type Loader = Pick<ValueSetPackageLoader, 'loadValueSetResource' | 'loadCodeSystemForValueSet'>
  & Partial<Pick<ValueSetPackageLoader, 'loadLocalTerminologyAuthority'>>;
export type ValueSetCasePolicy = 'sensitive' | 'insensitive' | 'unknown';

/** Expansion keys omit editions; only unanimous, scoped metadata can qualify case folding. */
export async function resolveValueSetCasePolicy(loader: Loader, system: string | undefined,
  reference: string, fhirVersion?: FhirVersion): Promise<ValueSetCasePolicy> {
  if (system === 'urn:ietf:bcp:47') return 'insensitive';
  if (!system || !loader.loadValueSetResource || !loader.loadCodeSystemForValueSet) return 'unknown';
  const canonical = normalizeKnownCodeSystemCanonical(system.split('|')[0]);
  const declarations: Array<{ owner: ValueSet; version?: string }> = [], visited = new Set<string>();
  let incomplete = false;
  async function discover(url: string): Promise<void> {
    if (visited.has(url)) return;
    if (visited.size >= 20) { incomplete = true; return; }
    visited.add(url);
    const owner = await loader.loadValueSetResource(url, fhirVersion);
    const [requested, version] = url.split('|');
    if (!owner || owner.url !== requested || version && owner.version !== version
      || finiteTerminologyAuthorityFailure(owner, 'ValueSet', 250_000)) { incomplete = true; return; }
    for (const entry of [...owner.compose?.include ?? [], ...owner.compose?.exclude ?? []]) {
      if (entry.system && normalizeKnownCodeSystemCanonical(entry.system.split('|')[0]) === canonical) {
        const piped = entry.system.split('|')[1];
        if (piped && entry.version && piped !== entry.version || entry.version === '*') incomplete = true;
        declarations.push({ owner, version: entry.version ?? piped });
      }
      for (const nested of entry.valueSet ?? []) await discover(nested);
    }
    if (owner.expansion && finiteTerminologyAuthorityFailure(owner.expansion, 'expansion', 250_000)) { incomplete = true; return; }
    const pending = (owner.expansion?.contains ?? []).map(entry => ({ entry, system: entry.system, version: entry.version }));
    let observed = 0;
    while (pending.length) {
      if (++observed > 250_000) { incomplete = true; break; }
      const { entry, system: inheritedSystem, version: inheritedVersion } = pending.pop()!;
      const declaredSystem = entry.system ?? inheritedSystem, declaredVersion = entry.version ?? inheritedVersion;
      if (declaredSystem && normalizeKnownCodeSystemCanonical(declaredSystem) === canonical)
        declarations.push({ owner, version: declaredVersion });
      for (const child of entry.contains ?? []) pending.push({ entry: child, system: declaredSystem, version: declaredVersion });
    }
  }
  try { await discover(reference); } catch { return 'unknown'; }
  const policies = new Set<ValueSetCasePolicy>(), seen = new Set<string>();
  for (const { owner, version } of declarations) {
    const key = JSON.stringify([owner.url, owner.version, version]);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const selected = loader.loadLocalTerminologyAuthority
        ? await loader.loadLocalTerminologyAuthority(canonical, fhirVersion, version, owner) : undefined;
      const cs = selected === undefined ? await loader.loadCodeSystemForValueSet(owner, canonical, fhirVersion, version)
        : selected?.kind === 'code-system' ? selected.codeSystem : null;
      if (!cs || normalizeKnownCodeSystemCanonical(cs.url) !== canonical || version && cs.version !== version
        || finiteTerminologyAuthorityFailure({ ...cs, concept: [] }, 'CodeSystem', 1)) { incomplete = true; continue; }
      policies.add(cs.caseSensitive === true ? 'sensitive' : 'insensitive');
    } catch { incomplete = true; }
  }
  return !incomplete && policies.size === 1 ? [...policies][0] : 'unknown';
}

export function expansionHasCaseVariant(expansion: Set<string>, code: string, system: string | undefined): boolean {
  const prefixes = system ? codeSystemCanonicalCandidates(system).map(candidate => `${candidate}|`) : [''];
  const folded = code.toLowerCase();
  for (const entry of expansion) for (const prefix of prefixes) {
    if (entry.startsWith(prefix) && entry.slice(prefix.length).toLowerCase() === folded) return true;
  }
  return false;
}
