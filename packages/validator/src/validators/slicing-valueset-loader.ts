import { ValueSetCache } from './valueset-cache.js';
import { ValueSetPackageLoader } from './valueset-package-loader.js';

export function createIsolatedSlicingValueSetLoader(): ValueSetPackageLoader {
  // ValueSetPackageLoader expands home placeholders itself. Keeping loader
  // creation side-effect free also prevents concurrent validations from
  // observing a temporarily deleted process-wide environment variable.
  return new ValueSetPackageLoader(new ValueSetCache());
}
