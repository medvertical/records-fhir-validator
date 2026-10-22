import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { KNOWN_FHIR_RESOURCE_TYPES } from '../reference/reference-resource-types.js';
import { isDefiningUrlPath } from './example-url-rule.js';
import { isPackageDefinedUrl } from './package-defined-urls.js';
import { installedHl7CanonicalBases } from './hl7-registrar-packages.js';
import { resolveValueSetPackageDirectories } from './valueset-package-resource-access.js';

/**
 * The reference validator resolves every uri or url in HL7's space against the
 * definitions it has loaded and reports one it cannot resolve as an error ("No
 * definition could be found for URL value"). US Core's example map names the
 * IG itself (`http://hl7.org/fhir/us/core`), which no definition carries.
 * Only a URL whose owner is installed — the core specification, HL7
 * Terminology or the IG whose canonical it extends — can be judged; values it
 * names in the reference validator's own lists stand.
 */
const CORE = 'http://hl7.org/fhir/';
const FHIRPATH = 'http://hl7.org/fhirpath/';
const TERMINOLOGY = 'http://terminology.hl7.org/';

// InstanceValidator.isDefinitionURL, SpecialExtensions and ValidationEngine.resolveURL.
const NAMED_URLS = new Set([
  ...['Boolean', 'String', 'Integer', 'Decimal', 'Date', 'Time', 'DateTime', 'Quantity'].map(type => `${FHIRPATH}System.${type}`),
  ...['Patient', 'Practitioner', 'Group', 'Device', 'Encounter'].map(compartment => `${CORE}CompartmentDefinition/${compartment}`),
  `${CORE}SearchParameter/Resource-filter`, `${CORE}ConsentPolicy/opt-out`, `${CORE}ConsentPolicy/opt-in`,
  ...['elementdefinition-type-must-support', 'instance-name', 'instance-description', 'codesystem-properties-mode',
    'structuredefinition-rdf-type', 'structuredefinition-conformance-derivedFrom', 'structuredefinition-fmm-support',
  ].map(extension => `${CORE}StructureDefinition/${extension}`),
  `${CORE}build/StructureDefinition/definition`, `${CORE}build/StructureDefinition/binding-definition`,
  // InstanceValidator.isKnownMappingUri
  ...['auditevent', 'composition', 'consent', 'documentreference', 'fivews', 'interface', 'logical',
    'object-implementation', 'provenance', 'rr', 'w5', 'workflow'].map(space => `${CORE}${space}`),
]);

const RELEASE_SEGMENT = /^(?:R\d+B?|STU\d+|DSTU\d+|\d+\.\d+(?:\.\d+)?)$/;
const RETIRED_SEGMENT = /^v[23]$/;
const CROSS_VERSION_EXTENSION = /^http:\/\/hl7\.org\/fhir\/\d\.\d\/StructureDefinition\/extension-/;

// InstanceValidator.isExemptPathForUrlChecking: a textLink's values are
// checked against the resource; web-source and ig-page-name link to pages.
const TEXT_LINK = `${CORE}StructureDefinition/textLink`;
const PAGE_LINK_EXTENSIONS = new Set([
  `${CORE}StructureDefinition/web-source`, `${CORE}tools/StructureDefinition/web-source`,
  `${CORE}tools/StructureDefinition/ig-page-name`,
]);

export async function validateUnresolvedHl7Url(
  value: unknown,
  type: string,
  path: string,
  resourceType: string,
  profileUrl?: string,
  directories?: readonly string[],
): Promise<ValidationIssue | null> {
  if (typeof value !== 'string' || (type !== 'uri' && type !== 'url') || answersToOtherRule(path)) return null;
  const [url, version] = value.split('#')[0].split('|');
  if (!url.startsWith(CORE) && !url.startsWith(FHIRPATH) && !url.startsWith(TERMINOLOGY)) return null;
  if (url.startsWith(`${CORE}sid/`) || NAMED_URLS.has(url) || CROSS_VERSION_EXTENSION.test(url)) return null;
  directories ??= resolveValueSetPackageDirectories();
  if (!await ownerInstalled(url, directories)) return null;
  if (await isPackageDefinedUrl(url, version, directories)) return null;
  return createValidationIssue({
    code: 'structural-url-unresolved',
    path,
    resourceType,
    profile: profileUrl,
    customMessage: `No definition could be found for URL value '${value}'`,
    details: {
      value,
      fixHint: 'Point at the canonical URL of a definition the owning package publishes.',
    },
  });
}

/**
 * A resource's own url and fullUrl define rather than point; systems, HL7
 * identifier systems and extension URLs have their own rules. An extension's
 * value is reported under the path naming its URL.
 */
function answersToOtherRule(path: string): boolean {
  if (isDefiningUrlPath(path) || /\.system$/.test(path)) return true;
  if (/(?:^|\.)(?:extension|modifierExtension)(?:\[[^\]]*\])?\.url$/.test(path)) return true;
  if (/(?:^|\.)(?:extension|modifierExtension)(?:\[\d+\])?\.value[A-Z]\w*$/.test(path)) return true;
  return exemptExtensionValue(path);
}

function exemptExtensionValue(path: string): boolean {
  if (!/(?:extension|modifierExtension)\[url='[^']*'\]\.value[A-Z]\w*$/.test(path)) return false;
  const urls = [...path.matchAll(/(?:extension|modifierExtension)\[url='([^']*)'\]/g)].map(match => match[1]);
  const own = urls[urls.length - 1];
  if (PAGE_LINK_EXTENSIONS.has(own)) return true;
  // A cross-version extension carrying a canonical resource's url defines it.
  if (CROSS_VERSION_EXTENSION.test(own) && /-[A-Z][A-Za-z]+\.url$/.test(own)) return true;
  // The nearest extension with an absolute URL decides; one named only by position is not a textLink.
  const absolute = [...urls].reverse().find(url => /^https?:\/\//.test(url));
  if (absolute !== undefined) return absolute === TEXT_LINK;
  return !/(?:^|\.)(?:extension|modifierExtension)(?:\[\d+\])?\./.test(path);
}

/** The core specification, FHIRPath, HL7 Terminology, or an installed IG. */
async function ownerInstalled(url: string, directories: readonly string[]): Promise<boolean> {
  if (url.startsWith(FHIRPATH)) return true;
  const bases = await installedHl7CanonicalBases(directories);
  if (url.startsWith(TERMINOLOGY)) return bases.includes('http://terminology.hl7.org');
  if (bases.some(base => url === base || url.startsWith(`${base}/`))) return true;
  const [first, second] = url.slice(CORE.length).split('/');
  return second === undefined || KNOWN_FHIR_RESOURCE_TYPES.has(first)
    || RELEASE_SEGMENT.test(first) || RETIRED_SEGMENT.test(first);
}
