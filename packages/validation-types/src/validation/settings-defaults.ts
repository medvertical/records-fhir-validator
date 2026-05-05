/**
 * Validation Settings Defaults
 * 
 * Default configurations and constants for validation settings.
 */

import type { ValidationSettings, TerminologyServer, CircuitBreakerConfig } from './settings';
import { R4_DEFAULT_INCLUDED_RESOURCE_TYPES, R5_DEFAULT_INCLUDED_RESOURCE_TYPES } from './settings-types';

// ============================================================================
// Default Settings Constants
// ============================================================================

// Common validation configurations for quick setup
export const VALIDATION_CONFIGS = {
  // Strict validation - all aspects enabled with error severity
  STRICT: {
    aspects: {
      structural: { enabled: true, severity: 'error' as const, engine: 'schema' },
      profile: { enabled: true, severity: 'error' as const, engine: 'hapi' },
      terminology: { enabled: true, severity: 'error' as const, engine: 'server' },
      reference: { enabled: true, severity: 'error' as const, engine: 'internal' },
      invariant: { enabled: true, severity: 'error' as const, engine: 'fhirpath' },
      customRule: { enabled: true, severity: 'error' as const, engine: 'custom' },
      metadata: { enabled: true, severity: 'error' as const, engine: 'schema' },
      anomaly: { enabled: true, severity: 'warning' as const, engine: 'records' }
    },
    performance: {
      maxConcurrent: 3,
      batchSize: 25
    }
  },

  // Balanced validation - mix of error and warning severity
  BALANCED: {
    aspects: {
      structural: { enabled: true, severity: 'error' as const, engine: 'schema' },
      profile: { enabled: true, severity: 'warning' as const, engine: 'hapi' },
      terminology: { enabled: true, severity: 'warning' as const, engine: 'server' },
      reference: { enabled: true, severity: 'error' as const, engine: 'internal' },
      invariant: { enabled: true, severity: 'warning' as const, engine: 'fhirpath' },
      customRule: { enabled: true, severity: 'warning' as const, engine: 'custom' },
      metadata: { enabled: true, severity: 'error' as const, engine: 'schema' },
      anomaly: { enabled: true, severity: 'info' as const, engine: 'records' }
    },
    performance: {
      maxConcurrent: 4,
      batchSize: 50
    }
  },

  // Fast validation - only critical aspects with higher concurrency
  FAST: {
    aspects: {
      structural: { enabled: true, severity: 'error' as const, engine: 'schema' },
      profile: { enabled: false, severity: 'warning' as const, engine: 'hapi' },
      terminology: { enabled: false, severity: 'warning' as const, engine: 'server' },
      reference: { enabled: true, severity: 'error' as const, engine: 'internal' },
      invariant: { enabled: false, severity: 'warning' as const, engine: 'fhirpath' },
      customRule: { enabled: true, severity: 'warning' as const, engine: 'custom' },
      metadata: { enabled: false, severity: 'info' as const, engine: 'schema' },
      anomaly: { enabled: false, severity: 'info' as const, engine: 'records' }
    },
    performance: {
      maxConcurrent: 10,
      batchSize: 100
    }
  }
} as const;

export type MiiTerminologyMode = 'mii-local-blaze' | 'mii-ontoserver' | 'mii-hybrid';

export interface FhirPackagePin {
  id: string;
  version: string;
}

export const MII_2026_PACKAGE_VERSIONS = {
  'de.basisprofil.r4': '1.5.4',
  'de.medizininformatikinitiative.kerndatensatz.meta': '2026.0.0',
  'de.medizininformatikinitiative.kerndatensatz.base': '2026.0.0',
  'de.medizininformatikinitiative.kerndatensatz.laborbefund': '2026.0.1',
  'de.medizininformatikinitiative.kerndatensatz.medikation': '2026.0.1',
  'de.medizininformatikinitiative.kerndatensatz.consent': '2026.0.1-rc-2',
  'de.medizininformatikinitiative.kerndatensatz.bildgebung': '2026.0.0',
  'de.medizininformatikinitiative.kerndatensatz.biobank': '2026.0.1',
  'de.medizininformatikinitiative.kerndatensatz.molgen': '2026.0.4',
  'de.medizininformatikinitiative.kerndatensatz.onkologie': '2026.0.3',
  'de.medizininformatikinitiative.kerndatensatz.patho': '2026.0.2',
  'de.medizininformatikinitiative.kerndatensatz.icu': '2026.0.2',
} as const;

export const MII_2026_PACKAGE_SET: FhirPackagePin[] = Object.entries(
  MII_2026_PACKAGE_VERSIONS
).map(([id, version]) => ({ id, version }));

