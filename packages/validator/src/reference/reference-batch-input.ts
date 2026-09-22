import { extractReferencesFromBundle, extractReferencesFromResource } from './reference-extraction.js';
import { parseReference } from './reference-type-extractor.js';
import type { ParsedReferenceCheck } from './reference-batch-types.js';

export function parseReferenceBatch(references: string[]): ParsedReferenceCheck[] {
  return references.map(reference => ({
    reference,
    parseResult: parseReference(reference),
  }));
}

export function extractResourceReferenceBatch(resource: unknown): string[] {
  return extractReferencesFromResource(resource);
}

export function extractBundleReferenceBatch(bundle: unknown): string[] {
  return extractReferencesFromBundle(bundle);
}
