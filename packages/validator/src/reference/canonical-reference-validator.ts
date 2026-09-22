import {
  COMMON_CANONICAL_BASE_URLS,
  type CanonicalResourceType,
} from './canonical-reference-definitions.js';
import { extractCanonicalUrlsFromResource } from './canonical-url-extraction.js';
import { classifyReferenceRequestFailure } from './reference-request-failure.js';
import {
  extractCanonicalResourceType,
  matchesCanonicalPattern,
  parseCanonicalReference,
  type CanonicalReferenceInfo,
} from './canonical-reference-format.js';

export type { CanonicalResourceType } from './canonical-reference-definitions.js';
export type { CanonicalReferenceInfo } from './canonical-reference-format.js';

export interface CanonicalValidationResult {
  isValid: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  canonicalInfo?: CanonicalReferenceInfo;
  details?: Record<string, unknown>;
}

export interface CanonicalResolutionResult {
  found: boolean;
  resource?: unknown;
  errorMessage?: string;
  source?: 'local' | 'registry' | 'remote';
}

export class CanonicalReferenceValidator {
  parseCanonicalUrl(canonical: string): CanonicalReferenceInfo {
    return parseCanonicalReference(canonical);
  }

  validateCanonicalUrl(
    canonical: string,
    expectedResourceType?: CanonicalResourceType
  ): CanonicalValidationResult {
    const canonicalInfo = this.parseCanonicalUrl(canonical);

    if (!canonicalInfo.isValidFormat) {
      return {
        isValid: false,
        severity: 'error',
        message: `Invalid canonical URL format: ${canonical}`,
        canonicalInfo,
        details: {
          expectedFormat: 'http://example.com/path or urn:...',
        },
      };
    }

    if (!canonicalInfo.isConformanceResource) {
      return {
        isValid: false,
        severity: 'warning',
        message: `URL does not appear to reference a conformance resource: ${canonical}`,
        canonicalInfo,
        details: {
          hint: 'Canonical URLs typically reference StructureDefinition, ValueSet, CodeSystem, etc.',
        },
      };
    }

    if (expectedResourceType) {
      const actualType = this.extractResourceTypeFromUrl(canonicalInfo.baseUrl);
      if (actualType && actualType !== expectedResourceType) {
        return {
          isValid: false,
          severity: 'error',
          message: `Expected ${expectedResourceType} but URL references ${actualType}`,
          canonicalInfo,
          details: {
            expected: expectedResourceType,
            actual: actualType,
          },
        };
      }
    }

    return {
      isValid: true,
      severity: 'info',
      message: 'Valid canonical URL',
      canonicalInfo,
    };
  }

  extractResourceTypeFromUrl(url: string): CanonicalResourceType | null {
    return extractCanonicalResourceType(url);
  }

  validateProfileCanonical(canonical: string): CanonicalValidationResult {
    return this.validateCanonicalUrl(canonical, 'StructureDefinition');
  }

  validateValueSetCanonical(canonical: string): CanonicalValidationResult {
    return this.validateCanonicalUrl(canonical, 'ValueSet');
  }

  validateCodeSystemCanonical(canonical: string): CanonicalValidationResult {
    return this.validateCanonicalUrl(canonical, 'CodeSystem');
  }

  extractCanonicalUrls(resource: unknown): CanonicalReferenceInfo[] {
    return extractCanonicalUrlsFromResource(resource, canonical => this.parseCanonicalUrl(canonical));
  }

  validateResourceCanonicals(resource: unknown): CanonicalValidationResult[] {
    const canonicals = this.extractCanonicalUrls(resource);
    return canonicals.map(info => this.validateCanonicalUrl(info.canonical));
  }

