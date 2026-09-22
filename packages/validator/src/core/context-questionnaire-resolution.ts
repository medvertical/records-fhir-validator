import {
  getProfileSource,
  type ProfileSourceContext,
} from '../persistence/index.js';
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
  const source = getProfileSource();
  if (!source.findCanonicalResource) return undefined;

  try {
    const resource = await source.findCanonicalResource(
      canonicalUrl,
      'Questionnaire',
      version || undefined,
      context,
    );
    return isMatchingQuestionnaire(resource, canonicalUrl, version)
      ? resource
      : undefined;
  } catch {
    return undefined;
  }
}

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
