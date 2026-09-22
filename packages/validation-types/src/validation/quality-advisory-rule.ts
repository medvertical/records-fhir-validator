import { z } from 'zod';
import {
  QUALITY_ADVISORY_ACTIONS,
  QUALITY_RULE_OUTCOMES,
  QUALITY_RULE_SCOPES,
  QUALITY_RULE_SEVERITIES,
  boundedQualityIssueToken,
  boundedQualityPath,
  boundedQualityResourceType,
  boundedQualityRuleId,
  qualityRuleSourceSchema,
} from './quality-rule-schema-foundations.js';

const qualityAdvisoryMatchSchema = z.object({
  codes: z.array(boundedQualityIssueToken).max(128).default([]),
  aspects: z.array(boundedQualityIssueToken).max(32).default([]),
  profiles: z.array(z.string().min(1).max(2_048)).max(64).default([]),
  packIds: z.array(boundedQualityRuleId).max(64).default([]),
  ruleIds: z.array(boundedQualityRuleId).max(128).default([]),
  categories: z.array(boundedQualityRuleId).max(64).default([]),
  scopes: z.array(z.enum(QUALITY_RULE_SCOPES)).max(4).default([]),
  severities: z.array(z.enum(QUALITY_RULE_SEVERITIES)).max(3).default([]),
  outcomes: z.array(z.enum(QUALITY_RULE_OUTCOMES)).max(3).default([]),
  resourceTypes: z.array(boundedQualityResourceType).max(64).default([]),
  pathContains: z.array(boundedQualityPath).max(32).default([]),
  messageContains: z.string().min(1).max(512).optional(),
}).strict().superRefine((match, context) => {
  const hasCriterion = Object.values(match).some(value => (
    Array.isArray(value) ? value.length > 0 : Boolean(value)
  ));
  if (!hasCriterion) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Advisory rules require at least one match criterion',
    });
  }
});

export const qualityAdvisoryRuleDefinitionSchema = z.object({
  id: boundedQualityRuleId,
  title: z.string().min(1).max(256),
  description: z.string().max(2_048).optional(),
  priority: z.number().int().min(-10_000).max(10_000).default(0),
  target: z.enum(['quality-finding', 'validation-issue']).default('quality-finding'),
  action: z.enum(QUALITY_ADVISORY_ACTIONS),
  match: qualityAdvisoryMatchSchema,
  transform: z.object({
    severity: z.enum(QUALITY_RULE_SEVERITIES).optional(),
    message: z.string().min(1).max(2_048).optional(),
  }).strict().optional(),
  reason: z.string().min(1).max(1_024),
  expiresAt: z.string().datetime().optional(),
  source: qualityRuleSourceSchema,
  limitations: z.array(z.string().min(1).max(1_024)).max(32).default([]),
}).strict().superRefine((rule, context) => {
  if (rule.action === 'override-severity' && !rule.transform?.severity) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['transform', 'severity'],
      message: 'Severity overrides require a target severity',
    });
  }
  if (rule.action === 'override-message' && !rule.transform?.message) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['transform', 'message'],
      message: 'Message overrides require a replacement message',
    });
  }
  const validationOnlyCriteria = [
    rule.match.codes.length,
    rule.match.aspects.length,
    rule.match.profiles.length,
  ].some(length => length > 0);
  const qualityOnlyCriteria = [
    rule.match.packIds.length,
    rule.match.categories.length,
    rule.match.scopes.length,
    rule.match.outcomes.length,
  ].some(length => length > 0);
  if (rule.target === 'quality-finding' && validationOnlyCriteria) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['match'],
      message: 'Quality-finding advisories cannot match validation-only code, aspect, or profile fields',
    });
  }
  if (rule.target === 'validation-issue' && qualityOnlyCriteria) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['match'],
      message: 'Validation-issue advisories cannot match quality-only pack, category, scope, or outcome fields',
    });
  }
});

export type QualityAdvisoryRuleDefinition = z.infer<typeof qualityAdvisoryRuleDefinitionSchema>;
