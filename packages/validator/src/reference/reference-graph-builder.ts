/**
 * Reference Graph Builder
 *
 * Builds the reference graph consumed by the circular reference detector:
 * extracts reference strings from resources/Bundles and resolves reference
 * strings to graph node IDs.
 */

import { parseReference } from './reference-type-extractor';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface ReferenceNode {
  /** Unique identifier for this node (fullUrl, ResourceType/id, or #id) */
  id: string;
  /** Resource type if known */
  resourceType?: string;
  /** References from this node to other nodes */
  references: string[];
  /** Depth in the reference chain */
  depth: number;
  /** Parent node ID */
  parent?: string;
}

export interface ReferenceGraph {
  /** All nodes in the graph */
  nodes: Map<string, ReferenceNode>;
  /** Adjacency list for quick lookups */
  adjacencyList: Map<string, Set<string>>;
  /** Root nodes (nodes with no incoming references) */
  rootNodes: Set<string>;
}

// ============================================================================
// Graph Construction
// ============================================================================

/**
 * Build a reference graph from a resource
 */
export function buildReferenceGraph(
  resource: any,
  visitedObjects: WeakSet<object>
): ReferenceGraph {
  const nodes = new Map<string, ReferenceNode>();
  const adjacencyList = new Map<string, Set<string>>();
  const rootNodes = new Set<string>();

  // Handle Bundle resources
  if (resource.resourceType === 'Bundle' && resource.entry) {
    buildBundleGraph(resource, nodes, adjacencyList, rootNodes, visitedObjects);
  } else {
    // Handle single resource
    buildResourceGraph(resource, nodes, adjacencyList, rootNodes, visitedObjects);
  }

  return { nodes, adjacencyList, rootNodes };
}

/**
 * Build graph for Bundle resources
 */
function buildBundleGraph(
  bundle: any,
  nodes: Map<string, ReferenceNode>,
  adjacencyList: Map<string, Set<string>>,
  rootNodes: Set<string>,
  visitedObjects: WeakSet<object>
): void {
  if (!bundle.entry || !Array.isArray(bundle.entry)) {
    return;
  }

  // First pass: create nodes for all entries
  bundle.entry.forEach((entry: any, index: number) => {
    if (entry.resource) {
      const nodeId = entry.fullUrl || `entry[${index}]`;
      const references = extractReferencesFromResource(entry.resource, visitedObjects);

      nodes.set(nodeId, {
        id: nodeId,
        resourceType: entry.resource.resourceType,
        references,
        depth: 0,
      });

      adjacencyList.set(nodeId, new Set(references));
      rootNodes.add(nodeId); // Initially all nodes are roots
    }
  });

  // Second pass: build adjacency list and determine actual roots
  for (const [_nodeId, nodeRefs] of adjacencyList) {
    for (const ref of nodeRefs) {
      // If this reference points to another node, that node is not a root
      if (nodes.has(ref) || findNodeByReference(ref, nodes)) {
        const targetId = findNodeByReference(ref, nodes);
        if (targetId) {
          rootNodes.delete(targetId);
        }
      }
    }
  }
}

/**
 * Build graph for single resource
 */
function buildResourceGraph(
  resource: any,
  nodes: Map<string, ReferenceNode>,
  adjacencyList: Map<string, Set<string>>,
  rootNodes: Set<string>,
  visitedObjects: WeakSet<object>
): void {
  const nodeId = resource.resourceType && resource.id
    ? `${resource.resourceType}/${resource.id}`
    : resource.id || 'root';

  const references = extractReferencesFromResource(resource, visitedObjects);

  // Only create node if there are references or contained resources
  const hasContained = resource.contained && Array.isArray(resource.contained) && resource.contained.length > 0;

  if (references.length > 0 || hasContained) {
    nodes.set(nodeId, {
      id: nodeId,
      resourceType: resource.resourceType,
      references,
      depth: 0,
    });

    adjacencyList.set(nodeId, new Set(references));
    rootNodes.add(nodeId);
  }

  // Also add contained resources as nodes
  if (hasContained) {
    resource.contained.forEach((contained: any) => {
      if (contained.id && contained.resourceType) {
        const containedId = `#${contained.id}`;
        const containedRefs = extractReferencesFromResource(contained, visitedObjects);

        nodes.set(containedId, {
          id: containedId,
          resourceType: contained.resourceType,
          references: containedRefs,
          depth: 1,
          parent: nodeId,
        });

        adjacencyList.set(containedId, new Set(containedRefs));
      }
    });
  }
}

/**
 * Find node by reference string
 */
export function findNodeByReference(reference: string, nodes: Map<string, ReferenceNode>): string | null {
  // Direct match
  if (nodes.has(reference)) {
    return reference;
  }

  // Parse reference and try to match
  const parseResult = parseReference(reference);

  // Try ResourceType/id format
  if (parseResult.resourceType && parseResult.resourceId) {
    const relativeId = `${parseResult.resourceType}/${parseResult.resourceId}`;
    if (nodes.has(relativeId)) {
      return relativeId;
    }
  }

  // Try to find by matching resource type and ID
  for (const [nodeId, _node] of nodes) {
    if (parseResult.resourceType && parseResult.resourceId) {
      if (nodeId.includes(parseResult.resourceType) && nodeId.includes(parseResult.resourceId)) {
        return nodeId;
      }
    }
  }

  return null;
}

/**
 * Extract all reference strings from a resource
 */
function extractReferencesFromResource(
  resource: any,
  visitedObjects: WeakSet<object>,
  path: string = '',
  depth: number = 0
): string[] {
  const references: string[] = [];

  // Safety check: prevent deep recursion
  if (depth > 50) {
    logger.warn(`[CircularReferenceDetector] Max recursion depth reached at path: ${path}`);
    return references;
  }

  if (!resource || typeof resource !== 'object') {
    return references;
  }

  // Prevent infinite recursion on circular object structures
  if (visitedObjects.has(resource)) {
    return references;
  }
  visitedObjects.add(resource);

  // Check if this is a reference object
  if (resource.reference && typeof resource.reference === 'string') {
    references.push(resource.reference);
  }

  // Recursively check all properties
  try {
    for (const [key, value] of Object.entries(resource)) {
      // Skip contained to avoid confusion with Bundle entries
      if (key === 'contained' && path === '') {
        continue;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (item && typeof item === 'object') {
            references.push(...extractReferencesFromResource(item, visitedObjects, `${path}.${key}[${index}]`, depth + 1));
          }
        });
      } else if (value && typeof value === 'object') {
        references.push(...extractReferencesFromResource(value, visitedObjects, `${path}.${key}`, depth + 1));
      }
    }
  } catch (error) {
    logger.warn(`[CircularReferenceDetector] Error extracting references at path ${path}:`, error instanceof Error ? error.message : 'Unknown error');
  }

  return references;
}
