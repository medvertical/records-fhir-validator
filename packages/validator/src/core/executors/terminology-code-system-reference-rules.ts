import type { ValidationIssue } from '@records-fhir/validation-types';
import { createTerminologyIssue } from '../../terminology/terminology-issue.js';
import { ValueSetCache } from '../../validators/valueset-cache.js';
import { ValueSetPackageLoader } from '../../validators/valueset-package-loader.js';
import { isAssertableCodeSystem } from '../../validators/valueset-code-system-rules.js';
import {
  getProfileSource,
  getProfileSourceRevision,
  type ProfileSourceContext,
} from '../../persistence/index.js';
import { BoundedLruCache } from '../../cache/bounded-lru-cache.js';

type CodeSystemReferenceMode = 'syntax' | 'not-found';

type CodeSystemLookupCacheEntry = {
  lookup: Promise<boolean>;
  expiresAt: number;
};

const HOST_CODE_SYSTEM_NEGATIVE_CACHE_TTL_MS = 60_000;

export class CodeSystemReferenceLookupCache {
  private readonly entries = new BoundedLruCache<string, CodeSystemLookupCacheEntry>(5_000);

  get(key: string): CodeSystemLookupCacheEntry | undefined {
    return this.entries.get(key);
  }

  set(key: string, entry: CodeSystemLookupCacheEntry): void {
    this.entries.set(key, entry);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

const KNOWN_INCORRECT_CODE_SYSTEM_URLS: Readonly<Record<string, string>> = {
  // R4 Observation.category uses the terminology.hl7.org CodeSystem. The
  // similarly-shaped hl7.org URL has never identified that CodeSystem and is
  // rejected by the HL7 reference validator as an undefined canonical URL.
  'http://hl7.org/fhir/observation-category':
    'http://terminology.hl7.org/CodeSystem/observation-category',
};

export async function validateCodeSystemReference(
  coding: unknown,
  path: string,
  index: number,
  isArrayInput: boolean,
  mode: CodeSystemReferenceMode,
  fhirVersion?: 'R4' | 'R5' | 'R6',
  sourceContext?: ProfileSourceContext,
  cache: ValueSetCache = new ValueSetCache(),
  lookupCache: CodeSystemReferenceLookupCache = new CodeSystemReferenceLookupCache(),
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const systemPath = isArrayInput ? `${path}[${index}].system` : `${path}.system`;
  const codingRecord = asRecord(coding);

  // Structural validation owns datatype errors. Terminology checks must stay
  // total over malformed JSON so one non-string system cannot abort the
  // remaining validation aspects.
  if (!codingRecord || typeof codingRecord.system !== 'string') return issues;
  const system = codingRecord.system;
  const code = typeof codingRecord.code === 'string' ? codingRecord.code : undefined;
  const display = typeof codingRecord.display === 'string' ? codingRecord.display : undefined;

  const correctedSystem = KNOWN_INCORRECT_CODE_SYSTEM_URLS[system];
  if (mode === 'syntax' && !isAbsoluteCodeSystemUri(system)) {
    issues.push(createTerminologyIssue({
      severity: 'error',
      code: 'terminology-codesystem-url-not-absolute',
      message: `Coding.system must be an absolute reference, not a local reference ('${system}')`,
      path: systemPath,
      details: {
        system,
        expectedSystemType: 'absolute CodeSystem URI',
        fixHint:
          `Replace Coding.system '${system}' with the absolute CodeSystem.url that defines the code; ` +
          'Coding.system cannot be a local label or code-system mnemonic.',
      },
    }));
  } else if (mode === 'syntax' && correctedSystem) {
    issues.push(createTerminologyIssue({
      severity: 'error',
      code: 'terminology-code-system-canonical-mismatch',
      message:
        `Coding.system '${system}' is not a defined CodeSystem canonical URL; ` +
        `use '${correctedSystem}' instead`,
      path: systemPath,
      details: {
        system,
        suggestedSystem: correctedSystem,
        fixHint: `Replace Coding.system '${system}' with '${correctedSystem}'.`,
      },
    }));
  } else if (mode === 'syntax' && /\/ValueSet\//i.test(system)) {
    issues.push(createTerminologyIssue({
      severity: 'error',
      code: 'terminology-coding-system-valueset',
      message: `The Coding references a value set, not a code system ('${system}')`,
      path: systemPath,
      details: {
        valueSetUrl: system,
        fixHint: 'Replace Coding.system with the CodeSystem URL that defines the code; do not use a ValueSet URL as Coding.system.',
      },
    }));
  }

  if (
    mode === 'not-found'
    && (correctedSystem || /\/ValueSet\//i.test(system))
  ) {
    return issues;
  }

  const systemValidation = validateCodeSystemUrl(system);
  const cachedCodeSystem = mode === 'not-found'
    ? cache.getCodeSystem(system) ?? cache.getCodeSystemFile(system) ?? undefined
    : undefined;
  const cacheKnowsIt = mode === 'not-found' && (
    (cachedCodeSystem !== undefined && isAssertableCodeSystem(cachedCodeSystem))
    || await localCodeSystemExists(system, fhirVersion, sourceContext, cache, lookupCache)
  );
  if (mode === 'not-found' && !systemValidation.valid && !cacheKnowsIt) {
    issues.push(createTerminologyIssue({
      severity: 'warning',
      code: 'terminology-codesystem-unresolvable',
      message: `A definition for CodeSystem '${system}' could not be found, so the code cannot be validated`,
      path: systemPath,
      details: {
        ...(code ? { code } : {}),
        system,
        ...(display ? { display } : {}),
        ...buildCodeSystemUrlDetails(system),
      },
    }));
  }

  return issues;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function fhirVersionToPackageMajor(fhirVersion?: 'R4' | 'R5' | 'R6'): string | undefined {
  if (fhirVersion === 'R4') return '4';
  if (fhirVersion === 'R5') return '5';
  if (fhirVersion === 'R6') return '6';
  return undefined;
}

function localCodeSystemExists(
  systemUrl: string,
  fhirVersion?: 'R4' | 'R5' | 'R6',
  sourceContext?: ProfileSourceContext,
  cache: ValueSetCache = new ValueSetCache(),
  lookupCache: CodeSystemReferenceLookupCache = new CodeSystemReferenceLookupCache(),
): Promise<boolean> {
  if (!isAbsoluteCodeSystemUri(systemUrl)) {
    return Promise.resolve(false);
  }

  const key = [
    getProfileSourceRevision(),
    sourceContext?.organizationId ?? '',
    sourceContext?.serverId ?? '',
    systemUrl,
    fhirVersion ?? '',
  ].join('|');
  const now = Date.now();
  let cacheEntry = lookupCache.get(key);
  if (cacheEntry && cacheEntry.expiresAt <= now) {
    lookupCache.delete(key);
    cacheEntry = undefined;
  }
  if (!cacheEntry) {
    const source = getProfileSource();
    if (source.hasCodeSystem && sourceContext?.organizationId !== undefined) {
      cacheEntry = {
        lookup: Promise.resolve(false),
        // Keep concurrent requests on the same in-flight lookup. A negative
        // result receives a bounded TTL once the promise settles.
        expiresAt: Number.POSITIVE_INFINITY,
      };
      cacheEntry.lookup = source.hasCodeSystem(systemUrl, undefined, sourceContext)
        .catch(() => false)
        .then(found => {
          cacheEntry!.expiresAt = found
            ? Number.POSITIVE_INFINITY
            : Date.now() + HOST_CODE_SYSTEM_NEGATIVE_CACHE_TTL_MS;
          return found;
        });
    } else {
      cacheEntry = {
        lookup: new ValueSetPackageLoader(cache)
          .loadCodeSystem(systemUrl, fhirVersionToPackageMajor(fhirVersion))
          .then(codeSystem => Boolean(codeSystem && isAssertableCodeSystem(codeSystem)))
          .catch(() => false),
        expiresAt: Number.POSITIVE_INFINITY,
      };
    }
    lookupCache.set(key, cacheEntry);
  }
  return cacheEntry.lookup;
}

function buildCodeSystemUrlDetails(systemUrl: string): Record<string, unknown> {
  const oidPattern = /^\d+(?:\.\d+)+$/;
  if (oidPattern.test(systemUrl)) {
    const suggestedSystem = `urn:oid:${systemUrl}`;
    return {
      expectedSystemType: 'absolute CodeSystem URI',
      suggestedSystem,
      fixHint: `Use '${suggestedSystem}' if this Coding.system is an OID; otherwise replace Coding.system with the absolute CodeSystem.url that defines the code.`,
    };
  }

  if (!isAbsoluteCodeSystemUri(systemUrl)) {
    return {
      expectedSystemType: 'absolute CodeSystem URI',
      fixHint: `Replace Coding.system '${systemUrl}' with the absolute CodeSystem.url that defines the code; Coding.system cannot be a local label or code-system mnemonic.`,
    };
  }

  return {
    expectedSystemType: 'known CodeSystem URI',
    fixHint: `Verify '${systemUrl}' is the canonical CodeSystem.url and provide a local CodeSystem package/cache or terminology server that can validate it.`,
  };
}

function validateCodeSystemUrl(systemUrl: string): { valid: boolean; message?: string } {
  const knownPatterns = [
    /^http:\/\/hl7\.org\/fhir\//,
    /^http:\/\/terminology\.hl7\.org\//,
    /^http:\/\/loinc\.org\/?$/,
    /^https?:\/\/snomed\.info\/sct/,
    /^http:\/\/unitsofmeasure\.org\/?$/,
    /^http:\/\/www\.nlm\.nih\.gov\/research\/umls\/rxnorm/,
    /^urn:oid:/,
    /^urn:iso:/,
    /^urn:ietf:/,
    /^urn:uuid:/,
    /^http:\/\/hl7\.org\/fhir\/sid\/icd/,
    /^https?:\/\/id\.who\.int\/icd\//,
    /^http:\/\/www\.cms\.gov\/Medicare\/Coding\/ICD10\/?$/,
    /^http:\/\/www\.whocc\.no\/atc/,
    /^http:\/\/unstats\.un\.org\//,
    /^http:\/\/dicom\.nema\.org\//,
    /^http:\/\/www\.ama-assn\.org\/go\/cpt/,
    /^http:\/\/hl7\.org\/fhir\/sid\//,
    /^http:\/\/www\.iso\.org\//,
    /^http:\/\/ihe\.net\//,
    /^http:\/\/ihe-d\.de\//,
    /^http:\/\/nucc\.org\//,
    /^https?:\/\/www\.nubc\.org\//,
    /^http:\/\/fdasis\.nlm\.nih\.gov/,
    /^http:\/\/ncimeta\.nci\.nih\.gov/,
    /^http:\/\/varnomen\.hgvs\.org/,
    /^http:\/\/www\.genenames\.org/,
    /^http:\/\/clinicaltrials\.gov/,
    /^http:\/\/www\.ada\.org\/snodent/,
    /^http:\/\/cts2\.nlm\.nih\.gov/,
    /^http:\/\/standardterms\.edqm\.eu\/?$/,
    /^http:\/\/fhir\.nl\//,
    /^http:\/\/fhir\.ch\//,
    /^https:\/\/fhir\.hl7\.org\.uk\//,
    /^https:\/\/hl7chile\.cl\/fhir\//,
    /^https?:\/\/fhir\.ee\//,
    /^https?:\/\/fhir\.bbmri\.de\//,
    /^http:\/\/fhir\.fi\//,
    /^https?:\/\/.*\.hl7\.org\//,
    /^urn:ietf:bcp:47$/,
    /^http:\/\/fhir\.synapxe\.sg\/CodeSystem\//,
  ];

  if (knownPatterns.some(pattern => pattern.test(systemUrl))) {
    return { valid: true };
  }

  if (!isAbsoluteCodeSystemUri(systemUrl)) {
    return { valid: false, message: `CodeSystem URL should be an absolute URI: '${systemUrl}'` };
  }

  return { valid: false, message: `Unknown CodeSystem URL: ${systemUrl}` };
}

function isAbsoluteCodeSystemUri(systemUrl: string): boolean {
  return systemUrl.startsWith('http://') || systemUrl.startsWith('https://') || systemUrl.startsWith('urn:');
}
