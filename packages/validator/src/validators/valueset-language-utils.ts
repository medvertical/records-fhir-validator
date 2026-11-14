import { finiteTerminologyAuthorityFailure } from './finite-terminology-authority.js';
import { parseLanguageTag } from './language-code-validator.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';

/** Grammar proves membership only when the selected definition includes the entire language system. */
export async function isLanguageBinding(valueSetUrl: string, system: string | undefined,
  loader: Pick<ValueSetPackageLoader, 'loadValueSetResource'>, fhirVersion?: FhirVersion,
  codeSystemVersion?: string): Promise<boolean> {
  const [canonical, version, extra] = valueSetUrl.split('|');
  if (canonical !== 'http://hl7.org/fhir/ValueSet/all-languages' || extra !== undefined
    || system !== undefined && system !== 'urn:ietf:bcp:47' || codeSystemVersion?.trim()
    || !loader.loadValueSetResource) return false;
  try {
    const valueSet = await loader.loadValueSetResource(valueSetUrl, fhirVersion);
    if (!valueSet || valueSet.url !== canonical || version !== undefined && valueSet.version !== version
      || finiteTerminologyAuthorityFailure(valueSet, 'ValueSet', 250_000)
      || valueSet.meta?.tag?.some(tag => tag.code === 'SUBSETTED')) return false;
    const compose = valueSet.compose;
    if (!compose || compose.include?.length !== 1 || compose.exclude?.length
      || compose.lockedDate !== undefined || compose.inactive !== undefined) return false;
    const include = compose.include[0];
    return include.system === 'urn:ietf:bcp:47' && include.version === undefined
      && !include.concept?.length && !include.filter?.length && !include.valueSet?.length;
  } catch {
    return false;
  }
}

export function validateBCP47(code: string): boolean {
  return parseLanguageTag(code) === null;
}
