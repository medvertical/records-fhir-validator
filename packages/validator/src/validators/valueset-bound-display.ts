import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { CodeInfo } from './valueset-display-utils.js';
import type { CodeBindingOutcome, ValueSet } from './valueset-types.js';
import { codeSystemCanonicalsEquivalent } from './code-system-canonical-aliases.js';
import { hasUnknownTerminologyModifiers } from './valueset-concept-filter-membership.js';
import { assessTerminologyLabels } from './valueset-display-authority.js';

/** A ValueSet can name an alternative display in its own binding context, without owning CodeSystem membership. */
export async function matchesBoundValueSetDisplay(input: {
  codeInfo: CodeInfo;
  reference: string;
  requestedVersion?: string;
  displayLanguage?: string;
  fhirVersion?: FhirVersion;
  loader: Pick<ValueSetPackageLoader, 'loadValueSetResource'>;
  resolveMembership?: (version?: string) => Promise<CodeBindingOutcome>;
}): Promise<boolean> {
  const { codeInfo, reference, loader, fhirVersion, requestedVersion, displayLanguage } = input;
  if (!codeInfo.system || !codeInfo.display || !input.resolveMembership) return false;
  let selected: ValueSet | null;
  try { selected = await loader.loadValueSetResource(reference, fhirVersion); }
  catch { return false; }
  const [canonical, version] = reference.split('|');
  if (!selected || selected.url !== canonical || (version && selected.version !== version)
    || hasUnknownTerminologyModifiers(selected) || !selected.compose || hasUnknownTerminologyModifiers(selected.compose)
    || selected.compose.exclude?.length) return false;
  if (!Array.isArray(selected.compose.include)) return false;
  for (const entry of selected.compose.include) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || (entry.system !== undefined && typeof entry.system !== 'string')
      || (entry.version !== undefined && typeof entry.version !== 'string')) continue;
    const [system, pipedVersion] = (entry.system ?? '').split('|');
    const edition = entry.version ?? pipedVersion;
    if (!codeSystemCanonicalsEquivalent(system, codeInfo.system) || entry.filter?.length || entry.valueSet?.length
      || (pipedVersion && entry.version && pipedVersion !== entry.version)
      || edition === '*' || (requestedVersion !== undefined && edition !== requestedVersion)
      || hasUnknownTerminologyModifiers(entry)) continue;
    const concept = Array.isArray(entry.concept) ? entry.concept.find(candidate => candidate && candidate.code === codeInfo.code) : undefined;
    if (!concept || hasUnknownTerminologyModifiers(concept)) continue;
    const labels = [
      ...(typeof concept.display === 'string' && concept.display ? [{ value: concept.display, language: selected.language }] : []),
      ...(Array.isArray(concept.designation) ? concept.designation : []).flatMap(label =>
        label && typeof label.value === 'string' && label.value && !hasUnknownTerminologyModifiers(label)
          ? [{ value: label.value, language: typeof label.language === 'string' ? label.language : selected.language }] : []),
    ];
    if (assessTerminologyLabels(codeInfo, labels, codeInfo.display, displayLanguage, concept.display).outcome !== 'accepted') continue;
    if (await input.resolveMembership(edition ?? requestedVersion) === 'valid') return true;
  }
  return false;
}
