import { ISO_3166_1_ALPHA2, ISO_3166_1_ALPHA3 } from './iso3166-country-codes.js';
import type { CodeSystemConcept } from './valueset-types.js';

const V2_0203 = 'http://terminology.hl7.org/CodeSystem/v2-0203';

/**
 * v2 table 0203 defines national person identifiers as a pattern, NN plus an
 * ISO 3166 country code (NNFIN in Finnish Base), rather than enumerating them;
 * the reference validator accepts every such code.
 */
export function specialV2Concept(system: string, code: string): CodeSystemConcept | undefined {
  if (system !== V2_0203 || !code.startsWith('NN') || code.length <= 3) return undefined;
  const country = code.slice(2);
  return ISO_3166_1_ALPHA3.has(country) || ISO_3166_1_ALPHA2.has(country) ? { code } : undefined;
}
