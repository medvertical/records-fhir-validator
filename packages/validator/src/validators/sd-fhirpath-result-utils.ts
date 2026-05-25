export function constraintPassed(result: any): boolean {
    if (result === undefined || result === null) return true;
    if (typeof result === 'boolean') return result;
    if (Array.isArray(result)) {
        if (result.length === 0) return true;
        if (result.every(item => typeof item === 'boolean')) {
            return result.every(Boolean);
        }
        return result.length > 0;
    }
    return true;
}
