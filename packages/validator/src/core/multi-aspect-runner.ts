import { applyAdvisorRules, type AdvisorRule } from '../advisor/index.js';
import {
  applyPublicationEscalation,
  applyStrictnessByIssueAspect,
} from '../strictness/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { BatchValidationAbortedError } from './batch-validator.js';
import { withIssuesSchemaVersion } from './issue-schema-version.js';
import { attachAppliedProfile } from './multi-aspect-contained-validation.js';
import type { AspectResult } from './multi-aspect-types.js';
import { createValidationErrorIssue } from './validation-utils.js';

interface MultiAspectRunnerOptions {
  advisorRules: AdvisorRule[];
  attributeIssues?: (issues: ValidationIssue[], executor: string) => ValidationIssue[];
  aspectSeverityFor: Parameters<typeof applyStrictnessByIssueAspect>[2];
  collectedAspects: AspectResult[];
  fhirVersion: 'R4' | 'R5' | 'R6';
  forPublication: boolean;
  profileUrl: string;
  strictness: Parameters<typeof applyStrictnessByIssueAspect>[1];
  throwIfStopped: () => void;
}

/** Apply the common stop, policy, schema, timing, and failure contract for one aspect. */
export function createMultiAspectRunner(options: MultiAspectRunnerOptions) {
  return async (name: string, validate: () => Promise<ValidationIssue[]>): Promise<void> => {
    const {
      advisorRules,
      attributeIssues,
      aspectSeverityFor,
      collectedAspects,
      fhirVersion,
      forPublication,
      profileUrl,
      strictness,
      throwIfStopped,
    } = options;
    throwIfStopped();
    const aspectStart = Date.now();
    try {
      const validated = (await validate()).map(issue => attachAppliedProfile(issue, profileUrl));
      const attributed = attributeIssues ? attributeIssues(validated, name) : validated;
      const rawIssues = attributed.map(issue => ({
        ...issue,
        rawSeverity: issue.rawSeverity ?? issue.severity,
        rawMessage: issue.rawMessage ?? issue.message,
      }));
      throwIfStopped();
      const afterStrictness = applyStrictnessByIssueAspect(rawIssues, strictness, aspectSeverityFor, name);
      const governed = applyAdvisorRules(afterStrictness, advisorRules);
      throwIfStopped();
      const issues = withIssuesSchemaVersion(
        applyPublicationEscalation(governed.resultIssues, forPublication),
        fhirVersion,
      );
      const evidenceIssues = withIssuesSchemaVersion(
        applyPublicationEscalation(governed.evidenceIssues, forPublication),
        fhirVersion,
      );
      throwIfStopped();
      collectedAspects.push({
        aspect: name,
        issues,
        evidenceIssues,
        validationTime: Date.now() - aspectStart,
        isValid: issues.every(issue => issue.severity !== 'error' && issue.severity !== 'fatal'),
      });
    } catch (error: unknown) {
      if (error instanceof BatchValidationAbortedError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      collectedAspects.push({
        aspect: name,
        issues: withIssuesSchemaVersion(
          [createValidationErrorIssue(name, 'internal-error', message)],
          fhirVersion,
        ),
        validationTime: Date.now() - aspectStart,
        isValid: false,
      });
    }
  };
}
