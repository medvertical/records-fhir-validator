import { z } from 'zod';

import { boundedQualityRuleId } from './quality-rule-schema-foundations.js';

export const EXTERNAL_QUALITY_SOURCE_STATES = [
  'ready',
  'checking',
  'update-available',
  'up-to-date',
  'blocked-license',
  'blocked-parse',
  'unreachable',
] as const;

export const EXTERNAL_QUALITY_LICENSE_STATUSES = [
  'verified',
  'permission-recorded',
  'missing',
  'incompatible',
] as const;

const httpsUrl = z.string().url().max(2_048).refine(
  (value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  },
  'External quality sources require HTTPS',
);
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const externalQualitySourceSchema = z.object({
  schemaVersion: z.literal(1),
  id: boundedQualityRuleId,
  providerType: z.enum(['git']),
  providerName: z.string().min(1).max(256),
  repositoryUrl: httpsUrl,
  sourceSubpath: z.string().min(1).max(512),
  trackingRef: z.string().min(1).max(256),
  state: z.enum(EXTERNAL_QUALITY_SOURCE_STATES),
  statusDetail: z.string().min(1).max(1_024),
  resolvedCommitSha: z.string().regex(/^[0-9a-f]{40}$/),
  sourceContentHash: sha256,
  adapter: z.object({
    id: boundedQualityRuleId,
    version: z.string().min(1).max(64),
  }).strict(),
  license: z.object({
    status: z.enum(EXTERNAL_QUALITY_LICENSE_STATUSES),
    reference: httpsUrl.optional(),
    detail: z.string().min(1).max(1_024).optional(),
  }).strict(),
  inventory: z.object({
    activeChecks: z.number().int().nonnegative(),
    modules: z.number().int().nonnegative(),
    native: z.number().int().nonnegative(),
    external: z.number().int().nonnegative(),
    catalogOnly: z.number().int().nonnegative(),
  }).strict().superRefine((inventory, context) => {
    const classified = inventory.native + inventory.external + inventory.catalogOnly;
    if (classified !== inventory.activeChecks) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['activeChecks'],
        message: 'Execution coverage must classify every active upstream check',
      });
    }
  }),
  lastCheckedAt: z.string().datetime(),
  lastSuccessfulImportAt: z.string().datetime().nullable(),
}).strict();

export type ExternalQualitySource = z.infer<typeof externalQualitySourceSchema>;
export type ExternalQualitySourceState = typeof EXTERNAL_QUALITY_SOURCE_STATES[number];
export type ExternalQualityLicenseStatus = typeof EXTERNAL_QUALITY_LICENSE_STATUSES[number];

export function parseExternalQualitySource(input: unknown): ExternalQualitySource {
  return externalQualitySourceSchema.parse(input);
}
