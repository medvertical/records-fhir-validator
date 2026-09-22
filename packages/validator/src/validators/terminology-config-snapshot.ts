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

export function snapshotTerminologyConfig(
  config: TerminologyResolutionConfig,
): TerminologyResolutionConfig {
  return {
    ...config,
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
