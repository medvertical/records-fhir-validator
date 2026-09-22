import { isValueEmpty } from '../core/executors/structural-executor-helpers.js';
import {
  isConcreteChoiceProperty,
  splitConcreteChoiceProperty,
} from '../core/fhir-choice-property.js';

const CONFORMANCE_RESOURCE_TYPES = new Set([
  'ActivityDefinition', 'CapabilityStatement', 'ChargeItemDefinition',
  'CodeSystem', 'CompartmentDefinition', 'ConceptMap', 'EventDefinition',
  'ExampleScenario', 'GraphDefinition', 'ImplementationGuide', 'Library',
  'Measure', 'MessageDefinition', 'NamingSystem', 'OperationDefinition',
  'PlanDefinition', 'Questionnaire', 'SearchParameter', 'StructureDefinition',
  'StructureMap', 'TerminologyCapabilities', 'ValueSet',
]);

export function shouldSkipMustSupportForResource(
  resource: unknown,
  path: string,
): boolean {
  if (!isRecord(resource)) return false;
  if (
    typeof resource.resourceType === 'string' &&
    CONFORMANCE_RESOURCE_TYPES.has(resource.resourceType)
  ) return true;

  return shouldSkipObservationAlternative(resource, path) ||
    shouldSkipOptionalInstanceElement(resource, path) ||
    shouldSkipEncounterElement(resource, path) ||
    shouldSkipPatientAddressElement(resource, path);
}

function shouldSkipObservationAlternative(
  resource: Record<string, unknown>,
  path: string,
): boolean {
  if (resource.resourceType !== 'Observation') return false;
  const components = Array.isArray(resource.component) ? resource.component : [];

  if (/^Observation\.value\[x\]$/i.test(path)) {
    return !isValueEmpty(resource.dataAbsentReason) ||
      components.some(hasAnyChoiceValue);
  }
  if (/^Observation\.component$/i.test(path)) {
    return hasChoiceValue(resource, 'value') ||
      !isValueEmpty(resource.dataAbsentReason);
  }
  if (/^Observation\.dataAbsentReason$/i.test(path)) {
    return hasChoiceValue(resource, 'value') ||
      components.some(hasAnyChoiceValue);
  }
  if (/^Observation\.component\.value\[x\]$/i.test(path)) {
    return components.length > 0 && components.every(hasDataAbsentReason);
  }
  if (/^Observation\.component(?::[^.]+)?\.dataAbsentReason$/i.test(path)) {
    return components.length > 0 && components.every(hasAnyChoiceValue);
  }
  return false;
}

function shouldSkipOptionalInstanceElement(
  resource: Record<string, unknown>,
  path: string,
): boolean {
  return (
    resource.resourceType === 'Observation' &&
    /^Observation\.(performer|specimen|interpretation|referenceRange)$/i.test(path)
  ) || (
    resource.resourceType === 'DiagnosticReport' &&
    /^DiagnosticReport\.resultsInterpreter$/i.test(path)
  ) || (
    resource.resourceType === 'Patient' &&
    /^Patient\.address\.postalCode$/i.test(path)
  );
}

function shouldSkipEncounterElement(
  resource: Record<string, unknown>,
  path: string,
): boolean {
  if (resource.resourceType !== 'Encounter') return false;
  if (/^Encounter\.hospitalization$/i.test(path)) {
    const encounterClass = isRecord(resource.class) ? resource.class : null;
    return typeof encounterClass?.code === 'string' && encounterClass.code !== 'IMP';
  }
  return /^Encounter\.reasonCode$/i.test(path) && (
    hasArrayContent(resource.type) ||
    hasArrayContent(resource.reasonReference) ||
    hasArrayContent(resource.diagnosis)
  );
}

function shouldSkipPatientAddressElement(
  resource: Record<string, unknown>,
  path: string,
): boolean {
  if (
    resource.resourceType !== 'Patient' ||
    !/^Patient\.address\.period$/i.test(path)
  ) return false;
  return !Array.isArray(resource.address) ||
    !resource.address.some(address => isRecord(address) && address.use === 'old');
}

function hasChoiceValue(element: unknown, base: string): boolean {
  if (!isRecord(element)) return false;
  if (!isValueEmpty(element[base])) return true;
  return Object.keys(element).some(key =>
    isConcreteChoiceProperty(key, base) && !isValueEmpty(element[key])
  );
}

function hasAnyChoiceValue(element: unknown): boolean {
  if (!isRecord(element)) return false;
  return hasChoiceValue(element, 'value') ||
    Object.keys(element).some(key =>
      splitConcreteChoiceProperty(key) !== null && !isValueEmpty(element[key])
    );
}

function hasDataAbsentReason(component: unknown): boolean {
  return isRecord(component) && !isValueEmpty(component.dataAbsentReason);
}

function hasArrayContent(value: unknown): boolean {
  return Array.isArray(value) && value.some(item => !isValueEmpty(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
