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
    shouldValidateRequired,
    parseElementPath,
    getParentPath,
    isRootElement,
    getAncestorPaths,
    hasParentElement,
    hasAllAncestors,
    getPathDebugInfo,
} from './element-path-resolver.js';

export {
    getValidationTargets,
    isArrayAtPath,
    expandPathWithArrayIndex,
} from './element-validation-targets.js';

export { getValueAtPath } from '../core/validation-utils.js';
export type { PathComponents } from './element-path-resolver.js';
export type { ValidationTarget } from './element-validation-targets.js';
