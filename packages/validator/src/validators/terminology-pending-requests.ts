export async function runSingleFlight<T>(
    pendingRequests: Map<string, Promise<T>>,
    cacheKey: string,
    onPendingHit: () => void,
    createRequest: () => Promise<T>,
): Promise<T> {
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
        onPendingHit();
        return pending;
    }

    const request = createRequest();
    pendingRequests.set(cacheKey, request);
    try {
        return await request;
    } finally {
        if (pendingRequests.get(cacheKey) === request) pendingRequests.delete(cacheKey);
    }
}
