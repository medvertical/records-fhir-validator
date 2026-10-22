import fhirpath from 'fhirpath';
import { getFhirPathModel } from '../core/fhirpath-context.js';
import { VersionedExpressionCache } from './fhirpath-expression-cache-core.js';
import { isResolvedPrimitiveSidecarValue } from '../core/fhir-primitive-sidecar.js';

/** Keeps primitive values and their underscore metadata together during evaluation. */
export class SDFHIRPathPrimitiveContext {
  private readonly paths = new VersionedExpressionCache({
    maxSize: 1000,
    compile: (path, version) => fhirpath.compile(`${path}.capturePrimitiveContext()`, getFhirPathModel(version), {
      resolveInternalTypes: false,
    }),
  });

  resolve(value: unknown, resource: unknown, path: string, version: 'R4' | 'R5' | 'R6'): unknown {
    if (!['string', 'number', 'boolean'].includes(typeof value) && !isResolvedPrimitiveSidecarValue(value)) return value;
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return value;
    // Paths come from JSON traversal, not arbitrary FHIRPath supplied by an IG.
    if (!/^[A-Za-z][A-Za-z0-9]*(?:\[\d+\])?(?:\.[A-Za-z][A-Za-z0-9]*(?:\[\d+\])?)+$/.test(path)) {
      return value;
    }
    // Capture before the library's result conversion drops value-less primitives.
    // Its supported invocation API keeps both type information and extensions.
    let nodes: unknown[] = [];
    this.paths.getOrCompile(path, version)(resource, {}, {
      userInvocationTable: { capturePrimitiveContext: {
        fn: (inputs: unknown[]) => { nodes = inputs; return true; },
        arity: { 0: [] },
        internalStructures: true,
      } },
    });
    return nodes.length === 1 ? nodes : value;
  }
}
