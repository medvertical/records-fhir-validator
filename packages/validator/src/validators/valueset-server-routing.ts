import { logger } from '../logger.js';
import type {
  TerminologyResolutionConfig,
  TerminologyServerDescriptor,
  TerminologyServerOverride,
} from './valueset-types.js';
import { type FhirVersion, versionedExpansionCacheKey } from './valueset-expansion-cache-key.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';
import { canDelegateValueSetExpansion } from './valueset-delegation-policy.js';
import { getTerminologyServerScope } from './terminology-server-scope.js';

export function resolveTerminologyServerForSystem(
  config: TerminologyResolutionConfig,
  system?: string,
  codeSystemVersion?: string,
  fhirVersion?: FhirVersion,
): TerminologyServerOverride | undefined {
  if (!system) return undefined;
  const servers = config.servers;
  if (!servers || servers.length === 0) return undefined;

  const requestedSnomedEdition = system === 'http://snomed.info/sct'
    ? extractSnomedEditionIdentifier(codeSystemVersion)
    : undefined;
  const editionMatch = requestedSnomedEdition
    ? servers.find(server =>
        isTerminologyServerEligible(server, fhirVersion)
        && server.snomedEditions?.some(edition =>
          extractSnomedEditionIdentifier(edition) === requestedSnomedEdition))
    : undefined;
  const scopedMatch = requestedSnomedEdition
    ? editionMatch
    : servers.find(s =>
        isTerminologyServerEligible(s, fhirVersion)
        && s.preferredSystems
        && s.preferredSystems.includes(system));
  const match = scopedMatch ?? (requestedSnomedEdition
    ? undefined
    : findGenericReleaseFallback(config, fhirVersion));
  if (!match) return undefined;

  logger.debug('[ValueSetValidator] Scope-routed terminology request', {
    ...terminologyTargetMetadata(system, match.url),
    serverId: match.id,
    ...(requestedSnomedEdition ? { snomedEdition: requestedSnomedEdition } : {}),
  });
  return {
    url: match.url,
    auth: match.authConfig,
    ...(editionMatch === match ? { authoritativeSnomedEdition: true } : {}),
  };
}

export function isSnomedEditionRouteMissing(
  system?: string,
  codeSystemVersion?: string,
  override?: TerminologyServerOverride,
): boolean {
  return system === 'http://snomed.info/sct'
    && extractSnomedEditionIdentifier(codeSystemVersion) !== undefined
    && override?.authoritativeSnomedEdition !== true;
}

function findGenericReleaseFallback(
  config: TerminologyResolutionConfig,
  fhirVersion?: FhirVersion,
): TerminologyServerDescriptor | undefined {
  if (!fhirVersion) return undefined;
  const servers = config.servers ?? [];
  const defaultDescriptor = config.serverUrl
    ? servers.find(server => server.url === config.serverUrl)
    : undefined;
  if (config.serverUrl && (!defaultDescriptor || isTerminologyServerEligible(defaultDescriptor, fhirVersion))) {
    return undefined;
  }
  return servers.find(server =>
    isTerminologyServerEligible(server, fhirVersion)
    && (server.preferredSystems?.length ?? 0) === 0);
}

/**
 * Every other eligible server for the release, in settings order, for a
 * check the routed server could not answer. Coverage differs per server: a
 * licensed VSAC value set is unknown to one public server and known to the
 * next. A SNOMED edition request only falls back to servers declaring that
 * edition, so an authoritative answer never comes from another edition.
 */
export function listFallbackTerminologyServers(
  config: TerminologyResolutionConfig,
  primary: { url: string } | undefined,
  system?: string,
  codeSystemVersion?: string,
  fhirVersion?: FhirVersion,
): TerminologyServerOverride[] {
  const skippedUrls = new Set<string>();
  if (primary?.url) {
    skippedUrls.add(primary.url);
  } else if (config.serverUrl) {
    skippedUrls.add(config.serverUrl);
  }

  const requestedEdition = system === 'http://snomed.info/sct'
    ? extractSnomedEditionIdentifier(codeSystemVersion)
    : undefined;
  return (config.servers ?? [])
    .filter(server => isTerminologyServerEligible(server, fhirVersion) && Boolean(server.url))
    .filter(server => !skippedUrls.has(server.url))
    .filter(server => !requestedEdition || server.snomedEditions?.some(edition =>
      extractSnomedEditionIdentifier(edition) === requestedEdition))
    .map(server => ({
      url: server.url,
      auth: server.authConfig,
      ...(requestedEdition ? { authoritativeSnomedEdition: true } : {}),
    }));
}

export function extractSnomedEditionIdentifier(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (/^\d+$/.test(normalized)) return normalized;
  return normalized.match(/^https?:\/\/snomed\.info\/sct\/(\d+)(?:\/version\/\d{8})?\/?$/i)?.[1];
}

export function isTerminologyServerEligible(
  server: TerminologyServerDescriptor,
  fhirVersion?: FhirVersion,
): boolean {
  return server.enabled
    && !server.circuitOpen
    && (!fhirVersion || server.fhirVersions?.includes(fhirVersion) === true);
}

export function hasTerminologyServer(
  config: TerminologyResolutionConfig,
  override?: { url: string },
  fhirVersion?: FhirVersion,
): boolean {
  const serverUrl = override?.url ?? config.serverUrl;
  if (!serverUrl) return Boolean(findGenericReleaseFallback(config, fhirVersion));
  if (!fhirVersion) return true;

  const descriptor = config.servers?.find(server => server.url === serverUrl);
  if (!descriptor || isTerminologyServerEligible(descriptor, fhirVersion)) return true;
  return !override && Boolean(findGenericReleaseFallback(config, fhirVersion));
}

export function getScopedExpansionCacheKey(
  valueSetUrl: string,
  config: TerminologyResolutionConfig,
  fhirVersion?: FhirVersion,
): string {
  const baseKey = versionedExpansionCacheKey(valueSetUrl, fhirVersion);
  const defaultServerScope = config.serverUrl
    ? getTerminologyServerScope(config.serverUrl, config.auth)
    : 'no-server';
  const serverScope = [
    config.strategy,
    defaultServerScope,
    canDelegateValueSetExpansion(config) ? 'expand-on' : 'expand-off',
    ...(config.servers ?? []).map(server => [
      server.id,
      getTerminologyServerScope(server.url, server.authConfig),
      server.enabled ? 'on' : 'off',
      [...(server.fhirVersions ?? [])].sort().join(','),
      [...(server.preferredSystems ?? [])].sort().join(','),
      [...(server.snomedEditions ?? [])].sort().join(','),
    ].join(':')),
  ].join('|');

  return `${baseKey}|${serverScope}`;
}
