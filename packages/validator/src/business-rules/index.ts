/**
 * Business Rules Boundary
 *
 * Re-exports the path-resolution helpers. The implementation lives
 * next to this file (`./element-path-resolver.ts`) — physical
 * extraction from `server/services/validation/engine/business-rules/`
 * happened during the engine-extraction work; this index file is
 * what other engine modules import.
 */

export {
    getValidationTargets,
    shouldValidateRequired,
    parseElementPath,
    getParentPath,
    isRootElement,
    getAncestorPaths,
    getValueAtPath,
    hasParentElement,
    hasAllAncestors,
    getPathDebugInfo,
    isArrayAtPath,
    expandPathWithArrayIndex,
} from './element-path-resolver';

export type { PathComponents, ValidationTarget } from './element-path-resolver';
