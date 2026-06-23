import { ValueSetCache } from './valueset-cache';
import { ValueSetPackageLoader } from './valueset-package-loader';

export function createIsolatedSlicingValueSetLoader(): ValueSetPackageLoader {
  return withResolvedFhirPackageCachePath(() => new ValueSetPackageLoader(new ValueSetCache()));
}

export function withResolvedFhirPackageCachePath<T>(factory: () => T): T {
  const saved = process.env.FHIR_PACKAGE_CACHE_PATH;
  if (saved?.includes('$HOME')) {
    delete process.env.FHIR_PACKAGE_CACHE_PATH;
  }

  try {
    return factory();
  } finally {
    if (saved !== undefined) {
      process.env.FHIR_PACKAGE_CACHE_PATH = saved;
    }
  }
}
