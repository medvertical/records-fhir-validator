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

  const placement = getElementPlacement(rootElements, el, rootType, relativePath);
  const { fieldName, originalFieldName, target } = placement;
  target[fieldName] ??= {};
  const parent = target[fieldName];

  const slicingKey = placement.relativePath.join('.');
  if (!parent.slicing && slicingDefs.has(slicingKey)) {
    parent.slicing = toFHIRSchemaSlicing(slicingDefs.get(slicingKey)!);
  }

  if (originalFieldName.endsWith('[x]')) {
    parent.type ??= 'choice';
    parent.choices ??= [];
    const baseName = fieldName;
    const choiceNames = el.type?.map(t => baseName + capitalize(t.code)) ?? [];
    if (el.sliceName) choiceNames.push(el.sliceName);
    for (const choiceName of choiceNames) {
      if (!parent.choices.includes(choiceName)) {
        parent.choices.push(choiceName);
      }
    }
  }

  parent.slices ??= {};
  const existingSlice = parent.slices[el.sliceName!] ?? {};
  const nextSlice = createSliceDefinition(el);
  parent.slices[el.sliceName!] = {
    ...existingSlice,
    ...nextSlice,
    elements: existingSlice.elements ?? nextSlice.elements,
  };
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

  const placement = getElementPlacement(rootElements, el, rootType, relativePath);
  const target = placement.target;
  let fieldName = placement.fieldName;
  const originalFieldName = placement.originalFieldName;

  if (originalFieldName.endsWith('[x]')) {
    const baseName = fieldName;
    const choiceElement = convertElementWithSlicing(el);
    choiceElement.type ??= 'choice';
    if (el.type) {
      choiceElement.choices = el.type.map(t => baseName + capitalize(t.code));
    }
    target[baseName] = choiceElement;
    fieldName = baseName;
  } else if (target[fieldName]) {
    Object.assign(target[fieldName], convertElementWithSlicing(el));
  } else {
    target[fieldName] = convertElementWithSlicing(el);
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
  return pathParts.slice(1).map(normalizeChoicePathSegment);
}

function getOriginalFieldName(el: SDElement): string {
  const pathParts = el.path.split('.');
  return pathParts[pathParts.length - 1] ?? '';
}

function normalizeChoicePathSegment(segment: string): string {
  return segment.endsWith('[x]') ? segment.slice(0, -3) : segment;
}

function getElementPlacement(
  rootElements: Record<string, FHIRSchemaElement>,
  el: SDElement,
  rootType: string,
  fallbackRelativePath: string[],
): {
  target: Record<string, FHIRSchemaElement>;
  fieldName: string;
  originalFieldName: string;
  relativePath: string[];
} {
  const idParts = typeof el.id === 'string' ? el.id.split('.') : [];
  if (idParts.length < 2 || idParts[0] !== rootType) {
    return {
      target: getOrCreateParent(rootElements, fallbackRelativePath),
      fieldName: fallbackRelativePath[fallbackRelativePath.length - 1],
      originalFieldName: getOriginalFieldName(el),
      relativePath: fallbackRelativePath,
    };
  }

  const relativeIdParts = idParts.slice(1);
  const relativePath = relativeIdParts.map(part => normalizeChoicePathSegment(part.split(':')[0]));
  let target = rootElements;

  for (let i = 0; i < relativeIdParts.length - 1; i += 1) {
    const parsed = parseIdPart(relativeIdParts[i]);
    target[parsed.fieldName] ??= { elements: {} };

    if (parsed.sliceName) {
      target[parsed.fieldName].slices ??= {};
      target[parsed.fieldName].slices![parsed.sliceName] ??= {};
      const slice = target[parsed.fieldName].slices![parsed.sliceName];
      slice.elements ??= {};
      target = slice.elements;
    } else {
      target[parsed.fieldName].elements ??= {};
      target = target[parsed.fieldName].elements!;
    }
  }

  const terminal = parseIdPart(relativeIdParts[relativeIdParts.length - 1]);
  return {
    target,
    fieldName: terminal.fieldName,
    originalFieldName: terminal.originalFieldName,
    relativePath,
  };
}

function parseIdPart(part: string): {
  fieldName: string;
  originalFieldName: string;
  sliceName?: string;
} {
  const [rawFieldName, sliceName] = part.split(':');
  return {
    fieldName: normalizeChoicePathSegment(rawFieldName),
    originalFieldName: rawFieldName,
    sliceName,
  };
}

function convertElementWithSlicing(el: SDElement): FHIRSchemaElement {
  const converted = convertElement(el);
  if (el.slicing) {
    converted.slicing = toFHIRSchemaSlicing({
      discriminator: (el.slicing as any).discriminator || [],
      rules: (el.slicing as any).rules || 'open',
      ordered: (el.slicing as any).ordered,
    });
  }
  return converted;
}

function toFHIRSchemaSlicing(def: SlicingDefinition): FHIRSchemaElement['slicing'] {
  return {
    discriminator: def.discriminator,
    rules: def.rules as 'open' | 'closed' | 'openAtEnd',
    ordered: def.ordered,
  };
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
  if (converted.type) sliceDef.type = converted.type;
  if (converted.binding) sliceDef.binding = converted.binding;
  if (converted.constraints) sliceDef.constraints = converted.constraints;
  if (converted.choices) sliceDef.choices = converted.choices;
  if (converted.refers) sliceDef.refers = converted.refers;
  if (converted.pattern) sliceDef.pattern = converted.pattern;
  if (converted.fixed) sliceDef.fixed = converted.fixed;
  if (converted.extensionUrl) sliceDef.extensionUrl = converted.extensionUrl;

  return sliceDef;
}
