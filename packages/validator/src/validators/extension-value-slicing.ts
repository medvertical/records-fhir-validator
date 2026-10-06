import type { ValidationIssue } from '@records-fhir/validation-types';
import { ProfileSlicingValidation } from '../core/executors/profile-slicing-validation.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader.js';
import type { ExtensionValidationContext } from './extension-types.js';
import { SlicingValidator } from './slicing-validator.js';

/** The containing resource snapshot does not carry slices inside an extension's value. */
export async function validateExtensionValueSlicing(
  extension: Record<string, unknown>,
  definition: StructureDefinition,
  context: ExtensionValidationContext,
  loader: StructureDefinitionLoader,
): Promise<ValidationIssue[]> {
  const elementPaths = new Set((definition.snapshot?.element ?? [])
    .filter(element => element.slicing && /^Extension\.value(?:\[x\]|[A-Z]\w*)\./.test(element.path))
    .map(element => element.path));
  if (!elementPaths.size) return [];
  const slicing = new SlicingValidator();
  slicing.setTypeProfileResolver((url, version, source) =>
    loader.loadReferencedProfile(url, source ?? definition, version ?? context.fhirVersion));
  const validation = new ProfileSlicingValidation(slicing);
  validation.setMustSupportSeverity(context.strictMode ? 'warning' : 'information');
  return validation.validate({
    extensionIssues: [], resource: extension, structureDef: definition,
    getValueAtPath: context.getValueAtPath, fhirVersion: context.fhirVersion,
    referenceResolver: context.referenceResolver, profileConformance: context.profileConformance,
    elementPaths,
  });
}
