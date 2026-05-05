/**
 * StructureDefinition → FHIR Schema Converter (Evaluation Prototype)
 *
 * Converts FHIR R4 StructureDefinitions (snapshot form) into the FHIR
 * Schema format for validation. FHIR Schema uses nested objects instead
 * of flat element arrays, making it more natural for programmatic
 * validation.
 *
 * This is an eval prototype — covers the common cases (primitives,
 * complex types, required fields, cardinality, bindings, choice types,
 * constraints). Not yet production-complete.
 *
 * Reference: https://github.com/fhir-schema/fhir-schema
 */

// ============================================================================
// FHIR Schema Types
// ============================================================================

export interface FHIRSchema {
  url: string;
  name: string;
  base?: string;
  kind: 'resource' | 'complex-type' | 'primitive-type' | 'logical';
  type: string;
  elements?: Record<string, FHIRSchemaElement>;
  required?: string[];
  constraints?: FHIRSchemaConstraint[];
}

export interface FHIRSchemaElement {
  type?: string;
  collection?: boolean;
  required?: boolean;
  min?: number;
  max?: number | '*';
  elements?: Record<string, FHIRSchemaElement>;
  binding?: FHIRSchemaBinding;
  constraints?: FHIRSchemaConstraint[];
  pattern?: unknown;
  fixed?: unknown;
  choiceOf?: string;
  choices?: string[];
  refers?: string[];
  extensionUrl?: string;
  slicing?: FHIRSchemaSlicing;
  slices?: Record<string, FHIRSchemaSlice>;
}

export interface FHIRSchemaSlicing {
  discriminator: Array<{ type: string; path: string }>;
  rules: 'open' | 'closed' | 'openAtEnd';
  ordered?: boolean;
}

export interface FHIRSchemaSlice {
  min?: number;
  max?: number | '*';
  match?: Record<string, unknown>;
  elements?: Record<string, FHIRSchemaElement>;
  extensionUrl?: string;
  pattern?: unknown;
  fixed?: unknown;
}

export interface FHIRSchemaBinding {
  valueSet: string;
  strength: 'required' | 'extensional' | 'preferred' | 'example';
}

export interface FHIRSchemaConstraint {
  key: string;
  severity: 'error' | 'warning';
  human: string;
  expression?: string;
}

// ============================================================================
// StructureDefinition Types (minimal, from FHIR R4)
// ============================================================================

interface SDElement {
  id?: string;
  path: string;
  min?: number;
  max?: string;
  type?: Array<{
    code: string;
    targetProfile?: string[];
    profile?: string[];
  }>;
  binding?: {
    strength: string;
    valueSet?: string;
  };
  constraint?: Array<{
    key: string;
    severity: string;
    human: string;
    expression?: string;
  }>;
  fixedString?: string;
  fixedCode?: string;
  fixedUri?: string;
  fixedBoolean?: boolean;
  patternCodeableConcept?: unknown;
  patternCoding?: unknown;
  patternIdentifier?: unknown;
  slicing?: unknown;
  sliceName?: string;
}

interface StructureDefinition {
  url: string;
  name: string;
  type: string;
  kind: string;
  baseDefinition?: string;
  snapshot?: { element: SDElement[] };
  differential?: { element: SDElement[] };
}

// ============================================================================
// Differential Merging
// ============================================================================

export type BaseResolver = (url: string) => StructureDefinition | undefined;

/**
 * Merge differential elements onto base snapshot elements.
 * For each differential element, find the matching base element by path
 * and apply overrides. Differential elements not in base are appended.
 */