const MII_2026_IG_PACKAGES = MII_2026_PACKAGE_SET.map(({ id, version }) => `${id}#${version}`);

export type Mii2026ValidationSettingsOverrides = Omit<
  Partial<ValidationSettings>,
  'packageDownload' | 'profileSources' | 'hapiConfig'
> & {
  packageDownload?: Partial<NonNullable<ValidationSettings['packageDownload']>>;
  profileSources?: Partial<NonNullable<ValidationSettings['profileSources']>>;
  hapiConfig?: Partial<NonNullable<ValidationSettings['hapiConfig']>>;
};

/**
 * Default terminology servers based on TERMINOLOGY_SERVER_TEST_RESULTS.md
 * 
 * Priority order (sequential fallback):
 * 1. CSIRO Ontoserver R4 - Primary (more reliable, fewer 422 errors)
 * 2. tx.fhir.org/r4 - Fallback for R4
 * 3. tx.fhir.org/r5 - Fallback for R5/R6
 */
export const DEFAULT_TERMINOLOGY_SERVERS: TerminologyServer[] = [
  {
    id: 'csiro-ontoserver-r4',
    name: 'CSIRO Ontoserver (R4)',
    url: 'https://r4.ontoserver.csiro.au/fhir',
    enabled: true,
    fhirVersions: ['R4'],
    status: 'unknown',
    failureCount: 0,
    lastFailureTime: null,
    circuitOpen: false,
    responseTimeAvg: 0,
    testScore: 96
  },
  {
    id: 'snowstorm-snomedtools',
    name: 'SNOMED International Snowstorm',
    url: 'https://snowstorm.snomedtools.org/fhir',
    // Disabled until the server is validated end-to-end against Records
    // (testScore: 0 = never successfully queried). Operators can enable
    // via settings when they have a confirmed deployment.
    enabled: false,
    fhirVersions: ['R4'],
    status: 'unknown',
    failureCount: 0,
    lastFailureTime: null,
    circuitOpen: false,
    responseTimeAvg: 0,
    testScore: 0,
    // SNOMED-specialist — routes SNOMED lookups here first when enabled.
    preferredSystems: ['http://snomed.info/sct']
  },
  {
    id: 'tx-fhir-org-r4',
    name: 'HL7 TX Server (R4)',
    url: 'https://tx.fhir.org/r4',
    enabled: true,
    fhirVersions: ['R4'],
    status: 'unknown',
    failureCount: 0,
    lastFailureTime: null,
    circuitOpen: false,
    responseTimeAvg: 0,
    testScore: 98
  },
  {
    id: 'tx-fhir-org-r5',
    name: 'HL7 TX Server (R5)',
    url: 'https://tx.fhir.org/r5',
    enabled: true,
    fhirVersions: ['R5', 'R6'],
    status: 'unknown',
    failureCount: 0,
    lastFailureTime: null,
    circuitOpen: false,
    responseTimeAvg: 0,
    testScore: 98
  },
  // Health Samurai Termbox — public demo endpoint for SNOMED CT, LOINC,
  // RxNorm, ICD-10, CPT, UCUM. Added as an additional fallback option
  // for demos; disabled by default until end-to-end tested.
  {
    id: 'termbox-healthsamurai',
    name: 'Health Samurai Termbox',
    url: 'https://tx.health-samurai.io/fhir',
    enabled: false,
    fhirVersions: ['R4'],
    status: 'unknown',
    failureCount: 0,
    lastFailureTime: null,
    circuitOpen: false,
    responseTimeAvg: 0,
    testScore: 0
  },
  // LOINC Official FHIR Terminology Service — authoritative for LOINC
  // code lookups. Best used with scope-based routing where LOINC system
  // URLs get routed here preferentially.
  {
    id: 'loinc-official',
    name: 'LOINC Official FHIR',
    url: 'https://fhir.loinc.org',
    enabled: false,
    fhirVersions: ['R4'],
    status: 'unknown',
    failureCount: 0,
    lastFailureTime: null,
    circuitOpen: false,
    responseTimeAvg: 0,
    testScore: 0,
    // LOINC-specialist — routes LOINC lookups here first when enabled.
    preferredSystems: ['http://loinc.org']
  },
  // HAPI FHIR public test server — general-purpose FHIR server with
  // terminology support. Useful as a low-priority fallback but not
  // recommended for production demos (public server, no SLA).
  {
    id: 'hapi-public',
    name: 'HAPI FHIR Public',
    url: 'https://hapi.fhir.org/baseR4',
    enabled: false,
    fhirVersions: ['R4'],
    status: 'unknown',
    failureCount: 0,
    lastFailureTime: null,
    circuitOpen: false,
    responseTimeAvg: 0,
    testScore: 0
  },
  // NHS England Terminology Server - requires OAuth2 authentication
  // Credentials come from environment variables. The server only loads
  // if both NHS_TERMINOLOGY_CLIENT_ID and NHS_TERMINOLOGY_CLIENT_SECRET
  // are set — otherwise it's disabled to prevent demos from failing
  // with incomplete auth.
  {
    id: 'nhs-ontology-uk',
    name: 'NHS England Terminology Server',
    url: 'https://ontology.nhs.uk/production1/fhir',
    enabled: Boolean(typeof process !== 'undefined' && process.env?.NHS_TERMINOLOGY_CLIENT_ID && process.env?.NHS_TERMINOLOGY_CLIENT_SECRET),
    fhirVersions: ['R4'],
    status: 'unknown',
    failureCount: 0,
    lastFailureTime: null,
    circuitOpen: false,
    responseTimeAvg: 0,
    testScore: 0,
    authConfig: {
      type: 'oauth2',
      clientId: (typeof process !== 'undefined' && process.env?.NHS_TERMINOLOGY_CLIENT_ID) || '',
      clientSecret: (typeof process !== 'undefined' && process.env?.NHS_TERMINOLOGY_CLIENT_SECRET) || '',
      tokenUrl: 'https://ontology.nhs.uk/authorisation/auth/realms/nhs-digital-terminology/protocol/openid-connect/token',
    }
  }
];

