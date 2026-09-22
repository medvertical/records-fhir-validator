import { applyAdvisorRules, type AdvisorRule } from '../advisor/index.js';
import {
  applyPublicationEscalation,
  applyStrictnessByIssueAspect,
  isForPublication,
  resolveStrictnessConfig,
} from '../strictness/index.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { normalizeIssuesByAspect } from './multi-aspect-issue-normalization.js';
import { createMultiAspectRunner } from './multi-aspect-runner.js';
import type { AspectResult, MultiAspectValidateResult } from './multi-aspect-types.js';
import { shouldRunCustomRules, shouldValidateBundleEntryResources } from './validation-settings-predicates.js';
import type { StructureDefinition } from './structure-definition-types.js';

interface MultiAspectSessionRunnerOptions {
  collectedAspects: AspectResult[];
  attributeIssues?: (issues: ValidationIssue[], executor: string) => ValidationIssue[];
  fhirVersion: 'R4' | 'R5' | 'R6';
  profileUrl: string;
  throwIfStopped: () => void;
}

/** Owns settings-derived execution and result policy for one validation session. */
export class MultiAspectSessionPolicy {
  private readonly strictnessConfig: ReturnType<typeof resolveStrictnessConfig>;
  private readonly advisorRules: AdvisorRule[];
  private readonly forPublication: boolean;
  readonly validateBundleEntries: boolean;
  readonly runCustomRules: boolean;

  constructor(settings: ValidationSettings | undefined) {
    this.strictnessConfig = resolveStrictnessConfig(settings);
    this.advisorRules = settings?.advisorRules ?? [];
    this.forPublication = isForPublication(settings);
    this.validateBundleEntries = shouldValidateBundleEntryResources(settings);
    this.runCustomRules = shouldRunCustomRules(settings);
  }

  createRunner(options: MultiAspectSessionRunnerOptions): ReturnType<typeof createMultiAspectRunner> {
    return createMultiAspectRunner({
      advisorRules: this.advisorRules,
      attributeIssues: options.attributeIssues,
      aspectSeverityFor: this.strictnessConfig.aspectSeverityFor,
      collectedAspects: options.collectedAspects,
      fhirVersion: options.fhirVersion,
      forPublication: this.forPublication,
      profileUrl: options.profileUrl,
      strictness: this.strictnessConfig.strictness,
      throwIfStopped: options.throwIfStopped,
    });
  }

  buildResult(
    collectedAspects: AspectResult[],
    structureDef: StructureDefinition,
    profileFallbackIssue: ValidationIssue | null,
  ): MultiAspectValidateResult {
    const aspects = normalizeIssuesByAspect(collectedAspects);
    if (profileFallbackIssue) {
      const profileAspect = aspects.find(aspect => aspect.aspect === 'profile');
      if (profileAspect) profileAspect.isValid = false;
    }
    return { isValid: aspects.every(aspect => aspect.isValid), aspects, structureDef };
  }

  applyProfileIssuePolicies(issues: ValidationIssue[]): {
    resultIssues: ValidationIssue[]; evidenceIssues: ValidationIssue[];
  } {
    const rawIssues = issues.map(issue => ({ ...issue,
      rawSeverity: issue.rawSeverity ?? issue.severity, rawMessage: issue.rawMessage ?? issue.message,
    }));
    const afterStrictness = applyStrictnessByIssueAspect(
      rawIssues, this.strictnessConfig.strictness, this.strictnessConfig.aspectSeverityFor, 'profile',
    );
    const governed = applyAdvisorRules(afterStrictness, this.advisorRules);
    return {
      resultIssues: applyPublicationEscalation(governed.resultIssues, this.forPublication),
      evidenceIssues: applyPublicationEscalation(governed.evidenceIssues, this.forPublication),
    };
  }
}
