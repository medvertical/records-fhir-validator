/**
 * Circular Reference Detector
 * 
 * Detects circular references in FHIR resources to prevent infinite loops during validation.
 * Tracks reference chains and identifies cycles using graph traversal algorithms.
 * 
 * Task 6.5: Add circular reference detection to prevent infinite loops
 */

import { logger } from '../logger';
import {
  buildReferenceGraph,
  findNodeByReference,
  type ReferenceNode,
  type ReferenceGraph,
} from './reference-graph-builder';

// ============================================================================
// Types
// ============================================================================

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

// Re-exported for backward compatibility; graph types now live in the builder.
export type { ReferenceNode, ReferenceGraph };

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
    const graph = buildReferenceGraph(resource, this.visitedObjects);

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
        const resolvedNeighbor = findNodeByReference(neighborId, graph.nodes) || neighborId;

        if (graph.nodes.has(resolvedNeighbor)) {
          this.dfsDetectCycle(resolvedNeighbor, graph, circularChains);
        }
      }
    }

    // Remove from current path (backtrack)
    this.currentPath.pop();
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

