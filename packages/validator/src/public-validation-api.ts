import type { BatchValidationOptions } from './core/batch-validator';
import type { FhirClientLike } from './core/profile-loader-utils';
import type { ValidationIssue, ValidationSettings } from './types';

type InternalFhirVersion = 'R4' | 'R5' | 'R6';

/**
 * Public-API FHIR version literal. R4B is accepted on every entry point and
 * routed internally as R4, matching R4B's maintenance-release semantics.
 */
export type PublicFhirVersion = 'R4' | 'R4B' | 'R5' | 'R6';

/** Map a public-API FHIR version to the internal validator's accepted version. */
export function toInternalFhirVersion(v: PublicFhirVersion): InternalFhirVersion {
  return v === 'R4B' ? 'R4' : v;
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
    fhirVersion: InternalFhirVersion,
    settings: ValidationSettings | undefined,
    fhirClient: FhirClientLike | undefined,
  ): Promise<ValidationIssue[]>;
  validateBatch(
    resources: unknown[],
    options: BatchValidationOptions,
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
  const resultMap = await deps.validateBatch(resources, {
    profileUrl: first.profileUrl,
    fhirVersion: toInternalFhirVersion(first.fhirVersion),
    settings: first.settings,
    fhirClient: first.fhirClient,
    maxConcurrency: normalizeMaxConcurrency(options.maxConcurrency),
  });

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
          toInternalFhirVersion(request.fhirVersion),
          request.settings,
          request.fhirClient,
        );
        return createPublicValidationResult(request, index, issues);
      } catch (error) {
        if (!options.continueOnError) {
          throw error;
        }
        return createPublicValidationResult(request, index, [
          createValidationExecutionErrorIssue(error, index),
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
  const result = resultMap.get(resource);
  return Array.isArray(result) ? result as ValidationIssue[] : [];
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
    isValid: issues.length === 0,
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

function createValidationExecutionErrorIssue(error: unknown, index: number): ValidationIssue {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: `records-validation-execution-error-${index}`,
    aspect: 'general',
    severity: 'error',
    code: 'validation-execution-error',
    message: `Validation failed: ${message}`,
    path: '',
    timestamp: new Date(),
    details: { inputIndex: index },
  };
}
