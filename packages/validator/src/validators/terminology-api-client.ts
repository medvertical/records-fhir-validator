/**
 * Terminology API Client
 * 
 * HTTP client for terminology server operations ($expand, $validate-code).
 * Extracted from valueset-validator.ts for modularity.
 */

import * as fs from 'fs';
import * as https from 'https';
import axios, { isAxiosError, type AxiosRequestConfig } from 'axios';
import type { TerminologyResolutionConfig, TerminologyServerOverride, TerminologyApiAuthConfig } from './valueset-types';
import { ValueSetCache, valueSetCache } from './valueset-cache';
import { logger } from '../logger';
import { CircuitBreaker } from '../terminology';

const SNOMED_SYSTEM = 'http://snomed.info/sct';

/**
 * Detect whether a SNOMED CT SCTID belongs to a national extension rather
 * than the International Edition.  National-extension SCTIDs use the
 * "long format": 7-digit namespace + itemId + 2-digit partition + check.
 * Known namespace prefixes: 10000xx (UK, US, AU, …), 10002xx (clinical
 * extensions).  International-core SCTIDs use the "short format" and are
 * typically ≤ 9 digits.
 */
export function isSnomedNationalExtensionCode(code: string): boolean {
    // Must be all-digit and long enough for namespace format (≥ 10 chars)
    if (!/^\d{10,}$/.test(code)) return false;
    // National extension namespaces are 7-digit numbers 1000000–9999999.
    // They appear at a predictable position: sctid = namespace(7) + itemId(N) + partition(2) + check(1).
    // The partition+check are the last 3 chars, the namespace is the leading 7.
    // However, some very large international IDs exist too (> 9 digits) in short format.
    // Pragmatic check: if the SCTID contains a registered-namespace-style segment
    // (10000xx or 10002xx) we treat it as national.
    return /10000\d{2}|10002\d{2}/.test(code);
}

// Shared circuit breaker for CodeSystem validation (fail fast when tx.fhir.org is down)
const codeSystemCircuitBreaker = new CircuitBreaker('codesystem-validation', {
    failureThreshold: 3,    // Open after 3 failures
    resetTimeout: 30000,    // Try again after 30 seconds
    successThreshold: 1,    // Close after 1 success
});

export type SubsumptionOutcome = 'subsumes' | 'subsumed-by' | 'equivalent' | 'not-subsumed' | 'unknown';

/**
 * In-memory TTL cache for `$validate-code` results. A single bulk run
 * (82k resources) sees ~1860 tx roundtrips with thousands of repeats on
 * the same `(system, code, valueSetUrl)` tuple — caching true/false
 * results cuts HTTP volume to < 5% and latency per resource from
 * seconds to milliseconds. Cache is process-wide (module singleton) so
 * it survives across batches within one validator lifetime.
 *
 * Entry format: `${serverUrl}|${system ?? ''}|${code}|${valueSetUrl}`
 * Value: boolean result, timestamped; expires after `CACHE_TTL_MS`.
 *
 * Source: strategic roadmap P-4 — "$validate-code Result-Cache".
 */
interface ValidateCodeCacheEntry {
    result: boolean;
    cachedAt: number;
}
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE = 5000;
const validateCodeCache = new Map<string, ValidateCodeCacheEntry>();

function makeValidateCodeCacheKey(
    serverUrl: string,
    system: string | undefined,
    code: string,
    valueSetUrl: string,
): string {
    return `${serverUrl}|${system ?? ''}|${code}|${valueSetUrl}`;
}

function getFromValidateCodeCache(key: string): boolean | undefined {
    const entry = validateCodeCache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        validateCodeCache.delete(key);
        return undefined;
    }
    // LRU refresh — re-insert to move to tail.
    validateCodeCache.delete(key);
    validateCodeCache.set(key, entry);
    return entry.result;
}

