/**
 * Canonical Reference Validator
 * 
 * Validates canonical URLs that reference conformance resources.
 * Handles profiles, value sets, code systems, and other definitional resources.
 * 
 * Task 6.9: Add canonical reference validation (e.g., references to profiles, valuesets)
 */

import { parseReference as _parseReference } from './reference-type-extractor';

// ============================================================================
// Types
// ============================================================================

export type CanonicalResourceType =
  | 'StructureDefinition'
  | 'ValueSet'
  | 'CodeSystem'
  | 'ConceptMap'
  | 'SearchParameter'
  | 'CapabilityStatement'
  | 'OperationDefinition'
  | 'NamingSystem'
  | 'ImplementationGuide'
  | 'Questionnaire'
  | 'PlanDefinition'
  | 'Measure'
  | 'Library'
  | 'ActivityDefinition'
  | 'MessageDefinition'
  | 'CompartmentDefinition'
  | 'GraphDefinition'
  | 'ExampleScenario'
  | 'ObservationDefinition'
  | 'SpecimenDefinition';

export interface CanonicalReferenceInfo {
  /** Original canonical URL */
  canonical: string;
  /** Base URL without version */
  baseUrl: string;
  /** Version if specified */
  version?: string;
  /** Expected resource type (if known from context) */
  expectedResourceType?: CanonicalResourceType;
  /** Whether this is a valid canonical URL format */
  isValidFormat: boolean;
  /** Whether this references a conformance resource */
  isConformanceResource: boolean;
}

export interface CanonicalValidationResult {
  /** Whether the canonical reference is valid */
  isValid: boolean;
  /** Validation severity */
  severity: 'error' | 'warning' | 'info';
  /** Validation message */
  message: string;
  /** Canonical info */
  canonicalInfo?: CanonicalReferenceInfo;
  /** Details */
  details?: any;
}

export interface CanonicalResolutionResult {
  /** Whether the canonical resource was found */
  found: boolean;
  /** The resolved resource (if found) */
  resource?: any;
  /** Error message if not found */
  errorMessage?: string;
  /** Source where found */
  source?: 'local' | 'registry' | 'remote';
}

// ============================================================================
// Canonical Reference Validator Class
// ============================================================================

export class CanonicalReferenceValidator {
  private canonicalResourceTypes: Set<CanonicalResourceType> = new Set([
    'StructureDefinition',
    'ValueSet',
    'CodeSystem',
    'ConceptMap',
    'SearchParameter',
    'CapabilityStatement',
    'OperationDefinition',
    'NamingSystem',
    'ImplementationGuide',
    'Questionnaire',
    'PlanDefinition',
    'Measure',
    'Library',
    'ActivityDefinition',
    'MessageDefinition',
    'CompartmentDefinition',
    'GraphDefinition',
    'ExampleScenario',
    'ObservationDefinition',
    'SpecimenDefinition',
  ]);

  private canonicalUrlPattern = /^https?:\/\/.+/;
  private urnPattern = /^urn:[a-z0-9][a-z0-9-]{0,31}:.+/i;

  /**
   * Parse canonical URL information
   */
  parseCanonicalUrl(canonical: string): CanonicalReferenceInfo {
    const trimmed = canonical.trim();

    // Split version if present
    const [baseUrl, version] = trimmed.includes('|')
      ? trimmed.split('|')
      : [trimmed, undefined];

    // Validate format
    const isValidFormat = this.isValidCanonicalFormat(baseUrl);

    // Determine if it's a conformance resource
    const isConformanceResource = this.isConformanceResourceUrl(baseUrl);

    return {
      canonical: trimmed,
      baseUrl,
      version,
      isValidFormat,
      isConformanceResource,
    };
  }

  /**
   * Validate a canonical URL
   */
  validateCanonicalUrl(
    canonical: string,
    expectedResourceType?: CanonicalResourceType
  ): CanonicalValidationResult {
    const canonicalInfo = this.parseCanonicalUrl(canonical);

    // Check format
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

    // Check if it's a conformance resource
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

    // Check expected resource type if provided
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

  /**
   * Check if URL is a valid canonical format
   */
  private isValidCanonicalFormat(url: string): boolean {
    // HTTP(S) URLs
    if (this.canonicalUrlPattern.test(url)) {
      return true;
    }

    // URN format
    if (this.urnPattern.test(url)) {
      return true;
    }

    return false;
  }

  /**
   * Check if URL references a conformance resource
   */
  private isConformanceResourceUrl(url: string): boolean {
    // Check if URL contains a conformance resource type
    for (const resourceType of this.canonicalResourceTypes) {
      if (url.includes(`/${resourceType}/`)) {
        return true;
      }
    }

    // Check for common patterns
    if (url.includes('/fhir/') && (
      url.includes('profile') ||
      url.includes('extension') ||
      url.includes('valueset') ||
      url.includes('codesystem')
    )) {
      return true;
    }

    return false;
  }

  /**
   * Extract resource type from canonical URL
   */
  extractResourceTypeFromUrl(url: string): CanonicalResourceType | null {
    for (const resourceType of this.canonicalResourceTypes) {
      if (url.includes(`/${resourceType}/`)) {
        return resourceType;
      }
    }
    return null;
  }

  /**
   * Validate profile canonical URL
   */
  validateProfileCanonical(canonical: string): CanonicalValidationResult {
    return this.validateCanonicalUrl(canonical, 'StructureDefinition');
  }

  /**
   * Validate value set canonical URL
   */
  validateValueSetCanonical(canonical: string): CanonicalValidationResult {
    return this.validateCanonicalUrl(canonical, 'ValueSet');
  }

  /**
   * Validate code system canonical URL
   */
  validateCodeSystemCanonical(canonical: string): CanonicalValidationResult {
    return this.validateCanonicalUrl(canonical, 'CodeSystem');
  }

  /**
   * Extract all canonical URLs from a resource
   */
  extractCanonicalUrls(resource: any): CanonicalReferenceInfo[] {
    const canonicals: CanonicalReferenceInfo[] = [];

    const extractFromObject = (obj: any, path: string = '') => {
      if (!obj || typeof obj !== 'object') {
        return;
      }

      // Check known canonical fields
      const canonicalFields = [
        'url',
        'profile',
        'targetProfile',
        'system',
        'valueSet',
        'instantiatesCanonical',
        'instantiatesUri',
        'derivedFrom',
        'basedOn',
        'partOf',
      ];

      for (const field of canonicalFields) {
        const value = obj[field];

        // Handle string values
        if (value && typeof value === 'string') {
          const canonicalInfo = this.parseCanonicalUrl(value);
          if (canonicalInfo.isValidFormat) {
            canonicals.push(canonicalInfo);
          }
        }

        // Handle array values (e.g., meta.profile)
        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (typeof item === 'string') {
              const canonicalInfo = this.parseCanonicalUrl(item);
              if (canonicalInfo.isValidFormat) {
                canonicals.push(canonicalInfo);
              }
            }
          });
        }
      }

