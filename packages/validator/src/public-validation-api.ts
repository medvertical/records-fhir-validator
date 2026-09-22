import type { BatchValidationOptions } from './core/batch-validator.js';
import type { FhirClientLike } from './core/profile-loader-utils.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { computeValidationIssueId } from '@records-fhir/validation-types';
import { createSafeValidationFailureMessage } from './utils/validation-execution-failure.js';

type InternalFhirVersion = 'R4' | 'R5' | 'R6';

/**
 * Public-API FHIR version literal. R4B is accepted on every entry point and
 * routed to the explicit R4 maintenance adapter while retaining its package
 * identity through resolveFhirReleaseContext().
 */
export type PublicFhirVersion = 'R4' | 'R4B' | 'R5' | 'R6';

export interface FhirReleaseContext {
  publicVersion: PublicFhirVersion;
  engineVersion: InternalFhirVersion;
  corePackage: string;
  fhirPathModel: 'r4' | 'r5';
  compatibilityMode: 'native' | 'r4b-maintenance-adapter';
}

/**
 * Preserve the selected release and make the R4B compatibility boundary
 * machine-readable instead of silently flattening it to R4.
 */
export function resolveFhirReleaseContext(v: PublicFhirVersion): FhirReleaseContext {
  if (v === 'R4B') {
    return {
      publicVersion: 'R4B',
      engineVersion: 'R4',
      corePackage: 'hl7.fhir.r4b.core#4.3.0',
      fhirPathModel: 'r4',
      compatibilityMode: 'r4b-maintenance-adapter',
    };
  }
  return {
    publicVersion: v,
    engineVersion: v,
    corePackage: v === 'R4'
      ? 'hl7.fhir.r4.core#4.0.1'
      : v === 'R5'
        ? 'hl7.fhir.r5.core#5.0.0'
        : 'hl7.fhir.r6.core#6.0.0-ballot4',
    fhirPathModel: v === 'R4' ? 'r4' : 'r5',
    compatibilityMode: 'native',
  };
}

/** Map a public-API FHIR version to the internal validator's accepted version. */
export function toInternalFhirVersion(v: PublicFhirVersion): InternalFhirVersion {
  return resolveFhirReleaseContext(v).engineVersion;
}

export interface PublicValidationRequest {
  resource: unknown;
  profileUrl?: string;
  fhirVersion?: PublicFhirVersion;
  settings?: ValidationSettings;
  fhirClient?: FhirClientLike;
}

export type PublicValidationInput = unknown | PublicValidationRequest;

export interface PublicBatchValidationOptions {
  profileUrl?: string;
  fhirVersion?: PublicFhirVersion;
  settings?: ValidationSettings;
  fhirClient?: FhirClientLike;
  maxConcurrency?: number;
  continueOnError?: boolean;
}

export interface PublicValidationResult {
  index: number;
  resource: unknown;
  resourceType?: string;
  id?: string;
  profileUrl?: string;
  fhirVersion: PublicFhirVersion;
  isValid: boolean;
  issues: ValidationIssue[];
}

export interface PublicValidationDeps {
  validate(
    resource: unknown,
    profileUrl: string | undefined,
    releaseContext: FhirReleaseContext,
    settings: ValidationSettings | undefined,
    fhirClient: FhirClientLike | undefined,
  ): Promise<ValidationIssue[]>;
  validateBatch(
    resources: unknown[],
    options: BatchValidationOptions,
    releaseContext: FhirReleaseContext,
  ): Promise<Map<unknown, ValidationIssue[]> | Map<unknown, unknown>>;
}

interface NormalizedValidationRequest extends Required<Pick<PublicValidationRequest, 'fhirVersion'>> {
  resource: unknown;
  profileUrl?: string;
  settings?: ValidationSettings;
  fhirClient?: FhirClientLike;
}

export function normalizeValidationRequests(
  inputs: PublicValidationInput[],
  options: PublicBatchValidationOptions = {},
): NormalizedValidationRequest[] {
  return inputs.map((input) => {
    if (isValidationRequest(input)) {
      return {
        resource: input.resource,
        profileUrl: input.profileUrl ?? options.profileUrl,
        fhirVersion: input.fhirVersion ?? options.fhirVersion ?? 'R4',
        settings: input.settings ?? options.settings,
        fhirClient: input.fhirClient ?? options.fhirClient,
      };
    }

    return {
      resource: input,
      profileUrl: options.profileUrl,
      fhirVersion: options.fhirVersion ?? 'R4',
      settings: options.settings,
      fhirClient: options.fhirClient,
    };
  });
}

