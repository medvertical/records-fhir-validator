import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';

/**
 * Whether a Coding without a system satisfies its binding, decided as the
 * reference validator does. A lone Coding is held against its binding only
 * when both system and code are there, so without a system only a required
 * binding (which Records keeps strict) sees it. Inside a CodeableConcept it
 * is in no value set, except one made of a single include listing its codes,
 * which takes a listed code at face value.
 */
export async function systemlessCodingSatisfiesBinding(
  loader: Pick<ValueSetPackageLoader, 'loadValueSetResource'>,
  rawCode: unknown,
  code: string,
  valueSetUrl: string,
  strength: string | undefined,
  fhirVersion?: FhirVersion,
): Promise<boolean> {
  if (!Array.isArray((rawCode as { coding?: unknown }).coding)) return strength !== 'required';
  try {
    const valueSet = await loader.loadValueSetResource(valueSetUrl, fhirVersion);
    // An expansion holds system and code pairs, never a bare code.
    if (!valueSet || valueSet.expansion) return false;
    const [include, ...otherIncludes] = valueSet.compose?.include ?? [];
    if (!include?.system || include.valueSet?.length || otherIncludes.length > 0) return false;
    if (!include.concept?.some(concept => concept.code === code)) return false;
    const excludes = valueSet.compose?.exclude ?? [];
    return !(excludes.length === 1 && excludes[0].concept?.some(concept => concept.code === code));
  } catch {
    return false;
  }
}
