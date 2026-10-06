import { isCodeSystemForRequestedRelease } from './valueset-code-system-rules.js';
import type { ValueSetCache } from './valueset-cache.js';
import type { CodeSystem } from './valueset-types.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import { versionedCacheKey } from './valueset-package-utils.js';
import { normalizeKnownCodeSystemCanonical } from './code-system-canonical-aliases.js';
import { captureValidationDependency } from '../validation-dependency-snapshot.js';
import { builtInProviderSnapshot, providerLookupKey, type LocalTerminologyAuthority } from './built-in-terminology-provider.js';

export type CodeSystemLookup = { codeSystem: CodeSystem | null; blocked: boolean };

/** Selected definitions and failed selection take precedence over built-in providers. */
export async function resolveLocalTerminologyAuthority(
    cache: ValueSetCache, system: string, fhirVersion: FhirVersion | undefined, requestedVersion: string | undefined, preferredMajor: string | undefined,
    load: (canonical: string, version: string | undefined) => Promise<CodeSystemLookup>,
): Promise<LocalTerminologyAuthority | null> {
    const [url, pipedVersion] = system.split('|');
    if (pipedVersion && requestedVersion && pipedVersion !== requestedVersion) return null;
    const version = requestedVersion ?? pipedVersion;
    const canonical = normalizeKnownCodeSystemCanonical(url);
    const contextVersion = fhirVersion ?? cache.sourceContexts.context()?.fhirVersion;
    const key = versionedCacheKey(canonical, version, contextVersion);
    const cached = [cache.getCodeSystem(key), cache.getCodeSystemFile(key),
        ...(version ? [cache.getCodeSystem(`${canonical}|${version}`), cache.getCodeSystemFile(`${canonical}|${version}`)] : []),
        cache.getCodeSystem(canonical), cache.getCodeSystemFile(canonical)]
        .find(candidate => candidate && normalizeKnownCodeSystemCanonical(candidate.url) === canonical
            && (!version || candidate.version === version) && isCodeSystemForRequestedRelease(canonical, candidate, preferredMajor, version));
    if (cached) return { kind: 'code-system', codeSystem: cached };
    const selection = await load(canonical, version);
    if (selection.codeSystem) return normalizeKnownCodeSystemCanonical(selection.codeSystem.url) === canonical
        && (!version || selection.codeSystem.version === version) && isCodeSystemForRequestedRelease(canonical, selection.codeSystem, preferredMajor, version)
        ? { kind: 'code-system', codeSystem: selection.codeSystem } : null;
    if (selection.blocked) return null;
    const scopeKey = cache.contextKey(providerLookupKey);
    return captureValidationDependency('terminology', 'loadBuiltInTerminologyProvider',
        [canonical, version, contextVersion, scopeKey], async () => {
            const snapshot = builtInProviderSnapshot(canonical, version);
            return snapshot ? { kind: 'provider' as const, snapshot, scopeKey } : null;
        });
}
