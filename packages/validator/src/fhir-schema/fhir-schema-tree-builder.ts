import type {
  FHIRSchema,
  FHIRSchemaElement,
  FHIRSchemaSlice,
  SDElement,
} from './fhir-schema-types.js';
import { capitalize, convertElement, type TargetProfileTypeResolver } from './fhir-schema-element-converter.js';

interface SlicingDefinition {
  discriminator: Array<{ type: string; path: string }>;
  rules: string;
  ordered?: boolean;
}

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeObjectKey(key: string | undefined): key is string {
  return typeof key === 'string' && key.length > 0 && !UNSAFE_OBJECT_KEYS.has(key);
}

function parseSlicingDefinition(value: unknown): SlicingDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const discriminator = Array.isArray(record.discriminator)
    ? record.discriminator.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const candidate = item as Record<string, unknown>;
      return typeof candidate.type === 'string' && typeof candidate.path === 'string'
        ? [{ type: candidate.type, path: candidate.path }]
        : [];
    })
    : [];
  const rules = record.rules === 'closed' || record.rules === 'openAtEnd'
    ? record.rules
    : 'open';
  return {
    discriminator,
    rules,
    ordered: typeof record.ordered === 'boolean' ? record.ordered : undefined,
  };
}

export function populateSchemaElements(
  schema: FHIRSchema,
  childElements: SDElement[],
  rootType: string,
  resolveTargetProfile?: TargetProfileTypeResolver,
): void {
  const slicingDefs = collectSlicingDefinitions(childElements);
  schema.elements ??= {};
  schema.required ??= [];

  for (const el of childElements) {
    if (el.sliceName) {
      addSliceElement(schema.elements, el, rootType, slicingDefs, resolveTargetProfile);
    } else {
      addRegularElement(schema.elements, schema.required, el, rootType, resolveTargetProfile);
    }
  }
}

function collectSlicingDefinitions(childElements: SDElement[]): Map<string, SlicingDefinition> {
  const slicingDefs = new Map<string, SlicingDefinition>();
  for (const el of childElements) {
    const slicing = parseSlicingDefinition(el.slicing);
    if (slicing && !el.sliceName) {
      const relativePath = el.path.split('.').slice(1).join('.');
      slicingDefs.set(relativePath, slicing);
    }
  }
  return slicingDefs;
}

function addSliceElement(
  rootElements: Record<string, FHIRSchemaElement>,
  el: SDElement,
  rootType: string,
  slicingDefs: Map<string, SlicingDefinition>,
  resolveTargetProfile?: TargetProfileTypeResolver,
): void {
  if (!isSafeObjectKey(el.sliceName)) return;
  const relativePath = getRelativePath(el, rootType);
  if (!relativePath) {
    return;
  }

  const placement = getElementPlacement(rootElements, el, rootType, relativePath);
  if (!placement) return;
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
  const nextSlice = createSliceDefinition(el, resolveTargetProfile);
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
  resolveTargetProfile?: TargetProfileTypeResolver,
): void {
  const relativePath = getRelativePath(el, rootType);
  if (!relativePath) {
    return;
  }

  const placement = getElementPlacement(rootElements, el, rootType, relativePath);
  if (!placement) return;
  const target = placement.target;
  let fieldName = placement.fieldName;
  const originalFieldName = placement.originalFieldName;

  if (originalFieldName.endsWith('[x]')) {
    const baseName = fieldName;
    const choiceElement = convertElementWithSlicing(el, resolveTargetProfile);
    choiceElement.type ??= 'choice';
    if (el.type) {
      choiceElement.choices = el.type.map(t => baseName + capitalize(t.code));
    }
    target[baseName] = choiceElement;
    fieldName = baseName;
  } else if (target[fieldName]) {
    Object.assign(target[fieldName], convertElementWithSlicing(el, resolveTargetProfile));
  } else {
    target[fieldName] = convertElementWithSlicing(el, resolveTargetProfile);
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
  const relativePath = pathParts.slice(1).map(normalizeChoicePathSegment);
  return relativePath.every(isSafeObjectKey) ? relativePath : null;
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
} | null {
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
  const parsedIdParts = relativeIdParts.map(parseIdPart);
  if (parsedIdParts.some(part => (
    !isSafeObjectKey(part.fieldName)
    || (part.sliceName !== undefined && !isSafeObjectKey(part.sliceName))
  ))) return null;
  const relativePath = parsedIdParts.map(part => part.fieldName);
  let target = rootElements;

  for (let i = 0; i < relativeIdParts.length - 1; i += 1) {
    const parsed = parsedIdParts[i];
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

  const terminal = parsedIdParts[parsedIdParts.length - 1];
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

function convertElementWithSlicing(
  el: SDElement,
  resolveTargetProfile?: TargetProfileTypeResolver,
): FHIRSchemaElement {
  const converted = convertElement(el, resolveTargetProfile);
  const slicing = parseSlicingDefinition(el.slicing);
  if (slicing) converted.slicing = toFHIRSchemaSlicing(slicing);
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

function createSliceDefinition(
  el: SDElement,
  resolveTargetProfile?: TargetProfileTypeResolver,
): FHIRSchemaSlice {
  const sliceDef: FHIRSchemaSlice = {};
  if (el.min !== undefined) sliceDef.min = el.min;
  if (el.max && el.max !== '*') sliceDef.max = parseInt(el.max, 10);
  else if (el.max === '*') sliceDef.max = '*';

  const converted = convertElement(el, resolveTargetProfile);
  if (converted.type) sliceDef.type = converted.type;
  if (converted.binding) sliceDef.binding = converted.binding;
  if (converted.constraints) sliceDef.constraints = converted.constraints;
  if (converted.choices) sliceDef.choices = converted.choices;
  if (converted.refers) sliceDef.refers = converted.refers;
  if (converted.referenceTargetTypes) sliceDef.referenceTargetTypes = converted.referenceTargetTypes;
  if (converted.pattern) sliceDef.pattern = converted.pattern;
  if (converted.fixed) sliceDef.fixed = converted.fixed;
  if (converted.extensionUrl) sliceDef.extensionUrl = converted.extensionUrl;

  return sliceDef;
}
