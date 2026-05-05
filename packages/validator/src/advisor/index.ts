/**
 * Advisor Rules Boundary
 *
 * Re-exports the advisor-rules pipeline. The implementations live
 * next to this file (`./advisor-rules.ts`, `./builtin-rules.ts`) —
 * physical extraction from `server/services/validation/advisor/`
 * happened during the engine-extraction work; this index file is
 * what other engine modules and the server's per-aspect dispatcher
 * import.
 */

export {
    applyAdvisorRules,
    convertGematikRules,
    convertFirelyQCRules,
} from './advisor-rules';

export type {
    AdvisorRule,
    AdvisorRuleMatch,
    AdvisorRuleTransform,
    AdvisorRuleSet,
    AdvisorRuleApplicationResult,
    GematikPluginYaml,
    GematikTransformation,
    FirelyQCRule,
} from './advisor-rules';

export {
    CANONICAL_URL_SANITY_RULES,
    CANONICAL_URL_NORMALIZATIONS,
    normalizeCanonicalUrl,
} from './builtin-rules';
