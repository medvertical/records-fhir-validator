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
import type {
  FHIRSchema,
  FHIRSchemaBinding,
  FHIRSchemaElement,
  FHIRSchemaSlice,
  StructureDefinition,
} from './fhir-schema-types';
import {
  mergeDifferentialWithBase,
  resolveElements,
  type BaseResolver,
} from './structure-definition-elements';
import { populateSchemaElements } from './fhir-schema-tree-builder';

export type {
  FHIRSchema,
  FHIRSchemaBinding,
  FHIRSchemaConstraint,
  FHIRSchemaElement,
  FHIRSchemaSlice,
  FHIRSchemaSlicing,
  SDElement,
  StructureDefinition,
} from './fhir-schema-types';
export { mergeDifferentialWithBase };
export type { BaseResolver };

// ============================================================================
// Converter
// ============================================================================

const _PRIMITIVE_TYPES = new Set([
  'boolean', 'integer', 'string', 'decimal', 'uri', 'url', 'canonical',
  'base64Binary', 'instant', 'date', 'dateTime', 'time', 'code', 'oid',
  'id', 'markdown', 'unsignedInt', 'positiveInt', 'uuid', 'xhtml',
]);

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

  populateSchemaElements(schema, childElements, sd.type);

  // Clean up empty arrays
  if (schema.required!.length === 0) delete schema.required;

  return schema;
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
