import { z } from 'zod';
import { qualityAdvisoryRuleDefinitionSchema } from './quality-advisory-rule.js';
import {
  QUALITY_ADVISORY_ACTIONS,
  QUALITY_FINDING_DISPOSITIONS,
  QUALITY_NORMATIVE_STATUSES,
  QUALITY_RULE_OUTCOMES,
  QUALITY_RULE_SCOPES,
  QUALITY_RULE_SEVERITIES,
  boundedQualityPath,
  boundedQualityResourceType,
  boundedQualityRuleId,
  qualityRuleSourceSchema,
} from './quality-rule-schema-foundations.js';
import { qualityThresholdSchema } from './quality-threshold.js';
export { qualityAdvisoryRuleDefinitionSchema } from './quality-advisory-rule.js';
export type { QualityAdvisoryRuleDefinition } from './quality-advisory-rule.js';
export { qualityPolicyLayerSchema, qualityRuleOverrideSchema } from './quality-policy-layer.js';
export type { QualityPolicyLayer, QualityRuleOverride } from './quality-policy-layer.js';
export {
  QUALITY_ADVISORY_ACTIONS,
  QUALITY_FINDING_DISPOSITIONS,
  QUALITY_NORMATIVE_STATUSES,
  QUALITY_RULE_OUTCOMES,
  QUALITY_RULE_SCOPES,
  QUALITY_RULE_SEVERITIES,
  boundedQualityRuleId,
  qualityRuleSourceSchema,
} from './quality-rule-schema-foundations.js';
export type QualityRuleScope = typeof QUALITY_RULE_SCOPES[number];
export type QualityRuleOutcome = typeof QUALITY_RULE_OUTCOMES[number];
export type QualityNormativeStatus = typeof QUALITY_NORMATIVE_STATUSES[number];
export type QualityRuleSeverity = typeof QUALITY_RULE_SEVERITIES[number];
export type QualityAdvisoryAction = typeof QUALITY_ADVISORY_ACTIONS[number];
export type QualityFindingDisposition = typeof QUALITY_FINDING_DISPOSITIONS[number];
export type QualityComparisonClass = 'common-baseline' | 'local-extension';
export const boundedQualityRuleVersion = z.string()
  .min(1)
  .max(64)
  .regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/);
const boundedExpression = z.string().min(1).max(4_096);
const boundedReferenceValue = z.string().min(1).max(512);
const supportedPackageVersionRange = z.string().min(1).max(128).refine(value => (
  value === '*'
  || /^[0-9]+(?:\.[0-9]+)?\.x$/.test(value)
  || (/^[0-9][0-9A-Za-z.+_-]*$/.test(value) && !/(^|\.)x($|\.)/.test(value))
), {
  message: 'Package version ranges must be *, an exact version, N.x, or N.N.x',
});
const profilePopulationSelectionSchema = z.object({
  mode: z.enum(['include-prefix', 'include-exact', 'exclude-prefix']),
  canonicals: z.array(z.string().url().max(2_048)).min(1).max(64)
    .refine(values => new Set(values).size === values.length, { message: 'Population canonicals must be unique' }),
}).strict();
const qualityApplicabilitySchema = z.object({
  resourceTypes: z.array(boundedQualityResourceType).max(64).default([]),
  fhirVersions: z.array(z.enum(['R4', 'R4B', 'R5', 'R6'])).max(4).default([]),
  profilesAny: z.array(z.string().url().max(2_048)).max(64).default([]),
  profileSelection: profilePopulationSelectionSchema.optional(),
  documentPopulation: z.literal('eu-laboratory-document').optional(),
}).strict().superRefine((applicability, context) => {
  if (applicability.documentPopulation && (applicability.resourceTypes.length !== 1 || applicability.resourceTypes[0] !== 'Bundle')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['documentPopulation'], message: 'Document populations require the Bundle resource type' });
  }
});
const presenceImplementationSchema = z.object({
  kind: z.literal('path-presence'),
  path: boundedQualityPath,
}).strict();

