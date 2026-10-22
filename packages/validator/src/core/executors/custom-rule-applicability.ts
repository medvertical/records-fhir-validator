import type { EngineCustomRule } from '../../persistence/custom-rules-source.js';

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function isCustomRuleApplicable(rule: Pick<EngineCustomRule, 'fhirVersions' | 'profilesAny'>, resource: unknown, fhirVersion?: string, definition?: { url?: string; version?: string }): boolean {
    if (rule.fhirVersions?.length && (!fhirVersion || !rule.fhirVersions.includes(fhirVersion))) return false;
    if (!rule.profilesAny?.length) return true;
    const declared = record(record(resource)?.meta)?.profile;
    const profiles = Array.isArray(declared) ? declared.filter((value): value is string => typeof value === 'string') : [];
    if (definition?.url) profiles.push(`${definition.url}${definition.version ? `|${definition.version}` : ''}`);
    return rule.profilesAny.some(expected => profiles.some(actual => expected.includes('|') ? actual === expected : actual.split('|', 1)[0] === expected));
}
