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
import type { CodeSystemValidationResult, SubsumptionOutcome } from './terminology-api-types';
import {
    clearCodeSystemValidateCodeCache,
    getFromCodeSystemValidateCodeCache,
    getFromSubsumesCache,
    getFromValidateCodeCache,
    makeCodeSystemValidateCodeCacheKey,
    makeSubsumesCacheKey,
    makeValidateCodeCacheKey,
    storeInCodeSystemValidateCodeCache,
    storeInSubsumesCache,
    storeInValidateCodeCache,
} from './terminology-api-cache';
import {
    isSnomedNationalExtensionSystemCode,
    operationOutcomeToCodeSystemResult,
    parseCodeSystemValidationParameters,
} from './terminology-code-system-result';
import {
    extractSubsumptionOutcome,
    operationOutcomeCannotResolveBinding,
    validateCodeSucceeded,
} from './terminology-parameters';

export type {
    CodeSystemValidationIssue,
    CodeSystemValidationResult,
    SubsumptionOutcome,
} from './terminology-api-types';
export {
    clearSubsumesCache,
    clearCodeSystemValidateCodeCache,
    clearValidateCodeCache,
    getCachedSubsumesOutcome,
    getSubsumesCacheSize,
    getValidateCodeCacheSize,
} from './terminology-api-cache';
export { isSnomedNationalExtensionCode } from './terminology-code-system-result';

