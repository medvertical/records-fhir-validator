export interface BundleReferencePath {
    reference: string;
    path: string;
}

export function extractReferencesWithPaths(
    obj: unknown,
    currentPath: string,
    refs: BundleReferencePath[],
): void {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            extractReferencesWithPaths(obj[i], `${currentPath}[${i}]`, refs);
        }
        return;
    }
    const record = obj as Record<string, unknown>;
    if (typeof record.reference === 'string' && record.reference.length > 0) {
        refs.push({ reference: record.reference, path: currentPath });
    }
    for (const key of Object.keys(record)) {
        if (key === 'contained') continue;
        const childPath = currentPath ? `${currentPath}.${key}` : key;
        extractReferencesWithPaths(record[key], childPath, refs);
    }
}

export function extractReferences(obj: unknown, refs: string[] = []): string[] {
    if (!obj || typeof obj !== 'object') return refs;
    if (Array.isArray(obj)) {
        for (const item of obj) extractReferences(item, refs);
        return refs;
    }
    const record = obj as Record<string, unknown>;
    if (typeof record.reference === 'string' && record.reference.length > 0) {
        refs.push(record.reference);
    }
    for (const key of Object.keys(record)) {
        if (key === 'contained') continue;
        extractReferences(record[key], refs);
    }
    return refs;
}

export function deriveBundleBaseUrl(fullUrl: string): string | null {
    if (!fullUrl || fullUrl.startsWith('urn:')) return null;

    const match = fullUrl.match(/^(https?:\/\/.+\/)[A-Z][a-zA-Z]+\/[^/]+$/);
    if (match) return match[1];

    const lastSlash = fullUrl.lastIndexOf('/');
    if (lastSlash <= 0) return null;
    const secondLast = fullUrl.lastIndexOf('/', lastSlash - 1);
    if (secondLast <= 0) return null;
    return fullUrl.substring(0, secondLast + 1);
}
