import type { ReferenceParseResult } from './reference-type-extractor.js';

export interface ParsedReferenceCheck {
  reference: string;
  parseResult: ReferenceParseResult;
}

export interface ReferenceExistenceCheck extends ParsedReferenceCheck {
  exists: boolean;
  statusCode?: number;
  errorMessage?: string;
  responseTimeMs?: number;
  fromCache?: boolean;
}

export interface BatchCheckResult {
  results: ReferenceExistenceCheck[];
  existCount: number;
  notExistCount: number;
  failedCount: number;
  cacheHitCount: number;
  totalTimeMs: number;
  averageResponseTimeMs: number;
}
