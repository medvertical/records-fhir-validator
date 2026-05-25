import type {
  FHIRSchema,
  FHIRSchemaElement,
  FHIRSchemaSlice,
  SDElement,
} from './fhir-schema-types';
import { capitalize, convertElement } from './fhir-schema-element-converter';

interface SlicingDefinition {
  discriminator: Array<{ type: string; path: string }>;
  rules: string;
  ordered?: boolean;
}

export function populateSchemaElements(
  schema: FHIRSchema,
  childElements: SDElement[],
  rootType: string,
): void {
  const slicingDefs = collectSlicingDefinitions(childElements);
  schema.elements ??= {};
  schema.required ??= [];

  for (const el of childElements) {
    if (el.sliceName) {
      addSliceElement(schema.elements, el, rootType, slicingDefs);
    } else {
      addRegularElement(schema.elements, schema.required, el, rootType);
    }
  }
}

function collectSlicingDefinitions(childElements: SDElement[]): Map<string, SlicingDefinition> {
  const slicingDefs = new Map<string, SlicingDefinition>();
  for (const el of childElements) {
    if (el.slicing && !el.sliceName) {
      const relativePath = el.path.split('.').slice(1).join('.');
      slicingDefs.set(relativePath, {
        discriminator: (el.slicing as any).discriminator || [],
        rules: (el.slicing as any).rules || 'open',
        ordered: (el.slicing as any).ordered,
      });
    }
  }
  return slicingDefs;
}

function addSliceElement(
  rootElements: Record<string, FHIRSchemaElement>,
  el: SDElement,
  rootType: string,
  slicingDefs: Map<string, SlicingDefinition>,
): void {
  const relativePath = getRelativePath(el, rootType);
  if (!relativePath) {
    return;
  }

  const fieldName = relativePath[relativePath.length - 1];
  const target = getOrCreateParent(rootElements, relativePath);
  target[fieldName] ??= {};
  const parent = target[fieldName];

  const slicingKey = relativePath.join('.');
  if (!parent.slicing && slicingDefs.has(slicingKey)) {
    const def = slicingDefs.get(slicingKey)!;
    parent.slicing = {
      discriminator: def.discriminator,
      rules: def.rules as 'open' | 'closed' | 'openAtEnd',
      ordered: def.ordered,
    };
  }

  parent.slices ??= {};
  parent.slices[el.sliceName!] = createSliceDefinition(el);
}

function addRegularElement(
  rootElements: Record<string, FHIRSchemaElement>,
  required: string[],
  el: SDElement,
  rootType: string,
): void {
  const relativePath = getRelativePath(el, rootType);
  if (!relativePath) {
    return;
  }

  const target = getOrCreateParent(rootElements, relativePath);
  let fieldName = relativePath[relativePath.length - 1];

  if (fieldName.endsWith('[x]')) {
    const baseName = fieldName.slice(0, -3);
    const choiceElement = convertElement(el);
    if (el.type) {
      choiceElement.choices = el.type.map(t => baseName + capitalize(t.code));
    }
    target[baseName] = choiceElement;
    fieldName = baseName;
  } else if (target[fieldName]) {
    Object.assign(target[fieldName], convertElement(el));
  } else {
    target[fieldName] = convertElement(el);
  }

  if (relativePath.length === 1 && el.min && el.min > 0) {
    required.push(fieldName);
  }
}

function getRelativePath(el: SDElement, rootType: string): string[] | null {
  const pathParts = el.path.split('.');
  if (pathParts.length < 2 || pathParts[0] !== rootType) {
    return null;
  }
  return pathParts.slice(1);
}

function getOrCreateParent(
  rootElements: Record<string, FHIRSchemaElement>,
  relativePath: string[],
): Record<string, FHIRSchemaElement> {
  let target = rootElements;
  for (let i = 0; i < relativePath.length - 1; i++) {
    const segment = relativePath[i];
    target[segment] ??= { elements: {} };
    target[segment].elements ??= {};
    target = target[segment].elements;
  }
  return target;
}

function createSliceDefinition(el: SDElement): FHIRSchemaSlice {
  const sliceDef: FHIRSchemaSlice = {};
  if (el.min !== undefined) sliceDef.min = el.min;
  if (el.max && el.max !== '*') sliceDef.max = parseInt(el.max, 10);
  else if (el.max === '*') sliceDef.max = '*';

  const converted = convertElement(el);
  if (converted.pattern) sliceDef.pattern = converted.pattern;
  if (converted.fixed) sliceDef.fixed = converted.fixed;
  if (converted.extensionUrl) sliceDef.extensionUrl = converted.extensionUrl;

  return sliceDef;
}
