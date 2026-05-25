export class QuestionnaireContextRegistry {
  private readonly questionnaires = new Map<string, any>();

  register(questionnaire: any): boolean {
    if (!questionnaire || questionnaire.resourceType !== 'Questionnaire') {
      return false;
    }
    if (questionnaire.url) {
      this.questionnaires.set(questionnaire.url, questionnaire);
    }
    if (questionnaire.id) {
      this.questionnaires.set(`Questionnaire/${questionnaire.id}`, questionnaire);
      this.questionnaires.set(`#${questionnaire.id}`, questionnaire);
    }
    return true;
  }

  get(canonicalOrRef: string | undefined | null): any | null {
    if (!canonicalOrRef) return null;
    const base = canonicalOrRef.split('|')[0];
    return this.questionnaires.get(base) || this.questionnaires.get(canonicalOrRef) || null;
  }

  resolveForResponse(response: any): any | undefined {
    const ref: string | undefined = response?.questionnaire;
    if (!ref) return undefined;

    if (ref.startsWith('#')) {
      const contained = Array.isArray(response.contained) ? response.contained : [];
      const hit = contained.find((candidate: any) =>
        candidate?.id === ref.slice(1) && candidate?.resourceType === 'Questionnaire'
      );
      return hit || this.get(ref) || undefined;
    }

    return this.get(ref) || undefined;
  }
}