export function mergeDifferentialWithBase(
  diffElements: SDElement[],
  baseElements: SDElement[],
): SDElement[] {
  const baseByPath = new Map<string, SDElement>();
  for (const el of baseElements) {
    baseByPath.set(el.path, { ...el });
  }

  for (const diff of diffElements) {
    const existing = baseByPath.get(diff.path);
    if (existing) {
      // Override base with differential fields (only non-undefined fields)
      if (diff.min !== undefined) existing.min = diff.min;
      if (diff.max !== undefined) existing.max = diff.max;
      if (diff.type) existing.type = diff.type;
      if (diff.binding) existing.binding = diff.binding;
      if (diff.constraint) {
        existing.constraint = [...(existing.constraint || []), ...diff.constraint];
      }
      if (diff.slicing) existing.slicing = diff.slicing;
      if (diff.sliceName) existing.sliceName = diff.sliceName;
      if (diff.fixedString !== undefined) existing.fixedString = diff.fixedString;
      if (diff.fixedCode !== undefined) existing.fixedCode = diff.fixedCode;
      if (diff.fixedUri !== undefined) existing.fixedUri = diff.fixedUri;
      if (diff.fixedBoolean !== undefined) existing.fixedBoolean = diff.fixedBoolean;
      if (diff.patternCodeableConcept) existing.patternCodeableConcept = diff.patternCodeableConcept;
      if (diff.patternCoding) existing.patternCoding = diff.patternCoding;
      if (diff.patternIdentifier) existing.patternIdentifier = diff.patternIdentifier;
    } else {
      // New element from differential (e.g. slices)
      baseByPath.set(diff.path, { ...diff });
    }
  }

  return Array.from(baseByPath.values());
}

/**
 * Resolve elements for conversion: use snapshot if available,
 * otherwise merge differential against base SD's snapshot.
 */
function resolveElements(
  sd: StructureDefinition,
  resolveBase?: BaseResolver,
): SDElement[] {
  if (sd.snapshot?.element?.length) {
    return sd.snapshot.element;
  }

  if (!sd.differential?.element?.length) {
    return [];
  }

  // Differential-only: try to merge against base
  if (resolveBase && sd.baseDefinition) {
    const baseSd = resolveBase(sd.baseDefinition);
    if (baseSd?.snapshot?.element?.length) {
      // Remap base paths: base uses its own type (e.g. DomainResource.text),
      // we need the derived type (e.g. Patient.text)
      const baseElements = baseSd.snapshot.element.map(el => ({
        ...el,
        path: el.path.replace(new RegExp(`^${baseSd.type}`), sd.type),
      }));
      return mergeDifferentialWithBase(sd.differential.element, baseElements);
    }
  }

  // Fallback: use differential as-is
  return sd.differential.element;
}

// ============================================================================
// Converter
// ============================================================================

const _PRIMITIVE_TYPES = new Set([
  'boolean', 'integer', 'string', 'decimal', 'uri', 'url', 'canonical',
  'base64Binary', 'instant', 'date', 'dateTime', 'time', 'code', 'oid',
  'id', 'markdown', 'unsignedInt', 'positiveInt', 'uuid', 'xhtml',
]);

