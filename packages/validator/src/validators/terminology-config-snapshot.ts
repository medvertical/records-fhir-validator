import type {
  TerminologyApiAuthConfig,
  TerminologyResolutionConfig,
  TerminologyServerDescriptor,
} from './valueset-types.js';

function cloneAuth(auth: TerminologyApiAuthConfig | undefined): TerminologyApiAuthConfig | undefined {
  return auth ? { ...auth } : undefined;
}

function cloneServer(server: TerminologyServerDescriptor): TerminologyServerDescriptor {
  return {
    ...server,
    fhirVersions: [...server.fhirVersions],
    preferredSystems: server.preferredSystems ? [...server.preferredSystems] : undefined,
    snomedEditions: server.snomedEditions ? [...server.snomedEditions] : undefined,
    authConfig: cloneAuth(server.authConfig),
  };
}

function snapshotCodeSystemDefaults(value: Record<string, string> | undefined): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError('CodeSystem default versions require a plain canonical-to-version map');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > 64) throw new TypeError('CodeSystem default versions exceed 64 systems');
  const entries: Array<[string, string]> = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor || !Object.hasOwn(descriptor, 'value')
      || !/^[A-Za-z][A-Za-z0-9+.-]*:[!-~]+$/.test(key) || key.includes('|') || key.length > 2048
      || typeof descriptor.value !== 'string' || !/^[!-~]+$/.test(descriptor.value)
      || descriptor.value.includes('|') || descriptor.value.length > 512) {
      throw new TypeError('CodeSystem default versions require exact canonical and business version strings');
    }
    entries.push([key, descriptor.value]);
  }
  if (entries.length === 0) return undefined;
  return Object.freeze(Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))));
}

export function resolveCodeSystemVersion(
  config: Pick<TerminologyResolutionConfig, 'defaultCodeSystemVersions'>,
  system: string | undefined,
  requestedVersion?: string,
): string | undefined {
  if (requestedVersion !== undefined || !system) return requestedVersion;
  const defaults = config.defaultCodeSystemVersions;
  const descriptor = defaults && Object.getOwnPropertyDescriptor(defaults, system);
  return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
    ? descriptor.value : undefined;
}

export function snapshotTerminologyConfig(
  config: TerminologyResolutionConfig,
): TerminologyResolutionConfig {
  return {
    ...config,
    defaultCodeSystemVersions: snapshotCodeSystemDefaults(config.defaultCodeSystemVersions),
    auth: cloneAuth(config.auth),
    servers: config.servers?.map(cloneServer),
    serverDelegation: config.serverDelegation ? { ...config.serverDelegation } : undefined,
    twoPhaseExpansion: config.twoPhaseExpansion ? { ...config.twoPhaseExpansion } : undefined,
  };
}

export function terminologyConfigsEqual(
  left: TerminologyResolutionConfig,
  right: TerminologyResolutionConfig,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function terminologyAuthConfigsEqual(
  left: TerminologyApiAuthConfig | undefined,
  right: TerminologyApiAuthConfig | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
