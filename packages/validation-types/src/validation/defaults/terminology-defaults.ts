// Default terminology servers, circuit-breaker, cache and advanced-terminology config.

import type { TerminologyServer, CircuitBreakerConfig } from '../settings';

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