// eslint-disable-next-line max-lines-per-function
export function convertToFHIRSchema(sd: StructureDefinition, resolveBase?: BaseResolver): FHIRSchema {
  const elements = resolveElements(sd, resolveBase);
  if (elements.length === 0) {
    return {
      url: sd.url,
      name: sd.name,
      base: sd.baseDefinition,
      kind: mapKind(sd.kind),
      type: sd.type,
    };
  }

  const rootElement = elements[0];
  const childElements = elements.slice(1);

  const schema: FHIRSchema = {
    url: sd.url,
    name: sd.name,
    base: sd.baseDefinition,
    kind: mapKind(sd.kind),
    type: sd.type,
    elements: {},
    required: [],
  };

  // Root constraints
  if (rootElement.constraint) {
    schema.constraints = rootElement.constraint.map(c => ({
      key: c.key,
      severity: c.severity === 'error' ? 'error' : 'warning',
      human: c.human,
      expression: c.expression,
    }));
  }

  // Build nested tree from flat element array.
  // StructureDefinitions use dot-separated paths (Patient.name.given);
  // FHIR Schema uses nested objects ({ name: { elements: { given: {} } } }).
  // First pass: collect slicing definitions from elements that have .slicing
  const slicingDefs = new Map<string, { discriminator: Array<{ type: string; path: string }>; rules: string; ordered?: boolean }>();
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

  const rootType = sd.type;
  for (const el of childElements) {
    // Handle sliced elements — attach as slices on the parent element
    if (el.sliceName) {
      const pathParts = el.path.split('.');
      if (pathParts.length < 2 || pathParts[0] !== rootType) continue;

      const relativePath = pathParts.slice(1);
      const fieldName = relativePath[relativePath.length - 1];

      // Navigate to parent
      let target = schema.elements!;
      for (let i = 0; i < relativePath.length - 1; i++) {
        const segment = relativePath[i];
        if (!target[segment]) target[segment] = { elements: {} };
        if (!target[segment].elements) target[segment].elements = {};
        target = target[segment].elements!;
      }

      // Ensure parent element exists
      if (!target[fieldName]) target[fieldName] = {};
      const parent = target[fieldName];

      // Add slicing metadata if this is the first slice
      const slicingKey = relativePath.join('.');
      if (!parent.slicing && slicingDefs.has(slicingKey)) {
        const def = slicingDefs.get(slicingKey)!;
        parent.slicing = {
          discriminator: def.discriminator,
          rules: def.rules as 'open' | 'closed' | 'openAtEnd',
          ordered: def.ordered,
        };
      }

      // Add the slice
      if (!parent.slices) parent.slices = {};
      const sliceDef: FHIRSchemaSlice = {};
      if (el.min !== undefined) sliceDef.min = el.min;
      if (el.max && el.max !== '*') sliceDef.max = parseInt(el.max, 10);
      else if (el.max === '*') sliceDef.max = '*';

      // Extract match criteria from pattern/fixed and extension URL
      const converted = convertElement(el);
      if (converted.pattern) sliceDef.pattern = converted.pattern;
      if (converted.fixed) sliceDef.fixed = converted.fixed;
      if (converted.extensionUrl) sliceDef.extensionUrl = converted.extensionUrl;

      parent.slices[el.sliceName] = sliceDef;
      continue;
    }

    const pathParts = el.path.split('.');
    if (pathParts.length < 2 || pathParts[0] !== rootType) continue;

    const relativePath = pathParts.slice(1);
    let fieldName = relativePath[relativePath.length - 1];

    // Navigate to the correct nesting level, creating intermediates
    let target = schema.elements!;
    for (let i = 0; i < relativePath.length - 1; i++) {
      const segment = relativePath[i];
      if (!target[segment]) {
        target[segment] = { elements: {} };
      }
      if (!target[segment].elements) {
        target[segment].elements = {};
      }
      target = target[segment].elements!;
    }

    // Handle choice types (value[x])
    if (fieldName.endsWith('[x]')) {
      const baseName = fieldName.slice(0, -3);
      const choiceElement = convertElement(el);
      if (el.type) {
        choiceElement.choices = el.type.map(t => baseName + capitalize(t.code));
      }
      target[baseName] = choiceElement;
      fieldName = baseName;
    } else {
      // Merge into existing (intermediate may already exist from deeper path)
      if (target[fieldName]) {
        Object.assign(target[fieldName], convertElement(el));
      } else {
        target[fieldName] = convertElement(el);
      }
    }

    // Track top-level required fields
    if (relativePath.length === 1 && el.min && el.min > 0) {
      schema.required!.push(fieldName);
    }
  }

  // Clean up empty arrays
  if (schema.required!.length === 0) delete schema.required;

  return schema;
}

function convertElement(el: SDElement): FHIRSchemaElement {
  const result: FHIRSchemaElement = {};

  // Type
  if (el.type && el.type.length === 1) {
    const typeCode = el.type[0].code;
    result.type = typeCode;

    // Reference targets
    if (typeCode === 'Reference' && el.type[0].targetProfile) {
      result.refers = el.type[0].targetProfile;
    }

    // Extension / modifierExtension profile URL capture
    if ((typeCode === 'Extension') && el.type[0].profile?.length) {
      result.extensionUrl = el.type[0].profile[0];
    }
  } else if (el.type && el.type.length > 1) {
    // Polymorphic — type will be on each choice variant
    result.type = 'choice';
  }

  // Cardinality
  if (el.min !== undefined) result.min = el.min;
  if (el.max === '*') {
    result.collection = true;
  } else if (el.max !== undefined) {
    const maxNum = parseInt(el.max, 10);
    if (!isNaN(maxNum)) {
      result.max = maxNum;
      if (maxNum > 1) result.collection = true;
    }
  }

  if (el.min && el.min > 0) result.required = true;

  // Binding
  if (el.binding?.valueSet) {
    result.binding = {
      valueSet: el.binding.valueSet,
      strength: el.binding.strength as FHIRSchemaBinding['strength'],
    };
  }

  // Constraints
  if (el.constraint && el.constraint.length > 0) {
    result.constraints = el.constraint.map(c => ({
      key: c.key,
      severity: c.severity === 'error' ? 'error' : 'warning',
      human: c.human,
      expression: c.expression,
    }));
  }

  // Fixed values
  const fixedValue = el.fixedString ?? el.fixedCode ?? el.fixedUri ?? el.fixedBoolean;
  if (fixedValue !== undefined) result.fixed = fixedValue;

  // Pattern values
  const patternValue = el.patternCodeableConcept ?? el.patternCoding ?? el.patternIdentifier;
  if (patternValue !== undefined) result.pattern = patternValue;

  return result;
}