const booleanImplementationSchema = z.object({
  kind: z.literal('fhirpath-boolean'),
  expression: boundedExpression,
}).strict();

const referenceImplementationSchema = z.object({
  kind: z.literal('reference-exists'),
  paths: z.array(boundedQualityPath).min(1).max(32),
}).strict();

const cohortRateImplementationSchema = z.object({
  kind: z.literal('cohort-rate'),
  numeratorExpression: boundedExpression,
  denominatorExpression: boundedExpression.optional(),
}).strict();

const boundedTemporalPath = boundedQualityPath.refine(value => (
  /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*){0,11}$/.test(value)
  && !value.split('.').some(segment => ['__proto__', 'constructor', 'prototype'].includes(segment))
), { message: 'Temporal comparisons require bounded relative field paths without functions or array traversal' });
const cohortTemporalImplementationSchema = z.object({
  kind: z.literal('cohort-temporal-comparison'),
  leftPath: boundedTemporalPath,
  rightPaths: z.array(boundedTemporalPath).min(1).max(8).refine(paths => new Set(paths).size === paths.length,
    { message: 'Temporal comparison choice paths must be unique' }),
  nonTemporalRightPaths: z.array(boundedTemporalPath).max(8).optional(),
  operator: z.literal('not-before'),
  comparisonModel: z.literal('cql-execution-3.3.2-utc'),
}).strict();

const cohortDistributionImplementationSchema = z.object({
  kind: z.literal('cohort-distribution'),
  valueExpression: boundedExpression,
  maxStrata: z.number().int().min(1).max(512).default(100),
  valueMode: z.enum(['redacted', 'coded']).default('redacted'),
  codeSystem: z.string().url().max(2_048).optional(),
  observationMode: z.enum(['single-structured', 'coding-collection', 'fhir-primitive', 'json-array-container']).optional(),
  missingValuePolicy: z.enum(['not-evaluable', 'null-stratum']).optional(),
}).strict();

const uniquenessImplementationSchema = z.object({
  kind: z.literal('cohort-uniqueness'),
  valueExpression: boundedExpression,
}).strict();

const externalMembershipImplementationSchema = z.object({
  kind: z.literal('external-membership'),
  sourceId: boundedQualityRuleId,
  valueExpression: boundedExpression,
  missingValuePolicy: z.enum(['not-evaluable', 'non-member', 'member']).optional(),
  observationMode: z.enum(['single-codeable-concept', 'coding-collection', 'concept-collection-complement', 'fhir-primitive-code', 'first-coding-code']).optional(),
  codeSystem: z.string().url().max(2_048).optional(),
}).strict();

