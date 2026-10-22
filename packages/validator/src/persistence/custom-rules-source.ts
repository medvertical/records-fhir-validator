/** Rule shape consumed by the engine's custom-rule executor. */
export interface EngineCustomRule {
    ruleId: string;
    name: string;
    expression: string;
    severity: 'error' | 'warning' | 'information';
    validationMessage?: string | null;
    category?: string | null;
    fhirVersions?: readonly string[] | null;
    profilesAny?: readonly string[];
    path?: string;
}

/** Optional host capability for organization-scoped business rules. */
export interface CustomRulesSource {
    getRulesByResourceType(
        resourceType: string,
        context?: { organizationId?: number },
    ): Promise<EngineCustomRule[]>;
}

const NOOP_CUSTOM_RULES_SOURCE: CustomRulesSource = {
    async getRulesByResourceType() {
        return [];
    },
};

let activeCustomRulesSource: CustomRulesSource = NOOP_CUSTOM_RULES_SOURCE;

export function setCustomRulesSource(source: CustomRulesSource): void {
    activeCustomRulesSource = source;
}

export function getCustomRulesSource(): CustomRulesSource {
    return activeCustomRulesSource;
}
