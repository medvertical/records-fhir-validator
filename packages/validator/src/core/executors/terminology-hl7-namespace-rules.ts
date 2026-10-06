import { KNOWN_FHIR_RESOURCE_TYPES } from '../../reference/reference-resource-types.js';

/** Core-namespace URIs the reference validator resolves without a definition. */
const HL7_CORE_URIS_WITHOUT_DEFINITION = new Set([
  'http://hl7.org/fhir/w5',
  'http://hl7.org/fhir/fivews',
  'http://hl7.org/fhir/workflow',
  'http://hl7.org/fhir/ConsentPolicy/opt-out',
  'http://hl7.org/fhir/ConsentPolicy/opt-in',
]);

const FHIR_RELEASE_SEGMENT = /^(?:\d+\.\d+(?:\.\d+)?|DSTU2|STU3|R4B?|R5|R6)$/i;

/**
 * URLs that only the core specification can define. The reference validator
 * looks such a URL up in the packages it has loaded and, unlike an IG
 * canonical (`http://hl7.org/fhir/us/core/CodeSystem/…`), never installs
 * another package for it — so an unknown one is an error ("No definition could
 * be found for URL value"), typically a DSTU2/STU3-era system such as
 * `http://hl7.org/fhir/v3/ParticipationMode`.
 *
 * `http://terminology.hl7.org/…` stays out: HL7 Terminology retires and
 * renames code systems between releases, and an IG may pin a release this
 * installation does not carry. `http://hl7.org/fhir/sid/…` stays out because
 * those identifiers may be registered through NamingSystems.
 */
export function isHl7CoreNamespaceUrl(url: string): boolean {
  const canonical = url.split('|')[0];
  if (!canonical.startsWith('http://hl7.org/fhir/')) return false;
  if (HL7_CORE_URIS_WITHOUT_DEFINITION.has(canonical)) return false;

  const segments = canonical.slice('http://hl7.org/fhir/'.length).split('/').filter(Boolean);
  if (segments.length === 0) return false;
  if (FHIR_RELEASE_SEGMENT.test(segments[0]) || segments[0] === 'sid') return false;
  const resourceTypeIndex = segments.findIndex(segment => KNOWN_FHIR_RESOURCE_TYPES.has(segment));
  return resourceTypeIndex <= 0;
}