export const qualityRuleImplementationSchema = z.discriminatedUnion('kind', [
  presenceImplementationSchema,
  booleanImplementationSchema,
  referenceImplementationSchema,
  cohortRateImplementationSchema,
  cohortTemporalImplementationSchema,
  cohortDistributionImplementationSchema,
  uniquenessImplementationSchema,
  externalMembershipImplementationSchema,
]).superRefine((implementation, context) => {
  if (implementation.kind === 'cohort-temporal-comparison') {
    const choicePaths = [...implementation.rightPaths, ...implementation.nonTemporalRightPaths ?? []];
    if (new Set(choicePaths).size !== choicePaths.length) context.addIssue({ code: z.ZodIssueCode.custom,
      path: ['nonTemporalRightPaths'], message: 'Temporal and non-temporal choice paths must be unique' });
  }
  if (implementation.kind === 'cohort-distribution'
    && implementation.valueMode === 'coded'
    && !implementation.codeSystem) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['codeSystem'],
      message: 'Coded distributions require a declared code system',
    });
  }
  if (implementation.kind === 'cohort-distribution'
    && implementation.observationMode
    && implementation.valueMode !== 'redacted') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['valueMode'],
      message: 'Structured distributions must retain hash-only evidence',
    });
  }
  if (implementation.kind === 'cohort-distribution'
    && (implementation.observationMode === 'fhir-primitive' || implementation.observationMode === 'json-array-container')
    && (!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*){0,11}$/.test(implementation.valueExpression)
      || implementation.valueExpression.split('.').some(segment => ['__proto__', 'constructor', 'prototype'].includes(segment)))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['valueExpression'],
      message: `${implementation.observationMode === 'fhir-primitive' ? 'FHIR primitive' : 'JSON container'} observations require a bounded relative field path without functions or array traversal` });
  }
  if (implementation.kind === 'cohort-distribution' && implementation.observationMode === 'json-array-container'
    && implementation.missingValuePolicy !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['missingValuePolicy'],
      message: 'JSON array-container observations use Boolean false for missing/null containers, not a configurable missing-value policy' });
  }
  if (implementation.kind === 'external-membership'
    && (implementation.observationMode === 'fhir-primitive-code' || implementation.observationMode === 'first-coding-code')
    && (!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*){0,11}$/.test(implementation.valueExpression)
      || implementation.valueExpression.split('.').some(segment => ['__proto__', 'constructor', 'prototype'].includes(segment)))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['valueExpression'],
      message: 'FHIR code membership requires a bounded relative field path without functions or parent array traversal' });
  }
  if (implementation.kind === 'external-membership') {
    if (implementation.observationMode === 'first-coding-code') {
      if (!implementation.codeSystem) context.addIssue({ code: z.ZodIssueCode.custom, path: ['codeSystem'],
        message: 'First-coding-code membership requires an exact code-system filter' });
      if (!implementation.valueExpression.endsWith('.coding')) context.addIssue({ code: z.ZodIssueCode.custom,
        path: ['valueExpression'], message: 'First-coding-code membership requires a coding collection field path' });
    } else if (implementation.codeSystem !== undefined) context.addIssue({ code: z.ZodIssueCode.custom,
      path: ['codeSystem'], message: 'A code-system filter is only supported by first-coding-code membership' });
  }
});

export const qualityRuleDefinitionSchema = z.object({
  id: boundedQualityRuleId,
  title: z.string().min(1).max(256),
  description: z.string().max(2_048).optional(),
  category: boundedQualityRuleId,
  module: boundedQualityRuleId.optional(),
  scope: z.enum(QUALITY_RULE_SCOPES),
  severity: z.enum(QUALITY_RULE_SEVERITIES),
  normativeStatus: z.enum(QUALITY_NORMATIVE_STATUSES),
  comparisonClass: z.enum(['common-baseline', 'local-extension']).default('common-baseline'),
  enabledByDefault: z.boolean().optional(),
  applicability: qualityApplicabilitySchema,
  implementation: qualityRuleImplementationSchema,
  threshold: qualityThresholdSchema.optional(),
  evidencePaths: z.array(boundedQualityPath).max(32).default([]),
  findingMessage: z.string().min(1).max(2_048).optional(),
  source: qualityRuleSourceSchema,
  limitations: z.array(z.string().min(1).max(1_024)).max(32).default([]),
}).strict();

export const qualityReferenceSetDefinitionSchema = z.object({
  id: boundedQualityRuleId,
  name: z.string().min(1).max(256),
  caseSensitive: z.boolean().default(true),
  values: z.array(boundedReferenceValue).min(1).max(10_000),
  source: qualityRuleSourceSchema,
}).strict().superRefine((referenceSet, context) => {
  const normalized = new Set<string>();
  for (const [index, value] of referenceSet.values.entries()) {
    const key = referenceSet.caseSensitive ? value : value.toLocaleLowerCase('en-US');
    if (normalized.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['values', index],
        message: `Duplicate reference-set value: ${value}`,
      });
    }
    normalized.add(key);
  }
});