function storeInValidateCodeCache(key: string, result: boolean): void {
    if (validateCodeCache.size >= MAX_CACHE_SIZE) {
        // Evict oldest (Map preserves insertion order, first key is oldest).
        const oldest = validateCodeCache.keys().next().value;
        if (oldest) validateCodeCache.delete(oldest);
    }
    validateCodeCache.set(key, { result, cachedAt: Date.now() });
}

/** Clear the process-wide validateCode cache. Primarily for tests. */
export function clearValidateCodeCache(): void {
    validateCodeCache.clear();
}

/** Expose current cache size — for tests + ops observability. */
export function getValidateCodeCacheSize(): number {
    return validateCodeCache.size;
}

// ============================================================================
// $subsumes Cache (T-1)
// ============================================================================
// SNOMED hierarchy lookups (`is-a` filter expansion, advisor rules that
// ask "is concept X a kind of Y") issue many subsumes calls per bulk run
// against the same code pairs. Same TTL + LRU policy as validateCodeCache;
// `'unknown'` (server error / no result) is NOT cached because a retry
// within the TTL window may succeed.

interface SubsumesCacheEntry {
    result: Exclude<SubsumptionOutcome, 'unknown'>;
    cachedAt: number;
}
const subsumesCache = new Map<string, SubsumesCacheEntry>();

function makeSubsumesCacheKey(serverUrl: string, system: string, codeA: string, codeB: string): string {
    return `${serverUrl}|${system}|${codeA}|${codeB}`;
}

function getFromSubsumesCache(key: string): SubsumptionOutcome | undefined {
    const entry = subsumesCache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        subsumesCache.delete(key);
        return undefined;
    }
    subsumesCache.delete(key);
    subsumesCache.set(key, entry);
    return entry.result;
}

function storeInSubsumesCache(key: string, result: SubsumptionOutcome): void {
    if (result === 'unknown') return;
    if (subsumesCache.size >= MAX_CACHE_SIZE) {
        const oldest = subsumesCache.keys().next().value;
        if (oldest) subsumesCache.delete(oldest);
    }
    subsumesCache.set(key, { result, cachedAt: Date.now() });
}

/** Clear the process-wide subsumes cache. Primarily for tests. */
export function clearSubsumesCache(): void {
    subsumesCache.clear();
}

/** Expose current subsumes cache size — for tests + ops observability. */
export function getSubsumesCacheSize(): number {
    return subsumesCache.size;
}

// ============================================================================
// Terminology API Client
// ============================================================================

export class TerminologyApiClient {
    /**
     * Cached OAuth2 access token with expiry. Refreshed lazily via
     * `getOAuth2Token()` when it's missing or within 30s of expiry.
     */
    private oauth2Token: { accessToken: string; expiresAt: number } | null = null;
    private mtlsAgent: { signature: string; agent: https.Agent } | null = null;

    constructor(
        private config: TerminologyResolutionConfig,
        private cache: ValueSetCache = valueSetCache
    ) { }

    /**
     * Update the configuration. Also invalidates the cached OAuth2
     * token so a changed auth config takes effect on the next call.
     */
    setConfig(config: TerminologyResolutionConfig): void {
        const authChanged =
            JSON.stringify(this.config.auth) !== JSON.stringify(config.auth);
        this.config = config;
        if (authChanged) this.oauth2Token = null;
    }

    /**
     * Build request headers, including auth. When `authOverride` is
     * provided (from scope-based per-call routing), it takes precedence
     * over the client's default auth config.
     */
    private async buildHeaders(authOverride?: TerminologyApiAuthConfig): Promise<Record<string, string>> {
        const headers: Record<string, string> = {
            'Accept': 'application/fhir+json',
        };
        const auth = authOverride ?? this.config.auth;
        if (!auth || auth.type === 'none') return headers;

        switch (auth.type) {
            case 'basic':
                if (auth.username && auth.password) {
                    const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
                    headers['Authorization'] = `Basic ${encoded}`;
                }
                break;
            case 'bearer':
                if (auth.token) {
                    headers['Authorization'] = `Bearer ${auth.token}`;
                }
                break;
            case 'oauth2': {
                const token = await this.getOAuth2Token(auth);
                if (token) headers['Authorization'] = `Bearer ${token}`;
                break;
            }
            case 'mtls':
                break;
        }
        return headers;
    }

