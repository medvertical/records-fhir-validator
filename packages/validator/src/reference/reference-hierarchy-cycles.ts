import type { ReferenceToValidate } from './recursive-reference-helpers.js';

export interface ReferenceHierarchyCycle {
  chain: string[];
  relationship: string;
  sourcePath?: string;
}

// These base relationships are explicitly hierarchical, unlike clinical backlinks
// and Patient.link.other: https://hl7.org/fhir/R4/references.html#circular
const STRICT_HIERARCHIES = new Set([
  'CarePlan.basedOn', 'CarePlan.replaces', 'CarePlan.partOf',
  'Encounter.partOf', 'Location.partOf', 'Organization.partOf',
]);

interface HierarchyEdge {
  target: string;
  path: string;
}

/** Keeps relationship-specific graphs separate from the general traversal guard. */
export class ReferenceHierarchyTracker {
  private readonly graphs = new Map<string, Map<string, HierarchyEdge[]>>();

  observe(resource: Record<string, unknown>, references: ReferenceToValidate[]): void {
    const { resourceType, id } = resource;
    if (typeof resourceType !== 'string' || typeof id !== 'string') return;
    const source = `${resourceType}/${id}`;
    for (const reference of references) {
      const relationship = `${resourceType}.${reference.fieldPath.replace(/\[\d+\]/g, '')}`;
      if (!STRICT_HIERARCHIES.has(relationship)) continue;
      // A versioned or foreign absolute target is not the identity of a local
      // current resource. Do not infer a hierarchy violation by collapsing it.
      if (!new RegExp(`^${resourceType}/[A-Za-z0-9.-]{1,64}$`).test(reference.reference)) continue;
      const graph = this.graphs.get(relationship) ?? new Map<string, HierarchyEdge[]>();
      const edges = graph.get(source) ?? [];
      if (!edges.some(edge => edge.target === reference.reference)) {
        edges.push({ target: reference.reference, path: reference.fieldPath });
      }
      graph.set(source, edges);
      this.graphs.set(relationship, graph);
    }
  }

  findCycles(rootIdentity: string): ReferenceHierarchyCycle[] {
    const cycles: ReferenceHierarchyCycle[] = [];
    for (const [relationship, graph] of this.graphs) {
      const visited = new Set<string>();
      const active: string[] = [];
      const walk = (identity: string): void => {
        const cycleStart = active.indexOf(identity);
        if (cycleStart >= 0) {
          const chain = [...active.slice(cycleStart), identity];
          const rootIndex = chain.indexOf(rootIdentity);
          const rootTarget = rootIndex >= 0 ? chain[rootIndex + 1] : undefined;
          const sourcePath = graph.get(rootIdentity)?.find(edge => edge.target === rootTarget)?.path;
          cycles.push({ chain, relationship, ...(sourcePath ? { sourcePath } : {}) });
          return;
        }
        if (visited.has(identity)) return;
        visited.add(identity);
        active.push(identity);
        for (const edge of graph.get(identity) ?? []) walk(edge.target);
        active.pop();
      };
      for (const identity of graph.keys()) walk(identity);
    }
    return cycles;
  }
}