// ============================================================================
// Circuit Breaker Configuration
// ============================================================================

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,        // Open circuit after 5 consecutive failures
  resetTimeout: 1800000,      // 30 minutes before full reset
  halfOpenTimeout: 300000     // 5 minutes before trying one request
};

// ============================================================================
// Cache Configuration
// ============================================================================

/**
 * Default Cache Configuration
 * Task 7.12: Multi-layer cache settings
 */
export const DEFAULT_CACHE_CONFIG = {
  layers: {
    L1: 'enabled' as const,
    L2: 'disabled' as const,  // Disabled by default (requires database)
    L3: 'disabled' as const   // Disabled by default (requires filesystem)
  },
  l1MaxSizeMb: 100,  // 100 MB for in-memory cache
  l2MaxSizeGb: 1,    // 1 GB for database cache
  l3MaxSizeGb: 5,    // 5 GB for filesystem cache
  ttl: {
    validation: 5 * 60 * 1000,      // 5 minutes
    profile: 30 * 60 * 1000,        // 30 minutes
    terminology: 60 * 60 * 1000,    // 1 hour
    igPackage: 24 * 60 * 60 * 1000, // 24 hours
    default: 15 * 60 * 1000         // 15 minutes
  },
  warmupProfiles: [],   // Empty = use common FHIR core profiles
  warmupTerminologySystems: []  // Empty = use common terminology systems
};

// ============================================================================
// Advanced Terminology Defaults
// ============================================================================

/**
 * Default advanced terminology validation configuration.
 * All checks are disabled by default as they add latency (~100-500ms per code).
 */
export const DEFAULT_ADVANCED_TERMINOLOGY = {
  hierarchyValidation: {
    enabled: false,
    contextMappings: {
      // Common FHIR paths mapped to expected SNOMED CT parent concepts
      'Condition.code': '404684003',           // Clinical finding
      'Procedure.code': '71388002',            // Procedure
      'Observation.code': '363787002',         // Observable entity
      'MedicationStatement.medicationCodeableConcept': '373873005', // Pharmaceutical / biologic product
      'AllergyIntolerance.code': '105590001', // Substance
    }
  },
  eclValidation: {
    enabled: false,
    customExpressions: {
      // Example ECL expressions (users can add their own)
      // 'Condition.code': '<< 404684003' // Descendants of Clinical finding
    }
  },
  crossMappingValidation: {
    enabled: false,
    strictness: 'warn' as const,
    checkPairs: [
      {
        sourceSystem: 'http://hl7.org/fhir/sid/icd-10',
        targetSystem: 'http://snomed.info/sct'
      },
      {
        sourceSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
        targetSystem: 'http://snomed.info/sct'
      }
    ]
  }
};

// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_VALIDATION_SETTINGS_R4: ValidationSettings = {
  aspects: {
    structural: { enabled: true, severity: 'inherit', engine: 'records' },
    profile: { enabled: true, severity: 'inherit', engine: 'records' },
    terminology: { enabled: true, severity: 'inherit', engine: 'records' },
    reference: { enabled: true, severity: 'inherit', engine: 'records' },
    invariant: { enabled: true, severity: 'inherit', engine: 'fhirpath' },
    customRule: { enabled: true, severity: 'inherit', engine: 'custom' },
    metadata: { enabled: true, severity: 'inherit', engine: 'records' },
    anomaly: { enabled: true, severity: 'inherit', engine: 'records' }
  },
  performance: {
    maxConcurrent: 5,
    batchSize: 50
  },
  resourceTypes: {
    enabled: true,
    includedTypes: R4_DEFAULT_INCLUDED_RESOURCE_TYPES,
    excludedTypes: []
  },
  terminologyServers: DEFAULT_TERMINOLOGY_SERVERS,
  circuitBreaker: DEFAULT_CIRCUIT_BREAKER_CONFIG,
  mode: 'online',
  terminologyFallback: {
    local: 'n/a',
    remote: 'https://tx.fhir.org/r4'
  },
  offlineConfig: {
    ontoserverUrl: 'https://r4.ontoserver.csiro.au/fhir',
    profileCachePath: '/opt/fhir/igs/'
  },
  profileSources: {
    fhirServer: true,
    simplifier: true,
    packageRegistry: true
  },
  advancedTerminology: DEFAULT_ADVANCED_TERMINOLOGY,
  packageDownload: {
    versionPolicy: 'prefer-stable',
    pinnedVersions: {
      // German profiles — pinned to known-good versions
      'de.medizininformatikinitiative.kerndatensatz.person': '2025.0.1',
      'de.gematik.isik-basismodul': '4.0.3',
      'fhir.r4.ukcore.stu3.currentbuild': '0.0.6-pre-release'
    },
    approvedPackages: [
      // Core FHIR
      'hl7.fhir.r4.core',
      'hl7.fhir.r4.examples',
      // Germany: gematik ISiK (hospitals, § 373 SGB V)
      'de.gematik.*',
      // Germany: MII Core Data Set (37 university hospitals)
      'de.medizininformatikinitiative.*',
      'de.medizininformatik-initiative.*',
      // Germany: KBV (ambulatory care)
      'kbv.*',
      // Germany: HL7 Germany base profiles
      'de.basisprofil.*',
      // Germany: RKI (infectious disease reporting)
      'rki.demis.*',
      // HL7 Europe (EHDS)
      'hl7.eu.*',
      // US Core + US realm
      'hl7.fhir.us.*',
      // UK Core
      'uk.nhsdigital.*',
      'fhir.r4.ukcore.*',
      'hl7.fhir.uk.*',
      'uk.core',
      // IHE + international
      'ihe.*',
      'hl7.fhir.uv.*'
    ],
    requireApproval: false,
    autoDownload: true
  },
  autoRevalidateAfterEdit: false,
  autoRevalidateOnVersionChange: true,
  autoApplyCustomRules: false,
  listViewPollingInterval: 30000,
  enableBestPracticeChecks: true,
  bestPracticeSeverity: 'info',
  excludedPaths: [],
  recursiveReferenceValidation: {
    enabled: true,
    maxDepth: 3,
    validateExternal: false,
    validateContained: true,
    validateBundleEntries: true,
  },
  cacheConfig: DEFAULT_CACHE_CONFIG,
  hapiConfig: {
    enabled: false,
    timeout: 30000,
    igPackages: [],
    useProcessPool: true,
    poolSize: 3,
    cachePath: '/tmp/fhir-packages',
    enableBestPractice: true
  },
  validationStrictness: 'standard'
};

