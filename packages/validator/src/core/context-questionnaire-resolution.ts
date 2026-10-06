import {
  getProfileSource,
  type ProfileSourceContext,
} from '../persistence/index.js';
import { resolveValueSetPackageDirectories } from '../validators/valueset-package-resource-access.js';
import { findResourceByCanonicalScan, findResourceInPackages } from '../validators/valueset-package-search.js';
import type { BundleCanonicalResolver } from './multi-aspect-bundle-reference-resolver.js';
import type { QuestionnaireContextRegistry } from './questionnaire-context-registry.js';

type FhirResource = Record<string, unknown>;

export async function resolveContextQuestionnaire(
  response: unknown,
  registry: QuestionnaireContextRegistry | undefined,
  context: ProfileSourceContext,
  resolveBundleCanonical?: BundleCanonicalResolver | null,
): Promise<FhirResource | undefined> {
  const bundleLocal = resolveBundleLocalQuestionnaire(response, resolveBundleCanonical);
  if (bundleLocal) return bundleLocal;
  const registered = registry?.resolveForResponse(response);
  if (registered) return registered;
  if (!isRecord(response) || response.resourceType !== 'QuestionnaireResponse') return undefined;
  if (typeof response.questionnaire !== 'string' || response.questionnaire.trim().length === 0) {
    return undefined;
  }

  const [canonicalUrl, version] = response.questionnaire.split('|');
  if (!canonicalUrl) return undefined;
  // An unversioned canonical is read in the release of the IG whose profile
  // the response declares: a US Core 7.0.0 response answers the 7.0.0
  // Questionnaire, whose items a later release may have reworded.
  const declaredRelease = version ? undefined : declaredIgRelease(response, canonicalUrl);
  if (declaredRelease) {
    const pinned = await findQuestionnaire(canonicalUrl, declaredRelease, context);
    if (pinned) return pinned;
  }
  return findQuestionnaire(canonicalUrl, version || undefined, context);
}

async function findQuestionnaire(
  canonicalUrl: string,
  version: string | undefined,
  context: ProfileSourceContext,
): Promise<FhirResource | undefined> {
  const source = getProfileSource();
  const hosted = source.findCanonicalResource
    ? await source.findCanonicalResource(canonicalUrl, 'Questionnaire', version, context)
      .catch(() => null)
    : null;
  if (isMatchingQuestionnaire(hosted, canonicalUrl, version)) return hosted;

  // An IG ships its Questionnaires like its profiles; the reference validator
  // judges a response against the one it loaded with the IG, and its fetcher
  // also finds an IG example by the id the canonical ends in.
  const directories = resolveValueSetPackageDirectories();
  const major = context.fhirVersion?.slice(1);
  const id = canonicalUrl.slice(canonicalUrl.lastIndexOf('/') + 1);
  const packaged = await findResourceByCanonicalScan<PackagedQuestionnaire>(
    directories, canonicalUrl, 'Questionnaire', major, version,
  ).catch(() => null) ?? (FHIR_ID.test(id)
    ? await findResourceInPackages<PackagedQuestionnaire>(
      directories, canonicalUrl, [`example/Questionnaire-${id}.json`], major, version,
    ).catch(() => null)
    : null);
  return isMatchingQuestionnaire(packaged, canonicalUrl, version) ? packaged : undefined;
}

/** The release of a versioned profile the response declares from the Questionnaire's own IG. */
function declaredIgRelease(response: FhirResource, questionnaireUrl: string): string | undefined {
  const igBase = questionnaireUrl.replace(/\/Questionnaire\/[^/]+$/, '');
  if (igBase === questionnaireUrl) return undefined;
  const meta = isRecord(response.meta) ? response.meta : undefined;
  const profiles = Array.isArray(meta?.profile) ? meta.profile : [];
  for (const profile of profiles) {
    if (typeof profile !== 'string') continue;
    const [profileUrl, release] = profile.split('|');
    if (release && profileUrl.replace(/\/StructureDefinition\/[^/]+$/, '') === igBase) return release;
  }
  return undefined;
}

type PackagedQuestionnaire = FhirResource & { url?: string; version?: string };

/** The id names a file, so it must be a FHIR id and nothing that leaves the package. */
const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

/**
 * The Bundle carrying the response is the most specific context there is, so
 * a Questionnaire in it wins over registered and package copies. A contained
 * (`#id`) reference belongs to the response itself and stays with the
 * registry's contained lookup.
 */
function resolveBundleLocalQuestionnaire(
  response: unknown,
  resolve: BundleCanonicalResolver | null | undefined,
): FhirResource | undefined {
  if (!resolve || !isRecord(response) || response.resourceType !== 'QuestionnaireResponse') {
    return undefined;
  }
  if (typeof response.questionnaire !== 'string') return undefined;
  const canonical = response.questionnaire.trim();
  if (!canonical || canonical.startsWith('#')) return undefined;
  return resolve(canonical, 'Questionnaire') ?? undefined;
}

function isMatchingQuestionnaire(
  resource: Record<string, unknown> | null,
  canonicalUrl: string,
  version: string | undefined,
): resource is FhirResource {
  if (!resource || resource.resourceType !== 'Questionnaire') return false;
  if (resource.url !== canonicalUrl) return false;
  return !version || resource.version === version;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
