/**
 * Engine Issues — Issue-factory + Fix-suggestion Boundary
 *
 * Re-exports the issue-construction helpers consumed by every engine
 * module. The implementations live next to this file
 * (`./issue-factory.ts`, `./fix-suggestions.ts`,
 * `./message-catalog.ts`, `./message-templates.ts`) — physical
 * extraction from `server/services/validation/` happened during the
 * engine-extraction work; this index file is what other engine
 * modules and a few external server consumers (HAPI pipeline,
 * error-mapping-service, metadata validators) import.
 *
 * Module identity matters here: the issue counter and message
 * templates carry mutable state, so all consumers must reach the same
 * physical module instance. Re-exports preserve that identity.
 */

export {
    type CreateIssueParams,
    createValidationIssue,
    createBindingViolation,
    createBindingUnverified,
    createRequiredElementMissing,
    createReferenceTypeMismatch,
    createConstraintViolation,
    createValidationError,
    resetIssueCounter,
} from './issue-factory';

export {
    type FixSuggestion,
    FixSuggestions,
    getFixSuggestion,
    formatFixSuggestion,
} from './fix-suggestions';

export {
    applyFixPatch,
    type FixApplyResult,
} from './fix-applier';