export const qualityRulePackManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: boundedQualityRuleId,
  version: boundedQualityRuleVersion,
  name: z.string().min(1).max(256),
  description: z.string().max(4_096).optional(),
  fhirVersions: z.array(z.enum(['R4', 'R4B', 'R5', 'R6'])).min(1).max(4),
  igPackages: z.array(z.object({
    packageId: boundedQualityRuleId,
    versionRange: supportedPackageVersionRange,
  }).strict()).max(64).default([]),
  referenceSets: z.array(qualityReferenceSetDefinitionSchema).max(64).optional(),
  source: qualityRuleSourceSchema,
  rules: z.array(qualityRuleDefinitionSchema).max(1_000).default([]),
  advisories: z.array(qualityAdvisoryRuleDefinitionSchema).max(1_000).optional(),
}).strict().superRefine((manifest, context) => {
  const ids = new Set<string>();
  const referenceSetIds = new Set<string>();
  let referenceValueCount = 0;
  for (const [index, referenceSet] of (manifest.referenceSets ?? []).entries()) {
    if (referenceSetIds.has(referenceSet.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceSets', index, 'id'],
        message: `Duplicate reference-set id: ${referenceSet.id}`,
      });
    }
    referenceSetIds.add(referenceSet.id);
    referenceValueCount += referenceSet.values.length;
  }
  if (referenceValueCount > 50_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['referenceSets'],
      message: 'Published packs may contain at most 50,000 reference-set values in total',
    });
  }
  for (const [index, rule] of manifest.rules.entries()) {
    if (ids.has(rule.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'id'],
        message: `Duplicate rule id: ${rule.id}`,
      });
    }
    ids.add(rule.id);
    if (rule.scope === 'resource'
      && rule.implementation.kind !== 'path-presence'
      && rule.implementation.kind !== 'fhirpath-boolean') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'implementation'],
        message: 'Resource rules require a resource implementation',
      });
    }
    if (rule.scope === 'reference-graph' && rule.implementation.kind !== 'reference-exists') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'implementation'],
        message: 'Reference-graph rules require reference-exists',
      });
    }
    if (rule.scope === 'cohort'
      && rule.implementation.kind !== 'cohort-rate'
      && rule.implementation.kind !== 'cohort-temporal-comparison'
      && rule.implementation.kind !== 'cohort-distribution'
      && rule.implementation.kind !== 'cohort-uniqueness') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'implementation'],
        message: 'Cohort rules require a cohort implementation',
      });
    }
    if (rule.implementation.kind === 'cohort-temporal-comparison'
      && (rule.applicability.fhirVersions.length !== 1 || rule.applicability.fhirVersions[0] !== 'R4')) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['rules', index, 'applicability', 'fhirVersions'],
        message: 'CQL reference date-time comparisons require explicit pinned FHIR R4 applicability' });
    }
    if (rule.implementation.kind === 'cohort-distribution' && rule.threshold) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'threshold'],
        message: 'Descriptive cohort distributions cannot define a pass/fail threshold',
      });
    }
    if (rule.scope === 'external-reference' && rule.implementation.kind !== 'external-membership') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'implementation'],
        message: 'External-reference rules require external-membership',
      });
    }
  }
  for (const [index, advisory] of (manifest.advisories ?? []).entries()) {
    if (ids.has(advisory.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['advisories', index, 'id'],
        message: `Duplicate rule id: ${advisory.id}`,
      });
    }
    ids.add(advisory.id);
  }
  if (ids.size === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rules'],
      message: 'Published packs require at least one assertion or advisory rule',
    });
  }
});

export type QualityRuleImplementation = z.infer<typeof qualityRuleImplementationSchema>;
export type QualityRuleDefinition = z.infer<typeof qualityRuleDefinitionSchema>;
export type QualityReferenceSetDefinition = z.infer<typeof qualityReferenceSetDefinitionSchema>;
export type QualityRulePackManifest = z.infer<typeof qualityRulePackManifestSchema>;

export function parseQualityRulePackManifest(input: unknown): QualityRulePackManifest {
  return qualityRulePackManifestSchema.parse(input);
}
