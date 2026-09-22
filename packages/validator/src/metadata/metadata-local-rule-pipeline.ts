import type { ValidationIssue } from '@records-fhir/validation-types';
import { logger } from '../logger.js';
import { validateRequiredMetadata } from './completeness-checker.js';
import { validateMetaField } from './meta-field-validator.js';
import { isObjectRecord, type FhirObject } from './metadata-boundary-utils.js';
import { MetadataFieldRuleSet } from './metadata-field-rule-set.js';
import { validateProvenanceChain } from './provenance-chain-validator.js';

type FhirVersion = 'R4' | 'R5' | 'R6';

/** Runs the local metadata rules after external-engine and coordinator resolution. */
export class LocalMetadataRulePipeline {
  private readonly fieldRules = new MetadataFieldRuleSet();

  validate(
    resource: FhirObject,
    resourceType: string,
    fhirVersion: FhirVersion | undefined,
    profileUrl: string | undefined,
    startedAt: number,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    issues.push(...validateMetaField(resource, resourceType, {
      missingSeverity: 'warning',
      schemaVersion: fhirVersion,
    }));
    issues.push(...validateRequiredMetadata(resource, resourceType));

    if (resourceType === 'Provenance') {
      issues.push(...validateProvenanceChain(resource));
    }

    const meta = isObjectRecord(resource.meta) ? resource.meta : null;
    if (!meta) return issues;

    issues.push(...this.fieldRules.validate(resource, meta, resourceType, profileUrl));

    const validationTime = Date.now() - startedAt;
    logger.info(
      `[MetadataValidator] Validated ${resourceType} metadata in ${validationTime}ms, found ${issues.length} issues`,
    );
    return issues;
  }
}