    private async buildRequestConfig(
        authOverride: TerminologyApiAuthConfig | undefined,
        timeout: number,
        params?: Record<string, unknown>,
    ): Promise<AxiosRequestConfig> {
        const auth = authOverride ?? this.config.auth;
        const httpsAgent = this.buildHttpsAgent(auth);

        return {
            ...(params ? { params } : {}),
            timeout,
            headers: await this.buildHeaders(auth),
            ...(httpsAgent ? { httpsAgent } : {}),
        };
    }

    private buildHttpsAgent(auth?: TerminologyApiAuthConfig): https.Agent | undefined {
        if (!auth || auth.type !== 'mtls') return undefined;

        const signature = JSON.stringify({
            clientCert: auth.clientCert,
            clientCertPath: auth.clientCertPath,
            clientKey: auth.clientKey,
            clientKeyPath: auth.clientKeyPath,
            caCert: auth.caCert,
            caCertPath: auth.caCertPath,
            passphrase: auth.passphrase,
            rejectUnauthorized: auth.rejectUnauthorized,
        });
        if (this.mtlsAgent?.signature === signature) {
            return this.mtlsAgent.agent;
        }

        const cert = this.readTlsMaterial(auth.clientCert, auth.clientCertPath, 'client certificate');
        const key = this.readTlsMaterial(auth.clientKey, auth.clientKeyPath, 'client key');
        if (!cert || !key) {
            logger.warn('[TerminologyApiClient] mTLS auth configured without both client certificate and key; request will be sent without mTLS credentials.');
            return undefined;
        }

        const ca = this.readTlsMaterial(auth.caCert, auth.caCertPath, 'CA certificate');
        const agent = new https.Agent({
            cert,
            key,
            ...(ca ? { ca } : {}),
            ...(auth.passphrase ? { passphrase: auth.passphrase } : {}),
            rejectUnauthorized: auth.rejectUnauthorized ?? true,
        });
        this.mtlsAgent = { signature, agent };
        return agent;
    }

