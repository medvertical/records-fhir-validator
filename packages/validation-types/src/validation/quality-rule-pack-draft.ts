import { z } from 'zod';

import {
  boundedQualityRuleId,
  boundedQualityRuleVersion,
  qualityAdvisoryRuleDefinitionSchema,
  qualityReferenceSetDefinitionSchema,
  qualityRuleDefinitionSchema,
  qualityRuleSourceSchema,
} from './quality-rule-pack.js';

/** Mutable authoring shape; immutable publication still requires one rule. */
export const qualityRulePackDraftManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: boundedQualityRuleId,
  version: boundedQualityRuleVersion,
  name: z.string().min(1).max(256),
  description: z.string().max(4_096).optional(),
  fhirVersions: z.array(z.enum(['R4', 'R4B', 'R5', 'R6'])).min(1).max(4),
  igPackages: z.array(z.object({
    packageId: boundedQualityRuleId,
    versionRange: z.string().min(1).max(128),
  }).strict()).max(64).default([]),
  referenceSets: z.array(qualityReferenceSetDefinitionSchema).max(64).optional(),
  source: qualityRuleSourceSchema,
  rules: z.array(qualityRuleDefinitionSchema).max(1_000).default([]),
  advisories: z.array(qualityAdvisoryRuleDefinitionSchema).max(1_000).default([]),
}).strict().superRefine((manifest, context) => {
  const ids = new Set<string>();
  for (const [index, rule] of manifest.rules.entries()) {
    if (ids.has(rule.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'id'],
        message: `Duplicate rule id: ${rule.id}`,
      });
    }
    ids.add(rule.id);
  }
  for (const [index, advisory] of manifest.advisories.entries()) {
    if (ids.has(advisory.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['advisories', index, 'id'],
        message: `Duplicate rule id: ${advisory.id}`,
      });
    }
    ids.add(advisory.id);
  }
});

export type QualityRulePackDraftManifest = z.infer<typeof qualityRulePackDraftManifestSchema>;

export interface QualityRulePackDraftTestSummary {
  observedResources: number;
  metricCount: number;
  passedMetrics: number;
  failedMetrics: number;
  notEvaluableMetrics: number;
  findingCount: number;
  truncatedFindingCount: number;
}

export function parseQualityRulePackDraftManifest(input: unknown): QualityRulePackDraftManifest {
  return qualityRulePackDraftManifestSchema.parse(input);
}
