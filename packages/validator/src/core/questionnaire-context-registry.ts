import type { FhirResourceRecord } from '../reference/bundle-reference-types.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';

const DEFAULT_MAX_QUESTIONNAIRE_ALIASES = 768;

export class QuestionnaireContextRegistry {
  private readonly questionnaires: BoundedLruCache<string, FhirResourceRecord>;

  constructor(maxAliases = DEFAULT_MAX_QUESTIONNAIRE_ALIASES) {
    this.questionnaires = new BoundedLruCache(maxAliases);
  }

  register(questionnaire: unknown): boolean {
    if (!isRecord(questionnaire) || questionnaire.resourceType !== 'Questionnaire') {
      return false;
    }
    if (typeof questionnaire.url === 'string' && questionnaire.url.length > 0) {
      this.questionnaires.set(questionnaire.url, questionnaire);
    }
    if (typeof questionnaire.id === 'string' && questionnaire.id.length > 0) {
      this.questionnaires.set(`Questionnaire/${questionnaire.id}`, questionnaire);
      this.questionnaires.set(`#${questionnaire.id}`, questionnaire);
    }
    return true;
  }

  get(canonicalOrRef: string | undefined | null): FhirResourceRecord | null {
    if (!canonicalOrRef) return null;
    const base = canonicalOrRef.split('|')[0];
    return this.questionnaires.get(base) || this.questionnaires.get(canonicalOrRef) || null;
  }

  resolveForResponse(response: unknown): FhirResourceRecord | undefined {
    if (!isRecord(response) || typeof response.questionnaire !== 'string') return undefined;
    const ref = response.questionnaire;

    if (ref.startsWith('#')) {
      const contained = Array.isArray(response.contained) ? response.contained : [];
      const hit = contained.find((candidate): candidate is FhirResourceRecord =>
        isRecord(candidate) &&
        candidate.id === ref.slice(1) &&
        candidate.resourceType === 'Questionnaire'
      );
      return hit || this.get(ref) || undefined;
    }

    return this.get(ref) || undefined;
  }
}

function isRecord(value: unknown): value is FhirResourceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
