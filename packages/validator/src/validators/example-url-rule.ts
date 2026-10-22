import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { isPackageDefinedUrl } from './package-defined-urls.js';
import { resolveValueSetPackageDirectories } from './valueset-package-resource-access.js';

const URL_TYPES = new Set(['uri', 'url', 'canonical']);

const EXAMPLE_HOSTS = ['example.org', 'acme.com', 'acme.org', 'example.com', 'example.net'];

/**
 * The HL7 reference validator's example test (BaseValidator.isExampleUrl in
 * 6.10.0). Its example OIDs never reach the test — the fetcher accepts any
 * `urn:` value first — so only http(s) URLs count.
 */
export function isReferenceValidatorExampleUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
    && EXAMPLE_HOSTS.some(host => value.includes(`${host}/`) || value.endsWith(host));
}

/**
 * An example URL is an error ("Example URLs are not allowed in this context")
 * only where the reference validator also fails to resolve it. It never
 * resolves a canonical outside its loaded packages, but it accepts any other
 * external uri or url unless the value names `example.org` or `acme.com`
 * (ValidationEngine.resolveURL).
 */
function isUnresolvableExampleUrl(value: string, type: string): boolean {
  if (!isReferenceValidatorExampleUrl(value)) return false;
  return type === 'canonical' || value.includes('example.org') || value.includes('acme.com');
}

/**
 * Extensions whose values the reference validator does not test for example
 * hosts (InstanceValidator.isExemptPathForUrlChecking): a textLink's `data`
 * is checked against the resource instead, and web-source and ig-page-name
 * link to publication pages.
 */
const EXAMPLE_URL_EXEMPT_EXTENSIONS = new Set([
  'http://hl7.org/fhir/StructureDefinition/textLink',
  'http://hl7.org/fhir/StructureDefinition/web-source',
  'http://hl7.org/fhir/tools/StructureDefinition/web-source',
  'http://hl7.org/fhir/tools/StructureDefinition/ig-page-name',
]);

export function withoutExemptExtensionExampleUrls(extension: unknown, issues: ValidationIssue[]): ValidationIssue[] {
  const url = typeof extension === 'object' && extension !== null ? (extension as { url?: unknown }).url : undefined;
  if (typeof url !== 'string' || !EXAMPLE_URL_EXEMPT_EXTENSIONS.has(url)) return issues;
  return issues.filter(issue => issue.code !== 'structural-example-url'
    || !/\.value(?:\[x\]|[A-Z]\w*)$/.test(issue.path ?? ''));
}

/** Resources whose `url` is a network address to reach them, not a canonical they define. */
const ADDRESS_URL_OWNERS = new Set(['Device', 'DeviceDefinition']);

/**
 * Elements whose value defines a URL rather than pointing at one: a canonical
 * resource's own `url` and `Bundle.entry.fullUrl`. The reference validator
 * never resolves those, so an example host there is not an error.
 */
export function isDefiningUrlPath(path: string): boolean {
  if (/\.fullUrl$/.test(path)) return true;
  const owner = path.match(/^([A-Z][A-Za-z]+)\.url$/)?.[1];
  if (owner) return !ADDRESS_URL_OWNERS.has(owner);
  return /\.(?:contained\[\d+\]|resource)\.url$/.test(path);
}

export function validateExampleUrl(
  value: unknown,
  type: string,
  path: string,
  resourceType: string,
  profileUrl?: string,
): ValidationIssue | null {
  if (typeof value !== 'string' || !URL_TYPES.has(type)) return null;
  if (!isUnresolvableExampleUrl(value, type) || isDefiningUrlPath(path)) return null;
  return createValidationIssue({
    code: 'structural-example-url',
    path,
    resourceType,
    profile: profileUrl,
    customMessage: `Example URLs are not allowed in this context (${value})`,
    details: {
      value,
      fixHint: 'Replace the example host with the real system, namespace or endpoint URL.',
    },
  });
}

/**
 * A package the reference validator loads may itself publish a definition at
 * an example host (CDex's `http://example.org/cdex-questionnaire-example2`),
 * and a URL naming it resolves.
 */
export async function unlessPackageDefined(
  issue: ValidationIssue | null,
  value: unknown,
  directories?: readonly string[],
): Promise<ValidationIssue | null> {
  if (!issue || issue.code !== 'structural-example-url' || typeof value !== 'string') return issue;
  const [url, version] = value.split('#')[0].split('|');
  return await isPackageDefinedUrl(url, version, directories ?? resolveValueSetPackageDirectories()) ? null : issue;
}

const SPEC_PAGE_TYPES = new Set(['uri', 'url']);
const SPEC_ROOTS = new Set(['http://hl7.org/fhir', 'http://hl7.org/fhirpath']);
const PAGE_SUFFIX = /\.(?:html?|pdf|zip|tgz)(?:[#?].*)?$/i;

/**
 * The reference validator resolves a uri or url under `http://hl7.org/fhir`
 * against the definitions it has loaded and reports one it cannot resolve as
 * an error. A page of the specification or of an IG (`observation.html`, a
 * trailing `/`, the bare root) never names a definition, so it is reported
 * without knowing every loaded canonical. Systems and extension URLs have
 * their own rules; extension values may legitimately link to pages.
 */
export function isSpecificationPageUrl(value: string): boolean {
  if (!value.startsWith('http://hl7.org/fhir')) return false;
  return SPEC_ROOTS.has(value) || value.endsWith('/') || PAGE_SUFFIX.test(value);
}

export function validateSpecificationPageUrl(
  value: unknown,
  type: string,
  path: string,
  resourceType: string,
  profileUrl?: string,
): ValidationIssue | null {
  if (typeof value !== 'string' || !SPEC_PAGE_TYPES.has(type) || !isSpecificationPageUrl(value)) return null;
  if (isDefiningUrlPath(path) || /\.system$/.test(path)) return null;
  if (/(?:^|\.)(?:extension|modifierExtension)(?:\[\d+\])?\.(?:url|value[A-Z]\w*)$/.test(path)) return null;
  return createValidationIssue({
    code: 'structural-url-unresolved',
    path,
    resourceType,
    profile: profileUrl,
    customMessage: `No definition could be found for URL value '${value}'`,
    details: {
      value,
      fixHint: 'Point at the definition\'s canonical URL, or at a page outside the http://hl7.org/fhir namespace.',
    },
  });
}