      // Recursively check properties
      for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value)) {
          value.forEach((item, index) => {
            extractFromObject(item, `${path}.${key}[${index}]`);
          });
        } else if (value && typeof value === 'object') {
          extractFromObject(value, path ? `${path}.${key}` : key);
        }
      }
    };

    extractFromObject(resource);
    return canonicals;
  }

  /**
   * Validate all canonical URLs in a resource
   */
  validateResourceCanonicals(resource: any): CanonicalValidationResult[] {
    const canonicals = this.extractCanonicalUrls(resource);
    return canonicals.map(info => this.validateCanonicalUrl(info.canonical));
  }

  /**
   * Resolve a canonical URL (requires resource fetcher)
   */
  async resolveCanonical(
    canonical: string,
    resourceFetcher?: (url: string, resourceType?: string) => Promise<any>
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
        // Verify canonical URL matches
        if (resource.url && resource.url !== canonicalInfo.baseUrl) {
          return {
            found: true,
            resource,
            errorMessage: `Canonical URL mismatch: expected ${canonicalInfo.baseUrl}, found ${resource.url}`,
            source: 'remote',
          };
        }

        // Verify version if specified
        if (canonicalInfo.version && resource.version && resource.version !== canonicalInfo.version) {
          return {
            found: true,
            resource,
            errorMessage: `Version mismatch: expected ${canonicalInfo.version}, found ${resource.version}`,
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
      return {
        found: false,
        errorMessage: `Error resolving canonical: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Check if two canonical URLs are equivalent (ignoring version)
   */
  areEquivalent(canonical1: string, canonical2: string): boolean {
    const info1 = this.parseCanonicalUrl(canonical1);
    const info2 = this.parseCanonicalUrl(canonical2);

    return info1.baseUrl === info2.baseUrl;
  }

  /**
   * Check if canonical matches a pattern
   */
  matchesPattern(canonical: string, pattern: string): boolean {
    const info = this.parseCanonicalUrl(canonical);

    // Simple pattern matching (can be extended with regex)
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(info.baseUrl);
    }

    return info.baseUrl.includes(pattern);
  }

  /**
   * Get canonical without version
   */
  stripVersion(canonical: string): string {
    return canonical.split('|')[0];
  }

  /**
   * Add or replace version in canonical
   */
  withVersion(canonical: string, version: string): string {
    const baseUrl = this.stripVersion(canonical);
    return `${baseUrl}|${version}`;
  }

  /**
   * Validate Bundle canonical references
   */
  validateBundleCanonicals(bundle: any): {
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

    if (bundle.entry && Array.isArray(bundle.entry)) {
      bundle.entry.forEach((entry: any, index: number) => {
        if (entry.resource) {
          const canonicals = this.extractCanonicalUrls(entry.resource);

          canonicals.forEach(info => {
            const validationResult = this.validateCanonicalUrl(info.canonical);
            results.push(validationResult);

            // Track duplicates
            if (!canonicalMap.has(info.canonical)) {
              canonicalMap.set(info.canonical, []);
            }
            canonicalMap.get(info.canonical)!.push(index);
          });
        }
      });
    }

    // Find duplicates
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

  /**
   * Get common FHIR canonical base URLs
   */
  getCommonBaseUrls(): Record<string, string> {
    return {
      'hl7.org': 'http://hl7.org/fhir',
      'fhir.org': 'http://fhir.org',
      'nictiz.nl': 'http://nictiz.nl/fhir',
      'simplifier.net': 'http://simplifier.net',
      'medizininformatik-initiative.de': 'https://www.medizininformatik-initiative.de/fhir',
      'gematik.de': 'https://gematik.de/fhir',
      'kbv.de': 'https://fhir.kbv.de',
    };
  }

  /**
   * Detect canonical base URL organization
   */
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

// ============================================================================
// Singleton Instance
// ============================================================================

let validatorInstance: CanonicalReferenceValidator | null = null;

export function getCanonicalReferenceValidator(): CanonicalReferenceValidator {
  if (!validatorInstance) {
    validatorInstance = new CanonicalReferenceValidator();
  }
  return validatorInstance;
}

export function resetCanonicalReferenceValidator(): void {
  validatorInstance = null;
}

