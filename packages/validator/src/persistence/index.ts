/**
 * Host-provided persistence boundaries for the standalone validator.
 *
 * Profile resolution and custom rules are independent runtime capabilities.
 * This module preserves the public host surface while each capability owns
 * its contract and installation lifecycle in a dedicated deep module.
 */

export {
    getProfileSource,
    getProfileSourcePackageDirectories,
    getProfileSourceRevision,
    setProfileSource,
    type ProfileResolutionEntry,
    type ProfileSource,
    type ProfileLookupSource,
    type ProfileWarmupSource,
    type ExternalProfileSource,
    type CanonicalResourceSource,
    type CodeSystemAvailabilitySource,
    type ProfileSourceContext,
} from './profile-source.js';
export {
    getCustomRulesSource,
    setCustomRulesSource,
    type CustomRulesSource,
    type EngineCustomRule,
} from './custom-rules-source.js';
