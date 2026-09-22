/**
 * Pin bindings to the actual ValueSet version shipped by the profile's owning
 * package, then its dependencies. Profile and ValueSet business versions are
 * independent, even within the same IG release.
 */
import {
  derivePackagePinContext,
  isPinExemptCanonical,
  resolvePinnedVersionForCanonical,
} from '../../package/canonical-pin-context.js';
import { lookupProfilePackageProvenance } from '../../package/canonical-pin-provenance.js';
import { resolveValueSetPackageDirectories } from '../../validators/valueset-package-resource-access.js';
import type { Binding, StructureDefinition } from '../structure-definition-types.js';

export async function pinBindingToDependencyPins<T extends Binding | undefined>(
  binding: T,
  structureDef: Pick<StructureDefinition, 'url' | 'version'>,
  fhirVersion?: 'R4' | 'R5' | 'R6',
): Promise<T> {
  if (!binding?.valueSet || isPinExemptCanonical(binding.valueSet)) return binding;

  const provenance = lookupProfilePackageProvenance(structureDef.url, structureDef.version);
  if (!provenance) return binding;

  const storeDirs = resolveValueSetPackageDirectories();
  const context = await derivePackagePinContext(storeDirs, provenance);
  if (!context) return binding;

  const pinnedVersion = await resolvePinnedVersionForCanonical(
    storeDirs,
    context,
    binding.valueSet,
    fhirVersion,
  );
  if (!pinnedVersion) return binding;
  return { ...binding, valueSet: `${binding.valueSet}|${pinnedVersion}` };
}
