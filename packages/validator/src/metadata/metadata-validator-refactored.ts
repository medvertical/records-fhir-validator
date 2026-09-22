import type { ValidationIssue } from '@records-fhir/validation-types';
/**
 * Structural shape of the host's HAPI validation coordinator. The
 * full implementation lives server-side and depends on the HAPI
 * process pool; the engine only consumes the
 * `getIssuesByAspect()` lookup, so we keep the type local to avoid
 * pulling the coordinator's full surface (and its Java-runtime
 * dependencies) into the standalone package.
 */
interface HapiValidationCoordinator {
  getIssuesByAspect(resourceId: string, aspect: string): ValidationIssue[];
}
interface RecordsMetadataValidator {
  isAvailable(): boolean;
  validateMetadata(resource: unknown): Promise<ValidationIssue[]>;
}
import { logger } from '../logger.js';
import {
  getMetadataEngine,
  getStringField,
  isObjectRecord,
} from './metadata-boundary-utils.js';
import { createMetadataIssue } from './metadata-issue.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { LocalMetadataRulePipeline } from './metadata-local-rule-pipeline.js';

function buildInvalidResourceIssue(
  resource: unknown,
  resourceType: string,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
): ValidationIssue {
  return createMetadataIssue({
    code: 'metadata-invalid-resource',
    severity: 'error',
    message: 'Resource must be a valid JSON object',
    path: resourceType || 'Resource',
    humanReadable: 'Metadata validation requires a FHIR resource object',
    resourceType,
    validationMethod: 'metadata-resource-validation',
    schemaVersion: fhirVersion,
    details: {
      actualType: resource === null ? 'null' : Array.isArray(resource) ? 'array' : typeof resource,
    },
  });
}

async function loadRecordsMetadataValidator(): Promise<RecordsMetadataValidator | null> {
  try {
    // Lazy import to avoid circular dependency with records-validator. Keep the
    // explicit file target so Node ESM never treats the package dist directory as
    // a module entrypoint at runtime.
    const { recordsValidator } = await import('../index.js');
    return recordsValidator;
  } catch (error) {
    logger.warn(
      '[MetadataValidator] Records metadata engine unavailable; falling back to local metadata rules',
      validationFailureMetadata(error),
    );
    return null;
  }
}

async function validateWithRecordsMetadataValidator(resource: unknown): Promise<ValidationIssue[] | null> {
  const recordsValidator = await loadRecordsMetadataValidator();
  if (!recordsValidator) return null;

  try {
    if (!recordsValidator.isAvailable()) return null;

    logger.debug(`[MetadataValidator] Using Records validator...`);

    const metadataTimeout = 10000;
    const validationPromise = recordsValidator.validateMetadata(resource);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<ValidationIssue[]>((_, reject) => {
      timeoutId = setTimeout(() => {
        logger.warn(`[MetadataValidator] Metadata validation timeout after ${metadataTimeout}ms`);
        reject(new Error(`Metadata validation timeout after ${metadataTimeout}ms`));
      }, metadataTimeout);
    });

    try {
      return await Promise.race([validationPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  } catch (error) {
    logger.warn(
      '[MetadataValidator] Records metadata validation failed; falling back to local metadata rules',
      validationFailureMetadata(error),
    );
    return null;
  }
}

export class MetadataValidator {
  private readonly localRules = new LocalMetadataRulePipeline();

  async validate(
    resource: unknown,
    resourceType?: string,
    fhirVersion?: 'R4' | 'R5' | 'R6',
    coordinator?: HapiValidationCoordinator,
    settings?: unknown,
    profileUrl?: string
  ): Promise<ValidationIssue[]> {
    return this.validateInternal(
      resource,
      resourceType ?? getStringField(resource, 'resourceType') ?? 'Unknown',
      fhirVersion,
      coordinator,
      settings,
      profileUrl
    );
  }

  async validateInternal(
    resource: unknown,
    resourceType: string,
    _fhirVersion?: 'R4' | 'R5' | 'R6',
    coordinator?: HapiValidationCoordinator,
    settings?: unknown,
    profileUrl?: string
  ): Promise<ValidationIssue[]> {
    const startTime = Date.now();

    if (!isObjectRecord(resource)) {
      return [buildInvalidResourceIssue(resource, resourceType, _fhirVersion)];
    }

    logger.debug(`[MetadataValidator] Validating ${resourceType} resource metadata...`);

    try {
      // Local metadata checks are the default. Delegating back into the global
      // Records validator from inside Records validation is redundant and can
      // stall batch runs while initialization or fallback timers settle.
      const engine = getMetadataEngine(settings);

      if (engine === 'records') {
        const recordsIssues = await validateWithRecordsMetadataValidator(resource);
        if (recordsIssues) {
          return recordsIssues;
        }
      }

      if (coordinator) {
        const resourceId = `${
          getStringField(resource, 'resourceType') || resourceType
        }/${getStringField(resource, 'id') || 'unknown'}`;
        const coordinatorIssues = coordinator.getIssuesByAspect(resourceId, 'metadata');

        if (coordinatorIssues.length > 0) {
          logger.info(`[MetadataValidator] Using ${coordinatorIssues.length} issues from coordinator`);
          const validationTime = Date.now() - startTime;
          logger.info(
            `[MetadataValidator] Validated ${resourceType} metadata in ${validationTime}ms ` +
            `(${coordinatorIssues.length} issues, source: coordinator)`
          );
          return coordinatorIssues;
        }
      }

      return this.localRules.validate(
        resource,
        resourceType,
        _fhirVersion,
        profileUrl,
        startTime,
      );
    } catch (error) {
      logger.error('[MetadataValidator] Metadata validation failed', validationFailureMetadata(error));
      throw error;
    }
  }

  async validateProfileAccessibility(
    profiles: unknown,
    resourceType: string,
    _fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    if (!profiles || (Array.isArray(profiles) && profiles.length === 0)) {
      return issues;
    }

    if (!Array.isArray(profiles)) {
      return issues;
    }

    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      if (typeof profile !== 'string') {
        continue;
      }
    }

    return issues;
  }

}
