import { logger } from '../logger';
import type { TerminologyResolutionConfig, TerminologyServerOverride } from './valueset-types';
import { type FhirVersion, versionedExpansionCacheKey } from './valueset-expansion-cache-key';

export function resolveTerminologyServerForSystem(
  config: TerminologyResolutionConfig,
  system?: string,
): TerminologyServerOverride | undefined {
  if (!system) return undefined;
  const servers = config.servers;
  if (!servers || servers.length === 0) return undefined;

  const match = servers.find(s =>
    s.enabled
    && !s.circuitOpen
    && s.preferredSystems
    && s.preferredSystems.includes(system),
  );
  if (!match) return undefined;

  logger.debug(`[ValueSetValidator] Scope-routed ${system} → ${match.id} (${match.url})`);
  return {
    url: match.url,
    auth: match.authConfig,
  };
}

export function hasTerminologyServer(
  config: TerminologyResolutionConfig,
  override?: { url: string },
): boolean {
  return Boolean(override?.url || config.serverUrl);
}

export function getScopedExpansionCacheKey(
  valueSetUrl: string,
  config: TerminologyResolutionConfig,
  fhirVersion?: FhirVersion,
): string {
  const baseKey = versionedExpansionCacheKey(valueSetUrl, fhirVersion);
  const serverScope = [
    config.strategy,
    config.serverUrl ?? 'no-server',
    ...(config.servers ?? []).map(server => [
      server.id,
      server.url,
      server.enabled ? 'on' : 'off',
      server.authConfig?.type ?? 'none',
    ].join(':')),
  ].join('|');

  return `${baseKey}|${serverScope}`;
}
