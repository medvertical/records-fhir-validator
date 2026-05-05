/**
 * Circular Reference Detector
 * 
 * Detects circular references in FHIR resources to prevent infinite loops during validation.
 * Tracks reference chains and identifies cycles using graph traversal algorithms.
 * 
 * Task 6.5: Add circular reference detection to prevent infinite loops
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

export interface CircularReferenceDetectionResult {
  /** Whether a circular reference was detected */
  hasCircularReference: boolean;
  /** The circular reference chain if detected */
  circularChain?: string[];
  /** Total references checked */
  totalReferences: number;
  /** Maximum depth reached */
  maxDepth: number;
  /** All reference chains found */
  referenceChains?: string[][];
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
// Circular Reference Detector Class
// ============================================================================

export class CircularReferenceDetector {
  private visitedNodes: Set<string> = new Set();
  private currentPath: string[] = [];
  private maxDepthLimit: number;
  private visitedObjects: WeakSet<object> = new WeakSet(); // Track visited objects to prevent infinite recursion

  constructor(maxDepthLimit: number = 10) {
    this.maxDepthLimit = maxDepthLimit;
  }

  /**
   * Detect circular references in a resource or Bundle
   */
  detectCircularReferences(
    resource: any,
    _startingReferences?: string[]
  ): CircularReferenceDetectionResult {
    // Handle null/undefined gracefully
    if (!resource || typeof resource !== 'object') {
      return {
        hasCircularReference: false,
        totalReferences: 0,
        maxDepth: 0,
      };
    }

    this.reset();

    // Build reference graph
    const graph = this.buildReferenceGraph(resource);

    // Find circular references using DFS
    const circularChains: string[][] = [];
    let maxDepth = 0;

    for (const rootNode of graph.rootNodes) {
      const chains = this.findCircularChainsFromNode(rootNode, graph);
      circularChains.push(...chains);

      // Track max depth
      const nodeDepth = graph.nodes.get(rootNode)?.depth || 0;
      maxDepth = Math.max(maxDepth, nodeDepth);
    }

    // If no root nodes, check all nodes (might all be in cycles)
    if (graph.rootNodes.size === 0 && graph.nodes.size > 0) {
      for (const [nodeId] of graph.nodes) {
        if (!this.visitedNodes.has(nodeId)) {
          const chains = this.findCircularChainsFromNode(nodeId, graph);
          circularChains.push(...chains);
        }
      }
    }

    return {
      hasCircularReference: circularChains.length > 0,
      circularChain: circularChains[0] || undefined,
      totalReferences: graph.nodes.size,
      maxDepth,
      referenceChains: circularChains.length > 0 ? circularChains : undefined,
    };
  }

  /**
   * Check if adding a reference would create a circular reference
   */
  wouldCreateCircularReference(
    currentPath: string[],
    newReference: string
  ): boolean {
    // Simple check: see if newReference is already in the current path
    return currentPath.includes(newReference);
  }

  /**
   * Build a reference graph from a resource
   */
  private buildReferenceGraph(resource: any): ReferenceGraph {
    const nodes = new Map<string, ReferenceNode>();
    const adjacencyList = new Map<string, Set<string>>();
    const rootNodes = new Set<string>();

    // Handle Bundle resources
    if (resource.resourceType === 'Bundle' && resource.entry) {
      this.buildBundleGraph(resource, nodes, adjacencyList, rootNodes);
    } else {
      // Handle single resource
      this.buildResourceGraph(resource, nodes, adjacencyList, rootNodes);
    }

    return { nodes, adjacencyList, rootNodes };
  }

