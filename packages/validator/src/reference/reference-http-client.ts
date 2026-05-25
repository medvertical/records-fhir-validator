import axios, { type AxiosInstance } from 'axios';
import { Agent } from 'http';
import { Agent as HttpsAgent } from 'https';

export interface BatchCheckConfig {
  /** Maximum concurrent requests (default: 5) */
  maxConcurrent?: number;
  /** Timeout per request in milliseconds (default: 5000) */
  timeoutMs?: number;
  /** Base URL for FHIR server */
  baseUrl?: string;
  /** Whether to use caching (default: true) */
  enableCache?: boolean;
  /** Cache TTL in milliseconds (default: 300000 = 5 minutes) */
  cacheTtlMs?: number;
  /** Custom headers for requests */
  headers?: Record<string, string>;
  /** Whether to follow redirects (default: true) */
  followRedirects?: boolean;
  /** Whether absolute references may call arbitrary external hosts (default: false). */
  allowExternalAbsoluteReferences?: boolean;
  /** Whether absolute references may call the configured FHIR server origin (default: true). */
  allowSameOriginAbsoluteReferences?: boolean;
}

export type ResolvedBatchCheckConfig = Required<BatchCheckConfig>;

export function resolveBatchCheckConfig(config?: Partial<BatchCheckConfig>): ResolvedBatchCheckConfig {
  return {
    maxConcurrent: config?.maxConcurrent || 10,
    timeoutMs: config?.timeoutMs || 3000,
    baseUrl: config?.baseUrl || '',
    enableCache: config?.enableCache !== undefined ? config.enableCache : true,
    cacheTtlMs: config?.cacheTtlMs || 900000,
    headers: config?.headers || {
      'Accept': 'application/fhir+json',
    },
    followRedirects: config?.followRedirects !== undefined ? config.followRedirects : true,
    allowExternalAbsoluteReferences: config?.allowExternalAbsoluteReferences ?? false,
    allowSameOriginAbsoluteReferences: config?.allowSameOriginAbsoluteReferences ?? true,
  };
}

export function createReferenceHttpClient(config: ResolvedBatchCheckConfig): AxiosInstance {
  const httpAgent = new Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: config.maxConcurrent * 2,
    maxFreeSockets: config.maxConcurrent,
  });

  const httpsAgent = new HttpsAgent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: config.maxConcurrent * 2,
    maxFreeSockets: config.maxConcurrent,
  });

  return axios.create({
    timeout: config.timeoutMs,
    headers: config.headers,
    maxRedirects: config.followRedirects ? 5 : 0,
    validateStatus: () => true,
    httpAgent,
    httpsAgent,
  });
}
