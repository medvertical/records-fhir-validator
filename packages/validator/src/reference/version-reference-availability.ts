import { classifyReferenceRequestFailure } from './reference-request-failure.js';
import { parseVersionedReference, stripReferenceVersion } from './version-reference-syntax.js';
import type { VersionAvailabilityCheckResult } from './version-specific-reference-types.js';

export type VersionReferenceHttpClient = (
  url: string,
) => Promise<{ status: number; data?: unknown }>;

export async function checkVersionAvailability(
  reference: string,
  httpClient?: VersionReferenceHttpClient,
): Promise<VersionAvailabilityCheckResult> {
  const versionInfo = parseVersionedReference(reference);
  if (!versionInfo.isVersioned) {
    return { isAvailable: false, errorMessage: 'Reference is not versioned' };
  }
  if (!httpClient) {
    return { isAvailable: false, errorMessage: 'No HTTP client provided for availability check' };
  }

  try {
    const response = await httpClient(buildAvailabilityUrl(reference));
    if (response.status === 200) {
      const actualVersion = getVersionId(response.data);
      return actualVersion && actualVersion !== versionInfo.versionId
        ? {
          isAvailable: true,
          httpStatus: response.status,
          actualVersion,
          errorMessage: `Version mismatch: requested ${versionInfo.versionId}, received ${actualVersion}`,
        }
        : { isAvailable: true, httpStatus: response.status, actualVersion };
    }
    return response.status === 404
      ? {
        isAvailable: false,
        httpStatus: response.status,
        errorMessage: `Version ${versionInfo.versionId} not found`,
      }
      : { isAvailable: false, httpStatus: response.status, errorMessage: `HTTP ${response.status}` };
  } catch (error) {
    return { isAvailable: false, errorMessage: classifyReferenceRequestFailure(error).message };
  }
}

function buildAvailabilityUrl(reference: string): string {
  return reference.includes('|') ? stripReferenceVersion(reference) : reference.trim();
}

function getVersionId(resource: unknown): string | undefined {
  const resourceRecord = toRecord(resource);
  const meta = toRecord(resourceRecord?.meta);
  return typeof meta?.versionId === 'string' ? meta.versionId : undefined;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
