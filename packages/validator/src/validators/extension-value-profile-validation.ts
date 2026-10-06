import { resolveFhirSegmentValue } from '../core/fhir-primitive-sidecar.js';
import { resourceTypeOf } from '../core/fhir-resource.js';
import { pinBindingToDependencyPins } from '../core/executors/terminology-binding-dependency-pins.js';
import type { ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ElementRulesValidator } from './element-rules-validator.js';
import type { ExtensionValidationContext } from './extension-types.js';
import type { TypeValidator } from './type-validator.js';
import type { ValueSetValidator } from './valueset-validator.js';

/** Validate the concrete value[x] selected by an extension instance. */
export async function validateExtensionValueElements({
  extension,
  valueElements,
  path,
  profileUrl,
  context,
  typeValidator,
  valueSetValidator,
  elementRulesValidator,
  definition,
}: {
  extension: Record<string, unknown>;
  valueElements: ElementDefinition[];
  path: string;
  profileUrl: string;
  context: ExtensionValidationContext;
  typeValidator: TypeValidator;
  valueSetValidator: ValueSetValidator;
  elementRulesValidator: ElementRulesValidator;
  /** The extension's definition, whose package release its value binding is read in. */
  definition?: Pick<StructureDefinition, 'url' | 'version'>;
}): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const valueKeys = Object.keys(extension).filter((key) => key.startsWith('value'));

  if (valueElements.length === 0) return issues;

  if (valueKeys.length === 0) {
    const requiredElement = valueElements.find((el) => (el.min ?? 0) > 0);
    // A primitive value[x] present only through its underscore sidecar
    // (e.g. `_valueString` carrying a cqf-expression) still satisfies min=1.
    const sidecarOnlyValue = resolveFhirSegmentValue(extension, 'value[x]');
    if (requiredElement && sidecarOnlyValue === undefined) {
      issues.push(createValidationIssue({
        code: 'profile-extension-missing-value',
        path,
        resourceType: resourceTypeOf(context.resource, 'Unknown'),
        profile: profileUrl,
        messageParams: { url: extension.url, requiredPath: requiredElement.path },
      }));
    }
    return issues;
  }

  const valueKey = valueKeys[0];
  const value = extension[valueKey];
  const inferredType = valueKey.slice('value'.length);
  const typedElement = valueElements.find(element => element.max !== '0'
    && (element.type ?? []).some(type => type.code.toLowerCase() === inferredType.toLowerCase()));
  if (!typedElement) {
    const wrongType = wrongValueTypeIssue(extension.url, valueElements, inferredType, path, profileUrl, context);
    if (wrongType) return [wrongType];
  }
  const matchingElement = typedElement ?? valueElements[0];

  issues.push(...await typeValidator.validate(
    value,
    matchingElement.type || [],
    `${path}.${valueKey}`,
    profileUrl,
    context.fhirVersion,
  ));
  issues.push(...elementRulesValidator.validate(
    value,
    matchingElement,
    `${path}.${valueKey}`,
    profileUrl,
  ));
  if (matchingElement.binding) {
    const pinBinding = valueSetValidator.pinBindingToProfile?.bind(valueSetValidator) ?? pinBindingToDependencyPins;
    const binding = definition
      ? await pinBinding(matchingElement.binding, definition, context.fhirVersion)
        .catch(() => matchingElement.binding)
      : matchingElement.binding;
    issues.push(...await valueSetValidator.validateBinding(
      value,
      binding,
      `${path}.${valueKey}`,
      { fhirVersion: context.fhirVersion, profileUrl },
    ));
  }
  return issues;
}

const PRIMITIVE_VALUE_TYPES = new Set([
  'base64Binary', 'boolean', 'canonical', 'code', 'date', 'dateTime', 'decimal', 'id', 'instant', 'integer',
  'integer64', 'markdown', 'oid', 'positiveInt', 'string', 'time', 'unsignedInt', 'uri', 'url', 'uuid',
]);

/**
 * The value's JSON name fixes its type; the reference validator rejects a
 * type the extension's value[x] does not allow ("… definition allows for the
 * types [unsignedInt] but found type integer").
 */
function wrongValueTypeIssue(
  url: unknown,
  valueElements: ElementDefinition[],
  inferredType: string,
  path: string,
  profileUrl: string,
  context: ExtensionValidationContext,
): ValidationIssue | null {
  const declaring = valueElements.filter(element => /\.value(?:\[x\]|[A-Z]\w*)$/.test(element.path ?? ''));
  if (declaring.length === 0) return null;
  // A value[x] closed with max 0 allows no type at all: the extension is
  // complex, and the reference validator reports "allows for the types []".
  const open = declaring.filter(element => element.max !== '0');
  const allowed = [...new Set(open.flatMap(element => (element.type ?? []).map(type => type.code)))];
  if (open.length > 0 && allowed.length === 0) return null;
  const lowered = inferredType.charAt(0).toLowerCase() + inferredType.slice(1);
  const found = PRIMITIVE_VALUE_TYPES.has(lowered) ? lowered : inferredType;
  return createValidationIssue({
    code: 'profile-extension-wrong-value-type',
    path,
    resourceType: resourceTypeOf(context.resource, 'Unknown'),
    profile: profileUrl,
    customMessage: `The Extension '${String(url)}' definition allows for the types [${allowed.join(', ')}] but found type ${found}`,
    severityOverride: 'error',
    details: { url, allowed, found },
  });
}
