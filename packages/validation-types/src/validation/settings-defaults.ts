/**
 * Validation Settings Defaults
 *
 * Default configurations and constants for validation settings.
 *
 * Implementation lives in ./defaults/; this file re-exports the public API so
 * existing `settings-defaults` imports keep working unchanged.
 */

export type {
  MiiTerminologyMode,
  FhirPackagePin,
  Mii2026ValidationSettingsOverrides,
} from './defaults/ig-packages.js';
export {
  FHIR_CORE_PACKAGE_VERSIONS,
  FHIR_CORE_PACKAGE_SET,
  FHIR_CORE_EXTENSION_PACKAGE_VERSIONS,
  FHIR_CORE_EXTENSION_PACKAGE_SET,
  FHIR_CORE_TERMINOLOGY_PACKAGE_VERSIONS,
  FHIR_CORE_TERMINOLOGY_PACKAGE_SET,
  MII_2026_PACKAGE_VERSIONS,
  MII_2026_PACKAGE_SET,
  HL7_EU_EHDS_2026_PACKAGE_VERSIONS,
  HL7_EU_EPS_XTEHR_REFERENCE_PACKAGE,
  HL7_EU_EHDS_2026_PACKAGE_SET,
  IPS_PACKAGE_VERSION,
} from './defaults/ig-packages.js';

export {
  DEFAULT_TERMINOLOGY_SERVERS,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_CACHE_CONFIG,
  DEFAULT_ADVANCED_TERMINOLOGY,
} from './defaults/terminology-defaults.js';

export {
  VALIDATION_CONFIGS,
  DEFAULT_VALIDATION_SETTINGS_R4,
  DEFAULT_VALIDATION_SETTINGS_R5,
} from './defaults/base-settings.js';

export {
  createMii2026ValidationSettings,
  createEhds2026ValidationSettings,
} from './defaults/ig-settings-factories.js';
