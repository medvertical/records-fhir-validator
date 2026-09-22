import { parsePackageName } from './sd-loader-package-scanner.js';

export function matchesPackageVersionPin(
  packageName: string,
  packageVersionPins: Record<string, string>,
): boolean {
  const parsed = parsePackageName(packageName);
  if (!parsed) return false;
  const pinnedVersion = packageVersionPins[parsed.baseName];
  return pinnedVersion === undefined || parsed.version === pinnedVersion;
}