// Shared circuit breaker for CodeSystem validation (fail fast when tx.fhir.org is down)
const codeSystemCircuitBreaker = new CircuitBreaker('codesystem-validation', {
    failureThreshold: 3,    // Open after 3 failures
    resetTimeout: 30000,    // Try again after 30 seconds
    successThreshold: 1,    // Close after 1 success
});
const pendingValidateCodeRequests = new Map<string, Promise<boolean>>();
const pendingSubsumesRequests = new Map<string, Promise<SubsumptionOutcome>>();
const pendingCodeSystemValidateCodeRequests = new Map<string, Promise<CodeSystemValidationResult>>();

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
        const cacheKey = `${serverUrl}|${valueSetUrl}`;
        const cached = this.cache.getServerExpansion(cacheKey, ttlSeconds);
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
                    this.cache.setServerExpansion(cacheKey, codes);
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

        const pending = pendingValidateCodeRequests.get(cacheKey);
        if (pending) {
            logger.debug(`[TerminologyApiClient] validate-code in-flight HIT: ${code} in ${valueSetUrl}`);
            return pending;
        }

        const request = this.executeValidateCodeRequest(cacheKey, code, system, valueSetUrl, bindingStrength, override);
        pendingValidateCodeRequests.set(cacheKey, request);
        try {
            return await request;
        } finally {
            pendingValidateCodeRequests.delete(cacheKey);
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
        display?: string,
        override?: TerminologyServerOverride,
    ): Promise<CodeSystemValidationResult> {
        const serverUrl = override?.url ?? this.config.serverUrl;
        if (!serverUrl) {
            const message = `No terminology server configured for CodeSystem '${system}'`;
            logger.debug(`[TerminologyApiClient] ${message}; skipping direct CodeSystem validation`);
            return { valid: true };
        }

        const cacheKey = makeCodeSystemValidateCodeCacheKey(serverUrl, system, code, display);
        const cached = getFromCodeSystemValidateCodeCache<CodeSystemValidationResult>(cacheKey);
        if (cached) {
            logger.debug(`[TerminologyApiClient] CodeSystem validate-code cache HIT: ${system}|${code}`);
            return cached;
        }

        const pending = pendingCodeSystemValidateCodeRequests.get(cacheKey);
        if (pending) {
            logger.debug(`[TerminologyApiClient] CodeSystem validate-code in-flight HIT: ${system}|${code}`);
            return pending;
        }

        // Circuit breaker: fail fast if server is down
        if (codeSystemCircuitBreaker.isOpen()) {
            logger.debug(`[TerminologyApiClient] Circuit breaker OPEN, skipping CodeSystem validation for ${system}`);
            return { valid: true }; // Fail open when server unavailable
        }

        const request = this.executeCodeSystemValidateCodeRequest(cacheKey, serverUrl, code, system, display, override);
        pendingCodeSystemValidateCodeRequests.set(cacheKey, request);
        try {
            return await request;
        } finally {
            pendingCodeSystemValidateCodeRequests.delete(cacheKey);
        }
    }

    private async executeCodeSystemValidateCodeRequest(
        cacheKey: string,
        serverUrl: string,
        code: string,
        system: string,
        display?: string,
        override?: TerminologyServerOverride,
    ): Promise<CodeSystemValidationResult> {
        try {
            const params = {
                url: system,
                code: code,
                ...(display ? { display } : {}),
                _format: 'json'
            };

            logger.debug(`[TerminologyApiClient] Validating code '${code}' in CodeSystem ${system} via ${serverUrl}`);

            const response = await axios.get(`${serverUrl}/CodeSystem/$validate-code`, {
                ...(await this.buildRequestConfig(override?.auth, 5000, params)),
            });

            codeSystemCircuitBreaker.recordSuccess();
            const result = parseCodeSystemValidationParameters(response.data, code, system);
            storeInCodeSystemValidateCodeCache(cacheKey, result);
            return result;
        } catch (error: unknown) {
            const result = this.handleCodeSystemValidationError(error, code, system);
            const axiosResp = isAxiosError(error) ? error.response : undefined;
            if (axiosResp?.status === 422 || axiosResp?.status === 404) {
                storeInCodeSystemValidateCodeCache(cacheKey, result);
            }
            return result;
        }
    }

    private handleCodeSystemValidationError(
        error: unknown,
        code: string,
        system: string,
    ): CodeSystemValidationResult {
        const err = error instanceof Error ? error : new Error(String(error));
        const axiosResp = isAxiosError(error) ? error.response : undefined;

        if (axiosResp?.status === 422 || axiosResp?.status === 404) {
            codeSystemCircuitBreaker.recordSuccess();
            if (isSnomedNationalExtensionSystemCode(system, code)) {
                logger.debug(`[TerminologyApiClient] Code '${code}' is a SNOMED national-extension SCTID — failing open (server returned ${axiosResp.status})`);
                return { valid: true };
            }
            return operationOutcomeToCodeSystemResult(axiosResp.data, code, system);
        }

        codeSystemCircuitBreaker.recordFailure();
        logger.warn(`[TerminologyApiClient] CodeSystem validation failed for ${system}: ${err.message}`);
        return { valid: true };
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

        const pending = pendingSubsumesRequests.get(cacheKey);
        if (pending) {
            logger.debug(`[TerminologyApiClient] $subsumes in-flight HIT: ${system}|${codeA} → ${codeB}`);
            return pending;
        }

        const request = this.executeSubsumesRequest(cacheKey, system, codeA, codeB, override);
        pendingSubsumesRequests.set(cacheKey, request);
        try {
            return await request;
        } finally {
            pendingSubsumesRequests.delete(cacheKey);
        }
    }

    private async executeValidateCodeRequest(
        cacheKey: string,
        code: string,
        system: string | undefined,
        valueSetUrl: string,
        bindingStrength?: 'required' | 'extensible' | 'preferred' | 'example',
        override?: TerminologyServerOverride,
    ): Promise<boolean> {
        const serverUrl = override?.url ?? this.config.serverUrl;
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

            if (validateCodeSucceeded(response.data)) {
                logger.debug(`[TerminologyApiClient] Server $validate-code CONFIRMED ${code} in ${valueSetUrl}`);
                storeInValidateCodeCache(cacheKey, true);
                return true;
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

            if (axiosResp?.status === 422 || axiosResp?.status === 404) {
                const cantResolve = operationOutcomeCannotResolveBinding(axiosResp.data);
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

    private async executeSubsumesRequest(
        cacheKey: string,
        system: string,
        codeA: string,
        codeB: string,
        override?: TerminologyServerOverride,
    ): Promise<SubsumptionOutcome> {
        const serverUrl = override?.url ?? this.config.serverUrl;
        try {
            const response = await axios.get(`${serverUrl}/CodeSystem/$subsumes`, {
                ...(await this.buildRequestConfig(override?.auth, 5000, {
                    system,
                    codeA,
                    codeB,
                    _format: 'json',
                })),
            });

            const outcome = extractSubsumptionOutcome(response.data);
            if (outcome) {
                storeInSubsumesCache(cacheKey, outcome);
                return outcome;
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