export const DEFAULT_VALIDATION_SETTINGS_R5: ValidationSettings = {
  aspects: {
    structural: { enabled: true, severity: 'inherit', engine: 'records' },
    profile: { enabled: true, severity: 'inherit', engine: 'records' },
    terminology: { enabled: true, severity: 'inherit', engine: 'records' },
    reference: { enabled: true, severity: 'inherit', engine: 'records' },
    invariant: { enabled: true, severity: 'inherit', engine: 'fhirpath' },
    customRule: { enabled: true, severity: 'inherit', engine: 'custom' },
    metadata: { enabled: true, severity: 'inherit', engine: 'records' },
    anomaly: { enabled: true, severity: 'inherit', engine: 'records' }
  },
  performance: {
    maxConcurrent: 5,
    batchSize: 50
  },
  resourceTypes: {
    enabled: true,
    includedTypes: R5_DEFAULT_INCLUDED_RESOURCE_TYPES,
    excludedTypes: []
  },
  terminologyServers: DEFAULT_TERMINOLOGY_SERVERS,
  circuitBreaker: DEFAULT_CIRCUIT_BREAKER_CONFIG,
  mode: 'online',
  terminologyFallback: {
    local: 'n/a',
    remote: 'https://tx.fhir.org/r5'
  },
  offlineConfig: {
    ontoserverUrl: 'https://r4.ontoserver.csiro.au/fhir',
    profileCachePath: '/opt/fhir/igs/'
  },
  profileSources: {
    fhirServer: true,
    simplifier: true,
    packageRegistry: true
  },
  advancedTerminology: DEFAULT_ADVANCED_TERMINOLOGY,
  packageDownload: {
    versionPolicy: 'prefer-stable',
    pinnedVersions: {
      'de.medizininformatikinitiative.kerndatensatz.person': '2025.0.1',
    },
    approvedPackages: [
      'hl7.fhir.r5.core',
      'hl7.fhir.r5.examples',
      'de.medizininformatikinitiative.*',
      'de.medizininformatik-initiative.*',
      'de.basisprofil.*',
      'kbv.*',
      'de.gematik.*',
      'hl7.fhir.us.*',
      'uk.nhsdigital.*',
      'hl7.fhir.uk.*',
      'uk.core',
      'hl7.fhir.uv.*'
    ],
    requireApproval: false,
    autoDownload: true
  },
  autoRevalidateAfterEdit: false,
  autoRevalidateOnVersionChange: true,
  autoApplyCustomRules: false,
  listViewPollingInterval: 30000,
  enableBestPracticeChecks: true,
  bestPracticeSeverity: 'info',
  excludedPaths: [],
  recursiveReferenceValidation: {
    enabled: true,
    maxDepth: 3,
    validateExternal: false,
    validateContained: true,
    validateBundleEntries: true,
  },
  cacheConfig: DEFAULT_CACHE_CONFIG,
  validationStrictness: 'standard',
  hapiConfig: {
    enabled: false,
    timeout: 30000,
    igPackages: [],
    useProcessPool: true,
    poolSize: 3,
    cachePath: '/tmp/fhir-packages',
    enableBestPractice: true
  }
};

/**
 * Create an R4 validation settings preset for the MII 2026 package set.
 *
 * The preset keeps the standard Records validator behavior but pins every
 * MII package version used by the 2026 conformance target so automatic package
 * downloads and optional HAPI parity runs resolve deterministic IG versions.
 */
export function createMii2026ValidationSettings(
  overrides: Mii2026ValidationSettingsOverrides = {}
): ValidationSettings {
  const settings = JSON.parse(JSON.stringify(DEFAULT_VALIDATION_SETTINGS_R4)) as ValidationSettings;
  const approvedPackages = new Set([
    ...(settings.packageDownload?.approvedPackages ?? []),
    ...MII_2026_PACKAGE_SET.map(({ id }) => id)
  ]);

  settings.packageDownload = {
    versionPolicy: settings.packageDownload?.versionPolicy ?? 'prefer-stable',
    pinnedVersions: {
      ...(settings.packageDownload?.pinnedVersions ?? {}),
      ...MII_2026_PACKAGE_VERSIONS
    },
    approvedPackages: Array.from(approvedPackages),
    requireApproval: settings.packageDownload?.requireApproval ?? false,
    autoDownload: settings.packageDownload?.autoDownload ?? true
  };

  settings.profileSources = {
    fhirServer: settings.profileSources?.fhirServer ?? true,
    simplifier: true,
    packageRegistry: true
  };

  settings.hapiConfig = {
    enabled: settings.hapiConfig?.enabled ?? false,
    timeout: settings.hapiConfig?.timeout ?? 30000,
    igPackages: MII_2026_IG_PACKAGES,
    useProcessPool: settings.hapiConfig?.useProcessPool ?? true,
    poolSize: settings.hapiConfig?.poolSize ?? 3,
    cachePath: settings.hapiConfig?.cachePath ?? '/tmp/fhir-packages',
    enableBestPractice: settings.hapiConfig?.enableBestPractice ?? true
  };

  return {
    ...settings,
    ...overrides,
    packageDownload: {
      ...settings.packageDownload,
      ...overrides.packageDownload,
      pinnedVersions: {
        ...settings.packageDownload.pinnedVersions,
        ...overrides.packageDownload?.pinnedVersions
      },
      approvedPackages: overrides.packageDownload?.approvedPackages ?? settings.packageDownload.approvedPackages
    },
    profileSources: {
      ...settings.profileSources,
      ...overrides.profileSources
    },
    hapiConfig: {
      ...settings.hapiConfig,
      ...overrides.hapiConfig
    }
  };
}
