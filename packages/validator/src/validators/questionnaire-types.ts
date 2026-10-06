export interface QuestionnaireItem {
    linkId: string;
    text?: string;
    type: 'group' | 'display' | 'boolean' | 'decimal' | 'integer' | 'date' | 'dateTime' |
    'time' | 'string' | 'text' | 'url' | 'choice' | 'open-choice' | 'attachment' |
    'reference' | 'quantity';
    required?: boolean;
    repeats?: boolean;
    readOnly?: boolean;
    maxLength?: number;
    answerOption?: AnswerOption[];
    answerValueSet?: string;
    enableWhen?: EnableWhen[];
    enableBehavior?: 'all' | 'any';
    extension?: QuestionnaireExtension[];
    /** Raw nested items are normalized while building the questionnaire map. */
    item?: unknown[];
}

export interface QuestionnaireExtension {
    url?: string;
    [key: string]: unknown;
}

export interface QuestionnaireQuantity {
    value?: number;
    unit?: string;
    system?: string;
    code?: string;
    [key: string]: unknown;
}

export interface AnswerOption {
    valueInteger?: number;
    valueDate?: string;
    valueTime?: string;
    valueString?: string;
    valueCoding?: { system?: string; version?: string; code: string; display?: string };
    valueReference?: { reference: string };
    extension?: Array<{ url: string; valueBoolean?: boolean }>;
}

export interface EnableWhen {
    question: string;
    operator: 'exists' | '=' | '!=' | '>' | '<' | '>=' | '<=';
    answerBoolean?: boolean;
    answerDecimal?: number;
    answerInteger?: number;
    answerDate?: string;
    answerDateTime?: string;
    answerTime?: string;
    answerString?: string;
    answerCoding?: { system?: string; code: string };
    answerQuantity?: { value: number; unit?: string };
    answerReference?: { reference: string };
}

export interface QuestionnaireResponseItem {
    linkId?: string;
    text?: string;
    answer?: QuestionnaireResponseAnswer[];
    /** Raw nested items are normalized by the iterative traversal boundary. */
    item?: unknown[];
}

export interface QuestionnaireResponseAnswer {
    valueBoolean?: boolean;
    valueDecimal?: number;
    valueInteger?: number;
    valueDate?: string;
    valueDateTime?: string;
    valueTime?: string;
    valueString?: string;
    valueUri?: string;
    valueAttachment?: unknown;
    valueCoding?: { system?: string; version?: string; code?: string; display?: string };
    valueQuantity?: QuestionnaireQuantity;
    valueReference?: { reference: string };
    /** Raw nested items are normalized by the iterative traversal boundary. */
    item?: unknown[];
}
