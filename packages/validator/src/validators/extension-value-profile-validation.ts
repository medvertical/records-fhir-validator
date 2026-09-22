import { resolveFhirSegmentValue } from '../core/fhir-primitive-sidecar.js';
import { resourceTypeOf } from '../core/fhir-resource.js';
import type { ElementDefinition } from '../core/structure-definition-types.js';
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
}: {
  extension: Record<string, unknown>;
  valueElements: ElementDefinition[];
  path: string;
  profileUrl: string;
  context: ExtensionValidationContext;
  typeValidator: TypeValidator;
  valueSetValidator: ValueSetValidator;
  elementRulesValidator: ElementRulesValidator;
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
  const inferredType = valueKey.replace('value', '');
  const matchingElement = valueElements.find((el) =>
    (el.type || []).some((type) =>
      type.code === inferredType || type.code === inferredType.toLowerCase()))
    || valueElements[0];

  issues.push(...await typeValidator.validate(
    value,
    matchingElement.type || [],
    `${path}.${valueKey}`,
    profileUrl,
  ));
  issues.push(...elementRulesValidator.validate(
    value,
    matchingElement,
    `${path}.${valueKey}`,
    profileUrl,
  ));
  if (matchingElement.binding) {
    issues.push(...await valueSetValidator.validateBinding(
      value,
      matchingElement.binding,
      `${path}.${valueKey}`,
    ));
  }
  return issues;
}
