import { z } from 'zod';
import { QUALITY_RULE_SEVERITIES } from './quality-rule-schema-foundations.js';
import { qualityThresholdSchema } from './quality-threshold.js';

const packReferenceSchema = z.string()
  .min(3)
  .max(193)
  .regex(/^[a-z0-9][a-z0-9._-]*@[0-9A-Za-z][0-9A-Za-z.+_-]*$/);
const ruleOverrideKeySchema = z.string()
  .min(3)
  .max(322)
  .regex(/^[a-z0-9][a-z0-9._-]*@[0-9A-Za-z][0-9A-Za-z.+_-]*:[a-z0-9][a-z0-9._-]*$/);

export const qualityRuleOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  severity: z.enum(QUALITY_RULE_SEVERITIES).optional(),
  threshold: qualityThresholdSchema.optional(),
  waiver: z.object({
    reason: z.string().min(1).max(1_024),
    expiresAt: z.string().datetime(),
  }).strict().optional(),
}).strict().refine(value => Object.keys(value).length > 0, {
  message: 'Rule overrides require at least one setting',
});

export const qualityPolicyLayerSchema = z.object({
  qualityAssessmentEnabled: z.boolean().optional(),
  commonPacks: z.array(packReferenceSchema).max(128).optional(),
  localPacks: z.array(packReferenceSchema).max(128).optional(),
  disabledPacks: z.array(packReferenceSchema).max(128).optional(),
  ruleOverrides: z.record(ruleOverrideKeySchema, qualityRuleOverrideSchema).optional(),
}).strict().superRefine((policy, context) => {
  const directives = [
    ['commonPacks', new Set(policy.commonPacks ?? [])],
    ['localPacks', new Set(policy.localPacks ?? [])],
    ['disabledPacks', new Set(policy.disabledPacks ?? [])],
  ] as const;
  for (let left = 0; left < directives.length; left++) {
    for (let right = left + 1; right < directives.length; right++) {
      for (const packRef of directives[left][1]) {
        if (directives[right][1].has(packRef)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [directives[right][0]],
            message: `Pack ${packRef} has conflicting directives in one policy layer`,
          });
        }
      }
    }
  }
});

export type QualityRuleOverride = z.infer<typeof qualityRuleOverrideSchema>;
export type QualityPolicyLayer = z.infer<typeof qualityPolicyLayerSchema>;