    private readTlsMaterial(inlineValue: string | undefined, filePath: string | undefined, label: string): string | undefined {
        if (inlineValue) return inlineValue;
        if (!filePath) return undefined;

        try {
            return fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            logger.warn(`[TerminologyApiClient] Could not read mTLS ${label} from configured path: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }

    /**
     * Get an OAuth2 access token via client-credentials grant. Caches
     * the token until 30s before its `expires_in` window closes.
     */
    private async getOAuth2Token(
        auth: NonNullable<TerminologyResolutionConfig['auth']>,
    ): Promise<string | null> {
        if (!auth.clientId || !auth.clientSecret || !auth.tokenUrl) return null;

        // Return cached token if still fresh (refresh 30s before expiry)
        if (this.oauth2Token && Date.now() < this.oauth2Token.expiresAt - 30_000) {
            return this.oauth2Token.accessToken;
        }

        try {
            const body = new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: auth.clientId,
                client_secret: auth.clientSecret,
            });
            if (auth.scope) body.append('scope', auth.scope);

            const resp = await axios.post(auth.tokenUrl, body.toString(), {
                timeout: 10000,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            });
            if (resp.data?.access_token) {
                const expiresInSec = typeof resp.data.expires_in === 'number' ? resp.data.expires_in : 3600;
                this.oauth2Token = {
                    accessToken: resp.data.access_token,
                    expiresAt: Date.now() + expiresInSec * 1000,
                };
                logger.info(`[TerminologyApiClient] OAuth2 token acquired (expires in ${expiresInSec}s)`);
                return this.oauth2Token.accessToken;
            }
            logger.warn('[TerminologyApiClient] OAuth2 token endpoint returned no access_token');
            return null;
        } catch (err) {
            logger.warn(
                `[TerminologyApiClient] OAuth2 token acquisition failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return null;
        }
    }

    /**
     * Get the server URL from config
     */
    get serverUrl(): string | undefined {
        return this.config.serverUrl;
    }

    /**
     * Expand a ValueSet using a remote terminology server ($expand operation)
     * Returns null if server is unavailable or expansion fails
     */
    async expandValueSet(valueSetUrl: string, override?: TerminologyServerOverride): Promise<Set<string> | null> {
        const serverUrl = override?.url ?? this.config.serverUrl;
        if (!serverUrl) {
            return null;
        }

        // Check server expansion cache with TTL
        const ttlSeconds = this.config.serverDelegation?.cacheTTLSeconds ?? 3600;
        const cached = this.cache.getServerExpansion(valueSetUrl, ttlSeconds);
        if (cached) {
            return cached;
        }

        try {
            const response = await axios.get(`${serverUrl}/ValueSet/$expand`, {
                ...(await this.buildRequestConfig(override?.auth, 10000, {
                    url: valueSetUrl,
                    _format: 'json'
                })),
            });

            if (response.data?.expansion?.contains) {
                const codes = new Set<string>();
                for (const item of response.data.expansion.contains) {
                    if (item.code) {
                        // Add both bare code and system|code format
                        codes.add(item.code);
                        if (item.system) {
                            codes.add(`${item.system}|${item.code}`);
                        }
                    }
                }

                // Cache the result
                if (this.config.serverDelegation?.cacheResults !== false) {
                    this.cache.setServerExpansion(valueSetUrl, codes);
                }

                logger.debug(`[TerminologyApiClient] Server $expand succeeded: ${valueSetUrl}, ${codes.size} codes`);
                return codes;
            }

            return null;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.debug(`[TerminologyApiClient] Server $expand failed for ${valueSetUrl}: ${err.message}`);
            return null;
        }
    }

    /**
     * Validate a code against a ValueSet using $validate-code
     * @param bindingStrength - If 'required', fail closed on server errors (422/404)
     */
    async validateCode(
        code: string,
        system: string | undefined,
        valueSetUrl: string,
        bindingStrength?: 'required' | 'extensible' | 'preferred' | 'example',
        override?: TerminologyServerOverride,
    ): Promise<boolean> {
        const serverUrl = override?.url ?? this.config.serverUrl;
        if (!serverUrl) return false;

        // Short-circuit: identical (server,system,code,valueSet) lookups
        // are extremely common in bulk runs. The tx server would answer
        // the same way every time within the TTL window.
        const cacheKey = makeValidateCodeCacheKey(serverUrl, system, code, valueSetUrl);
        const cached = getFromValidateCodeCache(cacheKey);
        if (cached !== undefined) {
            logger.debug(`[TerminologyApiClient] validate-code cache HIT: ${code} in ${valueSetUrl} → ${cached}`);
            return cached;
        }

        try {
            const params: Record<string, string> = {
                url: valueSetUrl,
                code: code,
                _format: 'json'
            };
            if (system) {
                params.system = system;
            }

            const response = await axios.get(`${serverUrl}/ValueSet/$validate-code`, {
                ...(await this.buildRequestConfig(override?.auth, 5000, params)),
            });

            // FHIR $validate-code returns a Parameters resource
            const parameters = response.data;
            if (parameters.resourceType === 'Parameters' && parameters.parameter) {
                const resultParam = parameters.parameter.find((p: any) => p.name === 'result');
                if (resultParam && resultParam.valueBoolean === true) {
                    logger.debug(`[TerminologyApiClient] Server $validate-code CONFIRMED ${code} in ${valueSetUrl}`);
                    storeInValidateCodeCache(cacheKey, true);
                    return true;
                }
            }

            storeInValidateCodeCache(cacheKey, false);
            return false;

        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            const axiosResp = isAxiosError(error) ? error.response : undefined;
            if (axiosResp?.data) {
                logger.debug(`[TerminologyApiClient] Server $validate-code failed with data: ${JSON.stringify(axiosResp.data)}`);
            } else {
                logger.debug(`[TerminologyApiClient] Server $validate-code failed: ${err.message}`);
            }

            // For 422/404: distinguish "ValueSet/CodeSystem not resolvable" (server limitation)
            // from "code is genuinely invalid". Java's reference validator fails open when the
            // server can't resolve the binding target — emitting an error in that case produces
            // false positives (e.g. core ValueSets not present on a generic tx server).
            if (axiosResp?.status === 422 || axiosResp?.status === 404) {
                const outcome = axiosResp.data;
                const cantResolve =
                    outcome?.resourceType === 'OperationOutcome' &&
                    Array.isArray(outcome.issue) &&
                    outcome.issue.some((i: any) =>
                        i?.code === 'not-found' ||
                        /could not be (?:found|resolved)|unable to (?:find|resolve)|not.*resolved/i.test(i?.details?.text ?? '')
                    );
                if (cantResolve || bindingStrength !== 'required') {
                    logger.warn(`[TerminologyApiClient] Server returned ${axiosResp.status} (${cantResolve ? 'not-resolvable' : 'non-required binding'}). Failing open (assuming valid).`);
                    storeInValidateCodeCache(cacheKey, true);
                    return true;
                }
                logger.warn(`[TerminologyApiClient] Server returned ${axiosResp.status} for required binding validation. Failing closed.`);
                storeInValidateCodeCache(cacheKey, false);
                return false;
            }

            // Network / timeout / 5xx — don't cache, may be transient.
            return false;
        }
    }

    /**
     * Validate a code directly against a CodeSystem using tx.fhir.org $validate-code
     * Used for large external CodeSystems like LOINC and SNOMED
     * 
     * Uses circuit breaker to prevent flooding failing servers with requests.
     */
    async validateCodeInCodeSystem(
        code: string,
        system: string,
        override?: TerminologyServerOverride,
    ): Promise<{ valid: boolean; message?: string }> {
        const serverUrl = override?.url ?? this.config.serverUrl;
        if (!serverUrl) {
            logger.debug(`[TerminologyApiClient] No terminology server configured, skipping CodeSystem validation for ${system}`);
            return { valid: true }; // No server = can't validate = fail open
        }

        // Circuit breaker: fail fast if server is down
        if (codeSystemCircuitBreaker.isOpen()) {
            logger.debug(`[TerminologyApiClient] Circuit breaker OPEN, skipping CodeSystem validation for ${system}`);
            return { valid: true }; // Fail open when server unavailable
        }

        try {
            const params = {
                url: system,
                code: code,
                _format: 'json'
            };

            logger.debug(`[TerminologyApiClient] Validating code '${code}' in CodeSystem ${system} via ${serverUrl}`);

            const response = await axios.get(`${serverUrl}/CodeSystem/$validate-code`, {
                ...(await this.buildRequestConfig(override?.auth, 5000, params)),
            });

            // Success! Record it for circuit breaker
            codeSystemCircuitBreaker.recordSuccess();

            // FHIR $validate-code returns a Parameters resource
            const parameters = response.data;
            if (parameters.resourceType === 'Parameters' && parameters.parameter) {
                const resultParam = parameters.parameter.find((p: any) => p.name === 'result');
                const messageParam = parameters.parameter.find((p: any) => p.name === 'message');

                if (resultParam?.valueBoolean === true) {
                    logger.debug(`[TerminologyApiClient] Code '${code}' is valid in ${system}`);
                    return { valid: true };
                } else {
                    const errorMessage = messageParam?.valueString || `Unknown code '${code}' in CodeSystem '${system}'`;
                    // National-extension SNOMED codes (UK, US, AU, …) won't be
                    // found on servers that only carry the International Edition.
                    // Fail open — we can't confirm validity, but flagging them as
                    // errors would produce false positives.
                    if (system === SNOMED_SYSTEM && isSnomedNationalExtensionCode(code)) {
                        logger.debug(`[TerminologyApiClient] Code '${code}' is a SNOMED national-extension SCTID — failing open (server has International Edition only)`);
                        return { valid: true };
                    }
                    logger.debug(`[TerminologyApiClient] Code '${code}' is INVALID in ${system}: ${errorMessage}`);
                    return { valid: false, message: errorMessage };
                }
            }

            return { valid: true }; // Unknown response format = fail open

        } catch (error: unknown) {
            const _err = error instanceof Error ? error : new Error(String(error));
            const axiosResp = isAxiosError(error) ? error.response : undefined;
            // 422/404 = code not found (not a server failure)
            if (axiosResp?.status === 422 || axiosResp?.status === 404) {
                // This is a valid response, not a failure - record as success
                codeSystemCircuitBreaker.recordSuccess();

                // National-extension SNOMED codes → fail open (same rationale as above)
                if (system === SNOMED_SYSTEM && isSnomedNationalExtensionCode(code)) {
                    logger.debug(`[TerminologyApiClient] Code '${code}' is a SNOMED national-extension SCTID — failing open (server returned ${axiosResp.status})`);
                    return { valid: true };
                }

                const opOutcome = axiosResp?.data;
                if (opOutcome?.resourceType === 'OperationOutcome' && opOutcome.issue?.[0]) {
                    const msg = opOutcome.issue[0].details?.text || opOutcome.issue[0].diagnostics || `Unknown code '${code}' in CodeSystem '${system}'`;
                    return { valid: false, message: msg };
                }
                return { valid: false, message: `Unknown code '${code}' in CodeSystem '${system}'` };
            }

            // 500/503/timeout = server failure, record for circuit breaker
            codeSystemCircuitBreaker.recordFailure();
            logger.warn(`[TerminologyApiClient] CodeSystem validation failed for ${system}: ${_err.message}`);
            return { valid: true }; // Fail open
        }
    }

    /**
     * Ask the terminology server whether codeA subsumes codeB in a CodeSystem.
     * Used as a targeted fallback for filtered ValueSets such as
     * `concept is-a <snomed-code>` when a local CodeSystem tree is unavailable.
     */
    async subsumes(
        system: string,
        codeA: string,
        codeB: string,
        override?: TerminologyServerOverride,
    ): Promise<SubsumptionOutcome> {
        const serverUrl = override?.url ?? this.config.serverUrl;
        if (!serverUrl) return 'unknown';

        const cacheKey = makeSubsumesCacheKey(serverUrl, system, codeA, codeB);
        const cached = getFromSubsumesCache(cacheKey);
        if (cached !== undefined) {
            logger.debug(`[TerminologyApiClient] $subsumes cache HIT: ${system}|${codeA} → ${codeB} = ${cached}`);
            return cached;
        }

        try {
            const response = await axios.get(`${serverUrl}/CodeSystem/$subsumes`, {
                ...(await this.buildRequestConfig(override?.auth, 5000, {
                    system,
                    codeA,
                    codeB,
                    _format: 'json',
                })),
            });

            const parameters = response.data;
            if (parameters.resourceType === 'Parameters' && Array.isArray(parameters.parameter)) {
                const outcomeParam = parameters.parameter.find((p: any) => p.name === 'outcome');
                const outcome = outcomeParam?.valueCode as SubsumptionOutcome | undefined;
                if (outcome) {
                    storeInSubsumesCache(cacheKey, outcome);
                    return outcome;
                }
            }
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.debug(`[TerminologyApiClient] Server $subsumes failed for ${system}|${codeA} -> ${codeB}: ${err.message}`);
        }

        return 'unknown';
    }

    /**
     * Convenience: returns true when `child` is `codeB` and `parent` is
     * `codeA` and the server reports `subsumes` or `equivalent`. The
     * terminology server's argument order (codeA subsumes codeB) is easy
     * to reverse — this helper makes the intent at the call site obvious.
     */
    async isSubsumedBy(
        system: string,
        child: string,
        parent: string,
        override?: TerminologyServerOverride,
    ): Promise<boolean> {
        const outcome = await this.subsumes(system, parent, child, override);
        return outcome === 'subsumes' || outcome === 'equivalent';
    }
}