  /**
   * Build graph for Bundle resources
   */
  private buildBundleGraph(
    bundle: any,
    nodes: Map<string, ReferenceNode>,
    adjacencyList: Map<string, Set<string>>,
    rootNodes: Set<string>
  ): void {
    if (!bundle.entry || !Array.isArray(bundle.entry)) {
      return;
    }

    // First pass: create nodes for all entries
    bundle.entry.forEach((entry: any, index: number) => {
      if (entry.resource) {
        const nodeId = entry.fullUrl || `entry[${index}]`;
        const references = this.extractReferencesFromResource(entry.resource);

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
        if (nodes.has(ref) || this.findNodeByReference(ref, nodes)) {
          const targetId = this.findNodeByReference(ref, nodes);
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
  private buildResourceGraph(
    resource: any,
    nodes: Map<string, ReferenceNode>,
    adjacencyList: Map<string, Set<string>>,
    rootNodes: Set<string>
  ): void {
    const nodeId = resource.resourceType && resource.id
      ? `${resource.resourceType}/${resource.id}`
      : resource.id || 'root';

    const references = this.extractReferencesFromResource(resource);

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
          const containedRefs = this.extractReferencesFromResource(contained);

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
   * Find circular reference chains from a starting node
   */
  private findCircularChainsFromNode(
    nodeId: string,
    graph: ReferenceGraph
  ): string[][] {
    const circularChains: string[][] = [];
    this.currentPath = [];
    this.visitedNodes.clear();

    this.dfsDetectCycle(nodeId, graph, circularChains);

    return circularChains;
  }

  /**
   * DFS traversal to detect cycles
   */
  private dfsDetectCycle(
    nodeId: string,
    graph: ReferenceGraph,
    circularChains: string[][]
  ): void {
    // Check if we've already visited this node in the current path (cycle detected)
    if (this.currentPath.includes(nodeId)) {
      // Found a circular reference
      const cycleStart = this.currentPath.indexOf(nodeId);
      const cycle = [...this.currentPath.slice(cycleStart), nodeId];
      circularChains.push(cycle);
      return;
    }

    // Check depth limit
    if (this.currentPath.length >= this.maxDepthLimit) {
      logger.warn(`[CircularReferenceDetector] Max depth ${this.maxDepthLimit} reached at node ${nodeId}`);
      return;
    }

    // Mark as visited in global set (to avoid re-processing)
    if (this.visitedNodes.has(nodeId)) {
      return;
    }
    this.visitedNodes.add(nodeId);

    // Add to current path
    this.currentPath.push(nodeId);

    // Get neighbors
    const neighbors = graph.adjacencyList.get(nodeId);
    if (neighbors) {
      for (const neighborId of neighbors) {
        // Find the actual node ID (might need resolution)
        const resolvedNeighbor = this.findNodeByReference(neighborId, graph.nodes) || neighborId;

        if (graph.nodes.has(resolvedNeighbor)) {
          this.dfsDetectCycle(resolvedNeighbor, graph, circularChains);
        }
      }
    }

    // Remove from current path (backtrack)
    this.currentPath.pop();
  }

  /**
   * Find node by reference string
   */
  private findNodeByReference(reference: string, nodes: Map<string, ReferenceNode>): string | null {
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
  private extractReferencesFromResource(resource: any, path: string = '', depth: number = 0): string[] {
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
    if (this.visitedObjects.has(resource)) {
      return references;
    }
    this.visitedObjects.add(resource);

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
              references.push(...this.extractReferencesFromResource(item, `${path}.${key}[${index}]`, depth + 1));
            }
          });
        } else if (value && typeof value === 'object') {
          references.push(...this.extractReferencesFromResource(value, `${path}.${key}`, depth + 1));
        }
      }
    } catch (error) {
      logger.warn(`[CircularReferenceDetector] Error extracting references at path ${path}:`, error instanceof Error ? error.message : 'Unknown error');
    }

    return references;
  }

  /**
   * Reset detector state
   */
  private reset(): void {
    this.visitedNodes.clear();
    this.currentPath = [];
    this.visitedObjects = new WeakSet(); // Reset object tracking
  }

  /**
   * Check if a reference chain exceeds depth limit
   */
  isDepthLimitExceeded(chain: string[]): boolean {
    return chain.length > this.maxDepthLimit;
  }

  /**
   * Get maximum depth limit
   */
  getMaxDepthLimit(): number {
    return this.maxDepthLimit;
  }

  /**
   * Set maximum depth limit
   */
  setMaxDepthLimit(limit: number): void {
    this.maxDepthLimit = limit;
  }

  /**
   * Validate a reference chain for circular references
   */
  validateReferenceChain(chain: string[]): {
    isValid: boolean;
    circularAt?: number;
    circularReference?: string;
  } {
    const seen = new Set<string>();

    for (let i = 0; i < chain.length; i++) {
      const ref = chain[i];

      if (seen.has(ref)) {
        return {
          isValid: false,
          circularAt: i,
          circularReference: ref,
        };
      }

      seen.add(ref);
    }

    return { isValid: true };
  }

  /**
   * Format circular reference chain for display
   */
  formatCircularChain(chain: string[]): string {
    return chain.join(' → ');
  }

  /**
   * Get reference chain statistics
   */
  getChainStatistics(chains: string[][]): {
    totalChains: number;
    averageLength: number;
    maxLength: number;
    minLength: number;
    circularChains: number;
  } {
    if (chains.length === 0) {
      return {
        totalChains: 0,
        averageLength: 0,
        maxLength: 0,
        minLength: 0,
        circularChains: 0,
      };
    }

    const lengths = chains.map(c => c.length);
    const circularChains = chains.filter(chain => {
      const validation = this.validateReferenceChain(chain);
      return !validation.isValid;
    }).length;

    return {
      totalChains: chains.length,
      averageLength: lengths.reduce((sum, len) => sum + len, 0) / lengths.length,
      maxLength: Math.max(...lengths),
      minLength: Math.min(...lengths),
      circularChains,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let detectorInstance: CircularReferenceDetector | null = null;

export function getCircularReferenceDetector(maxDepth?: number): CircularReferenceDetector {
  if (!detectorInstance) {
    detectorInstance = new CircularReferenceDetector(maxDepth);
  }
  return detectorInstance;
}

export function resetCircularReferenceDetector(): void {
  detectorInstance = null;
}

