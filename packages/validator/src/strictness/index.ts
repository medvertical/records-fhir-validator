/**
 * Strictness Filter Boundary
 *
 * Re-exports the strictness-severity helpers. The implementation
 * lives next to this file (`./strictness-filter.ts`) — physical
 * extraction from `server/services/validation/utils/` happened during
 * the engine-extraction work; this index file is what other engine
 * modules import to keep import paths short.
 *
 * Server-side consumers outside the engine subtree (per-aspect
 * dispatcher, profile-validator, terminology fallback manager,
 * reference-validator) import from this same boundary.
 */

export {
    applyStrictnessSeverity,
    resolveStrictnessConfig,
    countSeveritiesWithStrictness,
    getEffectiveSeverity,
    getStrictnessDescription,
} from './strictness-filter';

export {
    applyPublicationEscalation,
    isForPublication,
} from './publication-escalation';

export type { ValidationStrictness } from './strictness-filter';
