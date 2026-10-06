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
    const aliases: string[] = [];
    if (typeof questionnaire.url === 'string' && questionnaire.url.length > 0) {
      aliases.push(questionnaire.url);
    }
    if (typeof questionnaire.id === 'string' && questionnaire.id.length > 0) {
      aliases.push(`Questionnaire/${questionnaire.id}`, `#${questionnaire.id}`);
    }
    for (const alias of aliases) {
      this.questionnaires.set(alias, questionnaire);
      if (typeof questionnaire.version === 'string' && questionnaire.version.length > 0) {
        this.questionnaires.set(`${alias}|${questionnaire.version}`, questionnaire);
      }
    }
    return true;
  }

  get(canonicalOrRef: string | undefined | null): FhirResourceRecord | null {
    if (!canonicalOrRef) return null;
    const [base, version] = canonicalOrRef.split('|');
    const questionnaire = this.questionnaires.get(canonicalOrRef) || this.questionnaires.get(base);
    if (!questionnaire || (version && questionnaire.version !== version)) return null;
    return questionnaire;
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
