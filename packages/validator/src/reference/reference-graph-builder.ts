/**
 * Reference Graph Builder
 *
 * Builds the reference graph consumed by the circular reference detector:
 * extracts reference strings from resources/Bundles and resolves reference
 * strings to graph node IDs.
 */

import { parseReference } from './reference-type-extractor.js';
import {
  extractBundleEntries,
  findReferencesInResource,
} from './bundle-reference-finder.js';

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
  resource: unknown,
): ReferenceGraph {
  const nodes = new Map<string, ReferenceNode>();
  const adjacencyList = new Map<string, Set<string>>();
  const rootNodes = new Set<string>();

  const resourceRecord = toRecord(resource);
  if (!resourceRecord) {
    return { nodes, adjacencyList, rootNodes };
  }

  // Handle Bundle resources
  if (resourceRecord.resourceType === 'Bundle') {
    buildBundleGraph(resourceRecord, nodes, adjacencyList, rootNodes);
  } else {
    // Handle single resource
    buildResourceGraph(resourceRecord, nodes, adjacencyList, rootNodes);
  }

  return { nodes, adjacencyList, rootNodes };
}

/**
 * Build graph for Bundle resources
 */
function buildBundleGraph(
  bundle: unknown,
  nodes: Map<string, ReferenceNode>,
  adjacencyList: Map<string, Set<string>>,
  rootNodes: Set<string>,
): void {
  const entries = extractBundleEntries(bundle);

  // First pass: create nodes for all entries
  entries.forEach((entry, index) => {
    if (entry.resource) {
      const nodeId = entry.fullUrl || `entry[${index}]`;
      const references = extractReferenceStrings(entry.resource);

      nodes.set(nodeId, {
        id: nodeId,
        resourceType: getString(entry.resource, 'resourceType'),
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
  resource: Record<string, unknown>,
  nodes: Map<string, ReferenceNode>,
  adjacencyList: Map<string, Set<string>>,
  rootNodes: Set<string>,
): void {
  const resourceType = getString(resource, 'resourceType');
  const resourceId = getString(resource, 'id');
  const nodeId = resourceType && resourceId
    ? `${resourceType}/${resourceId}`
    : resourceId || 'root';

  const references = extractReferenceStrings(resource);

  // Only create node if there are references or contained resources
  const contained = resource.contained;
  const hasContained = Array.isArray(contained) && contained.length > 0;

  if (references.length > 0 || hasContained) {
    nodes.set(nodeId, {
      id: nodeId,
      resourceType,
      references,
      depth: 0,
    });

    adjacencyList.set(nodeId, new Set(references));
    rootNodes.add(nodeId);
  }

  // Also add contained resources as nodes
  if (Array.isArray(contained)) {
    contained.forEach((candidate) => {
      const containedResource = toRecord(candidate);
      const containedResourceId = containedResource && getString(containedResource, 'id');
      const containedResourceType = containedResource && getString(containedResource, 'resourceType');
      if (containedResource && containedResourceId && containedResourceType) {
        const containedId = `#${containedResourceId}`;
        const containedRefs = extractReferenceStrings(containedResource);

        nodes.set(containedId, {
          id: containedId,
          resourceType: containedResourceType,
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

  // Match absolute/fullUrl node IDs by their exact parsed resource identity.
  if (parseResult.resourceType && parseResult.resourceId) {
    for (const nodeId of nodes.keys()) {
      const nodeReference = parseReference(nodeId);
      if (
        nodeReference.resourceType === parseResult.resourceType
        && nodeReference.resourceId === parseResult.resourceId
      ) {
        return nodeId;
      }
    }
  }

  return null;
}

function extractReferenceStrings(resource: unknown): string[] {
  return findReferencesInResource(resource).map(({ reference }) => reference);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}
