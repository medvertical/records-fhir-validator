/**
 * Pin bindings to the actual ValueSet version shipped by the profile's owning
 * package, then its dependencies. Profile and ValueSet business versions are
 * independent, even within the same IG release.
 */
import { derivePackagePinContext, resolvePinnedCanonicalSource } from '../../package/canonical-pin-context.js';
import { resolveValueSetPackageDirectories } from '../../validators/valueset-package-resource-access.js';
import { lookupProfilePackageProvenance } from '../../package/canonical-pin-provenance.js';
import { bindingPinSource } from '../../package/canonical-pin-scope.js';
import type { Binding, StructureDefinition } from '../structure-definition-types.js';

export async function pinBindingToDependencyPins<T extends Binding | undefined>(
  binding: T,
  structureDef: Pick<StructureDefinition, 'url' | 'version'>,
  fhirVersion?: 'R4' | 'R5' | 'R6',
  directories: string[] = resolveValueSetPackageDirectories(),
): Promise<T> {
  if (!binding?.valueSet) return binding;
  const provenance = lookupProfilePackageProvenance(structureDef);
  if (!provenance) return binding;
  const context = await derivePackagePinContext(directories, provenance);
  const source = context && await resolvePinnedCanonicalSource(directories, context, binding.valueSet, fhirVersion);
  return source ? { ...binding, valueSet: `${source.canonical}|${source.version}`, [bindingPinSource]: source } : binding;
}
