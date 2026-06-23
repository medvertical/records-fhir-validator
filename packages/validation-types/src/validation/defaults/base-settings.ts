// Baseline validation settings (R4/R5) and quick-setup config presets.

import type { ValidationSettings } from '../settings';
import { R4_DEFAULT_INCLUDED_RESOURCE_TYPES, R5_DEFAULT_INCLUDED_RESOURCE_TYPES } from '../settings-types';
import {
  DEFAULT_TERMINOLOGY_SERVERS,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_CACHE_CONFIG,
  DEFAULT_ADVANCED_TERMINOLOGY,
} from './terminology-defaults';

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
      custom_rule: { enabled: true, severity: 'error' as const, engine: 'custom' },
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
      custom_rule: { enabled: true, severity: 'warning' as const, engine: 'custom' },
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
      custom_rule: { enabled: true, severity: 'warning' as const, engine: 'custom' },
      metadata: { enabled: false, severity: 'info' as const, engine: 'schema' },
      anomaly: { enabled: false, severity: 'info' as const, engine: 'records' }
    },
    performance: {
      maxConcurrent: 10,
      batchSize: 100
    }
  }
} as const;

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
    custom_rule: { enabled: true, severity: 'inherit', engine: 'custom' },
    metadata: { enabled: true, severity: 'inherit', engine: 'records' },
    anomaly: { enabled: true, severity: 'inherit', engine: 'records' }
  },
  performance: {
    maxConcurrent: 5,
    batchSize: 50,
    enableDeltaSearch: true
  },
  resourceTypes: {
    enabled: true,
    includedTypes: R4_DEFAULT_INCLUDED_RESOURCE_TYPES,
    excludedTypes: []
  },
  terminologyServers: DEFAULT_TERMINOLOGY_SERVERS,
  terminologyResolution: {
    strategy: 'local-first',
    twoPhaseExpansion: {
      enabled: false,
      mode: 'shadow',
      logMismatches: true,
    },
  },
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
    custom_rule: { enabled: true, severity: 'inherit', engine: 'custom' },
    metadata: { enabled: true, severity: 'inherit', engine: 'records' },
    anomaly: { enabled: true, severity: 'inherit', engine: 'records' }
  },
  performance: {
    maxConcurrent: 5,
    batchSize: 50,
    enableDeltaSearch: true
  },
  resourceTypes: {
    enabled: true,
    includedTypes: R5_DEFAULT_INCLUDED_RESOURCE_TYPES,
    excludedTypes: []
  },
  terminologyServers: DEFAULT_TERMINOLOGY_SERVERS,
  terminologyResolution: {
    strategy: 'local-first',
    twoPhaseExpansion: {
      enabled: false,
      mode: 'shadow',
      logMismatches: true,
    },
  },
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
