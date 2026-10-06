import { z } from 'zod';

export const ServerStatusSchema = z.enum([
  'healthy', 'degraded', 'unhealthy', 'circuit-open', 'unknown',
]);

export const TerminologyAuthConfigSchema = z.object({
  type: z.enum(['none', 'basic', 'bearer', 'oauth2', 'mtls']),
  username: z.string().optional(),
  password: z.string().optional(),
  token: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  scope: z.string().optional(),
  tokenUrl: z.string().optional(),
  clientCert: z.string().optional(),
  clientCertPath: z.string().optional(),
  clientKey: z.string().optional(),
  clientKeyPath: z.string().optional(),
  caCert: z.string().optional(),
  caCertPath: z.string().optional(),
  passphrase: z.string().optional(),
  rejectUnauthorized: z.boolean().optional(),
});

export const MiiTerminologyModeSchema = z.enum(['mii-local-blaze', 'mii-ontoserver', 'mii-hybrid']);

export const MiiValidationSettingsSchema = z.object({
  preset: z.enum(['mii-2026', 'ehds-2026']),
  terminologyMode: MiiTerminologyModeSchema,
  packageLockHash: z.string().optional(),
  maxOntoserverRequestsPerRun: z.number().int().positive().optional(),
  allowHighVolumeOntoserver: z.boolean().optional(),
});

export const TerminologyServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  enabled: z.boolean(),
  fhirVersions: z.array(z.enum(['R4', 'R5', 'R6'])),
  snapshotId: z.string().trim().min(1).max(256).optional(),
  status: ServerStatusSchema,
  failureCount: z.number().default(0),
  lastFailureTime: z.number().nullable().default(null),
  circuitOpen: z.boolean().default(false),
  responseTimeAvg: z.number().default(0),
  lastTested: z.number().nullable().optional(),
  testScore: z.number().optional(),
  authConfig: TerminologyAuthConfigSchema.optional(),
  preferredSystems: z.array(z.string()).optional(),
  snomedEditions: z.array(z.string().trim().min(1)).optional(),
});

export const CircuitBreakerConfigSchema = z.object({
  failureThreshold: z.number(),
  resetTimeout: z.number(),
  halfOpenTimeout: z.number(),
});

export const AdvancedTerminologyConfigSchema = z.object({
  hierarchyValidation: z.object({
    enabled: z.boolean(),
    contextMappings: z.record(z.string(), z.string()).optional(),
  }),
  eclValidation: z.object({
    enabled: z.boolean(),
    customExpressions: z.record(z.string(), z.string()).optional(),
  }),
  crossMappingValidation: z.object({
    enabled: z.boolean(),
    strictness: z.enum(['warn', 'error']),
    checkPairs: z.array(z.object({
      sourceSystem: z.string(),
      targetSystem: z.string(),
    })).optional(),
  }),
});

export const TerminologyResolutionSchema = z.object({
  strategy: z.enum(['local-first', 'server-first', 'local-only']),
  serverDelegation: z.object({
    expandValueSets: z.boolean(),
    validateCodes: z.boolean(),
    cacheResults: z.boolean(),
    cacheTTLSeconds: z.number(),
    requestTimeoutMs: z.number().optional(),
    slowResponseThresholdMs: z.number().optional(),
    maxRemoteCodeSystemValidations: z.number().optional(),
  }).optional(),
  twoPhaseExpansion: z.object({
    enabled: z.boolean(),
    mode: z.enum(['shadow', 'enforce']),
    logMismatches: z.boolean().optional(),
  }).optional(),
  // An explicit edition pin can establish authority for an unversioned code query.
  defaultCodeSystemVersions: z.record(
    z.string().max(2048).regex(/^[a-z][a-z0-9+.-]*:[^\s|]+$/i).regex(/^[\x21-\x7e]+$/),
    z.string().min(1).max(512).regex(/^[\x21-\x7e]+$/).refine(value => !value.includes('|')),
  ).refine(value => Object.keys(value).length <= 64).optional(),
  unknownCodeBehavior: z.enum(['required-closed', 'all-open', 'all-closed']).optional(),
  reportUnverifiedBindings: z.boolean().optional(),
  strictUnverifiedRequiredBindings: z.boolean().optional(),
});
