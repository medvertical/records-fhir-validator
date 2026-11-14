import fhirpath from 'fhirpath';
import { z } from 'zod';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { getFhirPathModel } from '../core/fhirpath-context.js';
import { isFhirResource, isRecord } from '../core/fhir-resource.js';
import { isCalendarDate, profileBusinessDate } from './profile-business-date.js';
import { FhirPathDecimalInput } from './fhirpath-decimal-input.js';

const calendarDate = z.string().refine(isCalendarDate, 'A complete calendar date is required');
const contextSchema = z.object({
  packages: z.array(z.string().regex(/^[^#]+#[^#]+$/)).min(1),
  validFrom: calendarDate.optional(), validTill: calendarDate.optional(),
}).strict();
const policySchema = z.object({
  id: z.string().min(1), version: z.string().min(1), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  fhirVersion: z.enum(['R4', 'R5', 'R6']), timeZone: z.string().min(1), selectedContext: z.string().min(1),
  contexts: z.record(z.string(), contextSchema), rules: z.array(z.object({
    profile: z.string().regex(/^[^|]+\|[^|]+$/), dateExpression: z.string().min(1),
    dateScope: z.enum(['resource', 'enclosing-bundle']).optional(),
    contexts: z.array(z.string()).min(1),
  }).strict()).min(1),
}).strict();

export type ProfileDatePolicy = z.infer<typeof policySchema>;
type PolicyRule = ProfileDatePolicy['rules'][number];
type Compiled = ReturnType<typeof fhirpath.compile<{ async: false }>>;

/** Optional package-context policy; no E-Rezept dates are hard-coded into FHIR. */
export class ProfileDatePolicyValidator {
  private readonly policy: ProfileDatePolicy;
  private readonly compiled = new Map<string, Compiled>();
  private readonly packagePins: Readonly<Record<string, string>>;

  constructor(policy: ProfileDatePolicy, packagePins: Readonly<Record<string, string>> = {}) {
    this.policy = policySchema.parse(policy);
    this.packagePins = { ...packagePins };
    new Intl.DateTimeFormat('en', { timeZone: this.policy.timeZone });
    const selected = this.policy.contexts[this.policy.selectedContext];
    if (!selected) throw new Error('Selected profile-date context is absent');
    for (const context of Object.values(this.policy.contexts)) {
      if (context.validFrom && context.validTill && context.validFrom > context.validTill) {
        throw new Error('Profile-date context has an inverted interval');
      }
    }
    for (const identity of selected.packages) {
      const [name, version] = identity.split('#');
      if (packagePins[name] !== version) throw new Error('Profile-date context does not match pinned packages');
    }
    const profiles = new Set<string>();
    for (const rule of this.policy.rules) {
      if (profiles.has(rule.profile)) throw new Error('Duplicate profile-date rule');
      profiles.add(rule.profile);
      if (rule.contexts.some(id => !this.policy.contexts[id])) throw new Error('Profile-date rule names an unknown context');
      this.compiled.set(rule.profile, fhirpath.compile(rule.dateExpression,
        getFhirPathModel(this.policy.fhirVersion), { async: false }));
    }
  }

  validate(resource: unknown, profileUrl: string, version: 'R4' | 'R5' | 'R6', enclosingBundle?: unknown): ValidationIssue[] {
    if (!isFhirResource(resource) || !isRecord(resource.meta) || !Array.isArray(resource.meta.profile)) return [];
    const declaredProfiles = resource.meta.profile;
    const canonical = profileUrl.split('|')[0];
    const rules = this.policy.rules.filter(rule => rule.profile.split('|')[0] === canonical
      && declaredProfiles.includes(rule.profile));
    return rules.flatMap(rule => this.evaluateRule(resource, rule, version, enclosingBundle));
  }

  private evaluateRule(resource: { resourceType: string }, rule: PolicyRule, version: 'R4' | 'R5' | 'R6', enclosingBundle?: unknown): ValidationIssue[] {
    if (version !== this.policy.fhirVersion) return [this.issue(resource.resourceType, rule, 'model-mismatch', true)];
    const evaluationRoot = rule.dateScope === 'enclosing-bundle' && resource.resourceType !== 'Bundle'
      ? enclosingBundle : resource;
    if (!isFhirResource(evaluationRoot)) return [this.issue(resource.resourceType, rule, 'context-resource-unavailable', true)];
    let values: unknown;
    try { values = this.compiled.get(rule.profile)!(new FhirPathDecimalInput(version).project(evaluationRoot), {}, { traceFn() {} }); }
    catch { return [this.issue(resource.resourceType, rule, 'date-expression-unexecuted', true)]; }
    if (!Array.isArray(values) || values.length !== 1) {
      return [this.issue(resource.resourceType, rule, Array.isArray(values) && values.length === 0
        ? 'date-missing' : 'date-ambiguous', true)];
    }
    const date = profileBusinessDate(values[0], this.policy.timeZone);
    if (date === null) return [this.issue(resource.resourceType, rule, 'date-uninterpretable', true)];
    const eligible = rule.contexts.filter(id => {
      const context = this.policy.contexts[id];
      return (!context.validFrom || date >= context.validFrom) && (!context.validTill || date <= context.validTill);
    });
    if (!eligible.length) return [this.issue(resource.resourceType, rule, 'outside-validity', false)];
    const selected = this.policy.contexts[this.policy.selectedContext];
    const selectedDateApplies = (!selected.validFrom || date >= selected.validFrom)
      && (!selected.validTill || date <= selected.validTill);
    const packageContextApplies = eligible.includes(this.policy.selectedContext) || eligible.some(id =>
      this.policy.contexts[id].packages.every(identity => {
        const [name, pinnedVersion] = identity.split('#');
        return this.packagePins[name] === pinnedVersion;
      }));
    if (!selectedDateApplies || !packageContextApplies) {
      return [this.issue(resource.resourceType, rule, 'selected-context-not-applicable', true)];
    }
    return [];
  }

  private issue(resourceType: string, rule: PolicyRule, reason: string, incomplete: boolean): ValidationIssue {
    return createValidationIssue({
      code: incomplete ? 'profile-date-policy-incomplete' : 'profile-date-outside-validity',
      path: `${resourceType}.meta.profile`, resourceType, profile: rule.profile,
      severityOverride: incomplete ? 'information' : 'error', aspectOverride: 'profile',
      ruleId: `${this.policy.id}:profile-date`,
      customMessage: incomplete ? 'The profile validity period could not be checked in the selected package context'
        : 'The business date is outside the configured validity periods for the declared profile version',
      details: { reason, dateExpression: rule.dateExpression,
        policy: { id: this.policy.id, version: this.policy.version, sourceSha256: this.policy.sourceSha256,
          fhirVersion: this.policy.fhirVersion, timeZone: this.policy.timeZone, selectedContext: this.policy.selectedContext },
        ...(incomplete ? { validationStatus: 'incomplete', validationComplete: false } : {}),
      },
    });
  }
}