  async resolveCanonical(
    canonical: string,
    resourceFetcher?: (url: string, resourceType?: string) => Promise<unknown>
  ): Promise<CanonicalResolutionResult> {
    const canonicalInfo = this.parseCanonicalUrl(canonical);

    if (!canonicalInfo.isValidFormat) {
      return {
        found: false,
        errorMessage: 'Invalid canonical URL format',
      };
    }

    if (!resourceFetcher) {
      return {
        found: false,
        errorMessage: 'No resource fetcher provided',
      };
    }

    try {
      const resourceType = this.extractResourceTypeFromUrl(canonicalInfo.baseUrl);
      const resource = await resourceFetcher(canonicalInfo.baseUrl, resourceType || undefined);

      if (resource) {
        const resourceRecord = toRecord(resource);
        const resourceUrl = getStringProperty(resourceRecord, 'url');
        const resourceVersion = getStringProperty(resourceRecord, 'version');
        if (resourceUrl && resourceUrl !== canonicalInfo.baseUrl) {
          return {
            found: true,
            resource,
            errorMessage: `Canonical URL mismatch: expected ${canonicalInfo.baseUrl}, found ${resourceUrl}`,
            source: 'remote',
          };
        }

        if (canonicalInfo.version && resourceVersion && resourceVersion !== canonicalInfo.version) {
          return {
            found: true,
            resource,
            errorMessage: `Version mismatch: expected ${canonicalInfo.version}, found ${resourceVersion}`,
            source: 'remote',
          };
        }

        return {
          found: true,
          resource,
          source: 'remote',
        };
      }

      return {
        found: false,
        errorMessage: `Canonical resource not found: ${canonical}`,
      };
    } catch (error) {
      const failure = classifyReferenceRequestFailure(error);
      return {
        found: false,
        errorMessage: failure.message,
      };
    }
  }

  areEquivalent(canonical1: string, canonical2: string): boolean {
    const info1 = this.parseCanonicalUrl(canonical1);
    const info2 = this.parseCanonicalUrl(canonical2);

    return info1.baseUrl === info2.baseUrl;
  }

  matchesPattern(canonical: string, pattern: string): boolean {
    const info = this.parseCanonicalUrl(canonical);
    return matchesCanonicalPattern(info.baseUrl, pattern);
  }

  stripVersion(canonical: string): string {
    return canonical.split('|')[0];
  }

  withVersion(canonical: string, version: string): string {
    const baseUrl = this.stripVersion(canonical);
    return `${baseUrl}|${version}`;
  }

  validateBundleCanonicals(bundle: unknown): {
    isValid: boolean;
    results: CanonicalValidationResult[];
    duplicateCanonicals?: Array<{
      canonical: string;
      count: number;
      entries: number[];
    }>;
  } {
    const results: CanonicalValidationResult[] = [];
    const canonicalMap = new Map<string, number[]>();
    const entries = toRecord(bundle)?.entry;

    if (Array.isArray(entries)) {
      entries.forEach((entry, index) => {
        const resource = toRecord(entry)?.resource;
        if (resource) {
          const canonicals = this.extractCanonicalUrls(resource);

          canonicals.forEach(info => {
            const validationResult = this.validateCanonicalUrl(info.canonical);
            results.push(validationResult);

            if (!canonicalMap.has(info.canonical)) {
              canonicalMap.set(info.canonical, []);
            }
            canonicalMap.get(info.canonical)!.push(index);
          });
        }
      });
    }

    const duplicates = Array.from(canonicalMap.entries())
      .filter(([_, entries]) => entries.length > 1)
      .map(([canonical, entries]) => ({
        canonical,
        count: entries.length,
        entries,
      }));

    return {
      isValid: results.every(r => r.isValid) && duplicates.length === 0,
      results,
      duplicateCanonicals: duplicates.length > 0 ? duplicates : undefined,
    };
  }

  getCommonBaseUrls(): Record<string, string> {
    return { ...COMMON_CANONICAL_BASE_URLS };
  }

  detectOrganization(canonical: string): string | null {
    const info = this.parseCanonicalUrl(canonical);
    const commonUrls = this.getCommonBaseUrls();

    for (const [org, baseUrl] of Object.entries(commonUrls)) {
      if (info.baseUrl.includes(baseUrl)) {
        return org;
      }
    }

    return null;
  }
}

export function getCanonicalReferenceValidator(): CanonicalReferenceValidator {
  return new CanonicalReferenceValidator();
}

export function resetCanonicalReferenceValidator(): void {
  // Compatibility no-op: validator instances are caller-owned.
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getStringProperty(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}
