import type {
  FHIRSchema,
  FHIRSchemaElement,
  FHIRSchemaSlice,
} from './fhir-schema-types';
import type {
  ValidationGraph,
  ValidationGraphNode,
  ValidationGraphStats,
} from './validation-graph-types';

export function compileFHIRSchemaToValidationGraph(schema: FHIRSchema): ValidationGraph {
  const nodes = compileElements(schema, schema.elements ?? {}, schema.type, schema.type, 1);
  return {
    url: schema.url,
    name: schema.name,
    type: schema.type,
    base: schema.base,
    nodes,
    stats: summarizeGraph(nodes),
  };
}

function compileElements(
  schema: FHIRSchema,
  elements: Record<string, FHIRSchemaElement>,
  parentPath: string,
  parentSchemaPath: string,
  depth: number,
): ValidationGraphNode[] {
  return Object.entries(elements).map(([name, element]) => {
    const path = `${parentPath}.${name}`;
    const schemaPath = `${parentSchemaPath}.${name}`;
    const node = compileElement(schema, name, path, schemaPath, element, depth);

    const children: ValidationGraphNode[] = [];
    if (element.elements) {
      children.push(...compileElements(schema, element.elements, path, schemaPath, depth + 1));
    }

    if (element.slices) {
      for (const [sliceName, slice] of Object.entries(element.slices)) {
        children.push(compileSlice(schema, sliceName, path, schemaPath, slice, depth + 1));
      }
    }

    if (children.length > 0) {
      node.children = children;
    }

    return node;
  });
}

function compileElement(
  schema: FHIRSchema,
  name: string,
  path: string,
  schemaPath: string,
  element: FHIRSchemaElement,
  depth: number,
): ValidationGraphNode {
  return {
    path,
    schemaPath,
    name,
    type: element.type,
    collection: element.collection,
    min: element.min,
    max: element.max,
    required: element.required,
    choices: element.choices,
    fixed: element.fixed,
    pattern: element.pattern,
    binding: element.binding,
    constraints: element.constraints,
    refers: element.refers,
    referenceTargetTypes: element.referenceTargetTypes,
    slicing: element.slicing,
    source: {
      schemaUrl: schema.url,
      schemaType: schema.type,
    },
  };
}

function compileSlice(
  schema: FHIRSchema,
  sliceName: string,
  parentPath: string,
  parentSchemaPath: string,
  slice: FHIRSchemaSlice,
  depth: number,
): ValidationGraphNode {
  const path = `${parentPath}:${sliceName}`;
  const schemaPath = `${parentSchemaPath}:${sliceName}`;
  const node: ValidationGraphNode = {
    path,
    schemaPath,
    name: sliceName,
    sliceName,
    type: slice.type,
    min: slice.min,
    max: slice.max,
    choices: slice.choices,
    fixed: slice.fixed,
    pattern: slice.pattern,
    binding: slice.binding,
    constraints: slice.constraints,
    refers: slice.refers,
    referenceTargetTypes: slice.referenceTargetTypes,
    source: {
      schemaUrl: schema.url,
      schemaType: schema.type,
    },
  };

  if (slice.elements) {
    node.children = compileElements(schema, slice.elements, path, schemaPath, depth + 1);
  }

  return node;
}

export function summarizeGraph(nodes: ValidationGraphNode[]): ValidationGraphStats {
  const stats: ValidationGraphStats = {
    nodeCount: 0,
    sliceNodeCount: 0,
    maxDepth: 0,
    requiredCount: 0,
    choiceCount: 0,
    fixedPatternCount: 0,
    bindingCount: 0,
    referenceCount: 0,
    constraintCount: 0,
    slicingCount: 0,
  };

  const visit = (node: ValidationGraphNode): void => {
    stats.nodeCount += 1;
    if (node.sliceName) stats.sliceNodeCount += 1;
    stats.maxDepth = Math.max(stats.maxDepth, node.path.split('.').length);
    if (node.required || (node.min ?? 0) > 0) stats.requiredCount += 1;
    if (node.type === 'choice' || node.choices?.length) stats.choiceCount += 1;
    if (node.fixed !== undefined || node.pattern !== undefined) stats.fixedPatternCount += 1;
    if (node.binding) stats.bindingCount += 1;
    if (node.refers?.length) stats.referenceCount += 1;
    if (node.constraints?.length) stats.constraintCount += node.constraints.length;
    if (node.slicing) stats.slicingCount += 1;
    for (const child of node.children ?? []) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return stats;
}