export async function validateAllResources(
  deps: PublicValidationDeps,
  inputs: PublicValidationInput[],
  options: PublicBatchValidationOptions = {},
): Promise<PublicValidationResult[]> {
  const requests = normalizeValidationRequests(inputs, options);
  if (requests.length === 0) {
    return [];
  }

  if (canUseBatchValidation(requests)) {
    try {
      return await validateHomogeneousBatch(deps, requests, options);
    } catch (error) {
      if (!options.continueOnError) {
        throw error;
      }
    }
  }

  return validateIndividually(deps, requests, options);
}

function isValidationRequest(input: PublicValidationInput): input is PublicValidationRequest {
  return Boolean(
    input &&
    typeof input === 'object' &&
    'resource' in input &&
    !('resourceType' in input)
  );
}

function canUseBatchValidation(requests: NormalizedValidationRequest[]): boolean {
  const first = requests[0];
  return requests.every((request) =>
    request.profileUrl === first.profileUrl &&
    request.fhirVersion === first.fhirVersion &&
    request.settings === first.settings &&
    request.fhirClient === first.fhirClient
  );
}

async function validateHomogeneousBatch(
  deps: PublicValidationDeps,
  requests: NormalizedValidationRequest[],
  options: PublicBatchValidationOptions,
): Promise<PublicValidationResult[]> {
  const first = requests[0];
  const resources = requests.map((request) => request.resource);
  const releaseContext = resolveFhirReleaseContext(first.fhirVersion);
  const resultMap = await deps.validateBatch(resources, {
    profileUrl: first.profileUrl,
    fhirVersion: releaseContext.engineVersion,
    settings: first.settings,
    fhirClient: first.fhirClient,
    maxConcurrency: normalizeMaxConcurrency(options.maxConcurrency),
  }, releaseContext);

  return requests.map((request, index) =>
    createPublicValidationResult(request, index, getIssueList(resultMap, request.resource))
  );
}

function validateIndividually(
  deps: PublicValidationDeps,
  requests: NormalizedValidationRequest[],
  options: PublicBatchValidationOptions,
): Promise<PublicValidationResult[]> {
  return mapWithConcurrency(
    requests,
    normalizeMaxConcurrency(options.maxConcurrency),
    async (request, index) => {
      try {
        const issues = await deps.validate(
          request.resource,
          request.profileUrl,
          resolveFhirReleaseContext(request.fhirVersion),
          request.settings,
          request.fhirClient,
        );
        return createPublicValidationResult(request, index, issues);
      } catch (error) {
        if (!options.continueOnError) {
          throw error;
        }
        return createPublicValidationResult(request, index, [
          createValidationExecutionErrorIssue(index),
        ]);
      }
    },
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(maxConcurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
}

function normalizeMaxConcurrency(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return 10;
  }
  return Math.max(1, Math.floor(value));
}

function getIssueList(
  resultMap: Map<unknown, ValidationIssue[]> | Map<unknown, unknown>,
  resource: unknown,
): ValidationIssue[] {
  if (!(resultMap instanceof Map) || !resultMap.has(resource)) {
    throw new Error('Batch validation returned no result for an input resource');
  }
  const result = resultMap.get(resource);
  if (!Array.isArray(result)) {
    throw new Error('Batch validation returned a malformed issue list');
  }
  return result as ValidationIssue[];
}

function createPublicValidationResult(
  request: NormalizedValidationRequest,
  index: number,
  issues: ValidationIssue[],
): PublicValidationResult {
  const metadata = getResourceMetadata(request.resource);
  return {
    index,
    resource: request.resource,
    ...metadata,
    profileUrl: request.profileUrl,
    fhirVersion: request.fhirVersion,
    isValid: !issues.some(issue => issue.severity === 'error' || issue.severity === 'fatal'),
    issues,
  };
}

function getResourceMetadata(resource: unknown): { resourceType?: string; id?: string } {
  if (!resource || typeof resource !== 'object') {
    return {};
  }
  const candidate = resource as { resourceType?: unknown; id?: unknown };
  return {
    ...(typeof candidate.resourceType === 'string' ? { resourceType: candidate.resourceType } : {}),
    ...(typeof candidate.id === 'string' ? { id: candidate.id } : {}),
  };
}

function createValidationExecutionErrorIssue(index: number): ValidationIssue {
  const message = createSafeValidationFailureMessage('Validation');
  const details = {
    inputIndex: index,
  };
  return {
    id: computeValidationIssueId({
      aspect: 'general',
      severity: 'error',
      code: 'validation-execution-error',
      message,
      path: '',
      details,
    }),
    aspect: 'general',
    severity: 'error',
    code: 'validation-execution-error',
    message,
    path: '',
    timestamp: new Date(),
    details,
  };
}
