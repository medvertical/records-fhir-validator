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
    item?: QuestionnaireItem[];
}

export interface AnswerOption {
    valueInteger?: number;
    valueDate?: string;
    valueTime?: string;
    valueString?: string;
    valueCoding?: { system?: string; code: string; display?: string };
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
    linkId: string;
    text?: string;
    answer?: QuestionnaireResponseAnswer[];
    item?: QuestionnaireResponseItem[];
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
    valueAttachment?: any;
    valueCoding?: { system?: string; code: string; display?: string };
    valueQuantity?: { value: number; unit?: string };
    valueReference?: { reference: string };
    item?: QuestionnaireResponseItem[];
}