function mapKind(kind: string): FHIRSchema['kind'] {
  switch (kind) {
    case 'resource': return 'resource';
    case 'complex-type': return 'complex-type';
    case 'primitive-type': return 'primitive-type';
    case 'logical': return 'logical';
    default: return 'resource';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ============================================================================
// Deep Binding Extraction
// ============================================================================

/**
 * Walk all nested elements in a schema and collect bindings at every level.
 * Returns a flat map of dotted-path → binding for inspection/validation.
 */
export function extractAllBindings(schema: FHIRSchema): Map<string, FHIRSchemaBinding> {
  const bindings = new Map<string, FHIRSchemaBinding>();

  function walk(elements: Record<string, FHIRSchemaElement>, prefix: string) {
    for (const [name, el] of Object.entries(elements)) {
      const path = prefix ? `${prefix}.${name}` : name;
      if (el.binding) {
        bindings.set(path, el.binding);
      }
      if (el.elements) {
        walk(el.elements, path);
      }
    }
  }

  if (schema.elements) {
    walk(schema.elements, schema.type);
  }
  return bindings;
}

// ============================================================================
// Extension Support
// ============================================================================

/**
 * Extract extension definitions from elements that define extension slices.
 * Returns a map of extension URL → element definition.
 */
export function extractExtensionDefs(schema: FHIRSchema): Map<string, FHIRSchemaSlice> {
  const extensions = new Map<string, FHIRSchemaSlice>();
  const extElement = schema.elements?.['extension'];
  if (extElement?.slices) {
    for (const [name, slice] of Object.entries(extElement.slices)) {
      extensions.set(name, slice);
    }
  }
  return extensions;
}

// ============================================================================
// Convenience: convert + summarize
// ============================================================================

export function summarizeConversion(sd: StructureDefinition, resolveBase?: BaseResolver): {
  schema: FHIRSchema;
  stats: {
    totalElements: number;
    convertedElements: number;
    convertedSlices: number;
    requiredFields: number;
    boundFields: number;
    constraintCount: number;
    choiceTypes: number;
  };
} {
  const elements = sd.snapshot?.element || sd.differential?.element || [];
  const schema = convertToFHIRSchema(sd, resolveBase);

  const schemaElements = schema.elements ? Object.keys(schema.elements).length : 0;
  const convertedSlices = schema.elements
    ? Object.values(schema.elements).reduce((n, e) => n + (e.slices ? Object.keys(e.slices).length : 0), 0)
    : 0;
  const boundFields = schema.elements
    ? Object.values(schema.elements).filter(e => e.binding).length
    : 0;
  const constraintCount = (schema.constraints?.length ?? 0) +
    (schema.elements
      ? Object.values(schema.elements).reduce((n, e) => n + (e.constraints?.length ?? 0), 0)
      : 0);
  const choiceTypes = schema.elements
    ? Object.values(schema.elements).filter(e => e.choices).length
    : 0;

  return {
    schema,
    stats: {
      totalElements: elements.length,
      convertedElements: schemaElements,
      convertedSlices,
      requiredFields: schema.required?.length ?? 0,
      boundFields,
      constraintCount,
      choiceTypes,
    },
  };
}
