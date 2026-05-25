const CHOICE_BASES = [
    'value', 'effective', 'onset', 'abatement', 'deceased', 'multipleBirth',
    'defaultValue', 'medication', 'reported', 'occurrence', 'timing',
    'product', 'serviced', 'location', 'allowed', 'used',
    'rate', 'born', 'age',
];

export function shouldSkipChoiceTypeCastConstraint(expression: string, matched: any): boolean {
    if (!matched?.element?.path?.includes('[x]')) return false;
    const castMatch = expression.match(/\$this\s+as\s+([A-Za-z][A-Za-z0-9]*)/);
    if (!castMatch) return false;
    if (typeof matched.data === 'string') return false;

    const castType = castMatch[1];
    const actualType = inferChoiceRuntimeType(matched.data);
    return Boolean(actualType && actualType !== castType);
}

export function prepareElementContext(context: any, expression: string): any {
    if (Array.isArray(context)) {
        return context.map(item => prepareElementContext(item, expression));
    }

    if (!context || typeof context !== 'object' || context.resourceType) {
        return context;
    }

    const keys = Object.keys(context);
    let normalized: any | undefined;

    for (const base of CHOICE_BASES) {
        if (!new RegExp(`\\b${base}\\b`).test(expression)) continue;
        if (context[base] !== undefined) continue;

        const concreteKey = keys.find(key =>
            key.startsWith(base) &&
            key.length > base.length &&
            key[base.length] === key[base.length].toUpperCase()
        );

        if (concreteKey) {
            normalized ??= { ...context };
            normalized[base] = context[concreteKey];
        }
    }

    return normalized ?? context;
}

function inferChoiceRuntimeType(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'decimal';
    if (typeof value !== 'object') return null;
    if ('start' in value || 'end' in value) return 'Period';
    if ('value' in value && ('unit' in value || 'code' in value || 'system' in value)) return 'Quantity';
    if ('coding' in value || 'text' in value) return 'CodeableConcept';
    if ('reference' in value) return 'Reference';
    return null;
}
