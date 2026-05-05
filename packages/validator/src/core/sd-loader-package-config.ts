/**
 * StructureDefinition Loader - Package Configuration
 * 
 * Utilities for managing package download permissions.
 * Extracted from structure-definition-loader.ts to comply with global.mdc guidelines.
 */

/**
 * Parse allowed packages from environment variable
 */
export function parseAllowedPackages(): string[] {
  const envValue = process.env.FHIR_ALLOWED_PACKAGES;

  if (!envValue) {
    // Default: allow common packages
    return [
      'hl7.fhir.us.core',
      'hl7.fhir.us.qicore',
      'hl7.fhir.r4.core',
      'hl7.fhir.r5.core',
      'de.basisprofil.r4',
      'de.gematik.isik-basismodul',
      'kbv.basis',
      'uk.core',
      'hl7.fhir.au.base',
      'hl7.fhir.ca.baseline'
    ];
  }

  // Special case: * = allow all
  if (envValue.trim() === '*') {
    return ['*'];
  }

  // Parse comma-separated list
  return envValue
    .split(',')
    .map(pkg => pkg.trim())
    .filter(pkg => pkg.length > 0);
}

/**
 * Check if a package is allowed to be downloaded
 */
export function isPackageAllowed(packageId: string, allowedPackages: string[]): boolean {
  // If '*' is in allowed list, allow all
  if (allowedPackages.includes('*')) {
    return true;
  }

  // Check exact match
  if (allowedPackages.includes(packageId)) {
    return true;
  }

  // Check prefix match (e.g., 'de.gematik.*' matches 'de.gematik.isik-basismodul')
  return allowedPackages.some(allowed => {
    if (allowed.endsWith('*')) {
      const prefix = allowed.slice(0, -1);
      return packageId.startsWith(prefix);
    }
    return false;
  });
}

