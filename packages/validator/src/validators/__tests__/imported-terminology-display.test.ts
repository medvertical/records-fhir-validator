import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { buildCodeSystemResultIssues } from '../../core/executors/terminology-code-system-result-issues.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';
import { ValueSetValidator } from '../valueset-validator.js';
import type { CodeSystem, CodeSystemConcept } from '../valueset-types.js';

type Extension = { url: string; extension?: Extension[]; valueCode?: string; valueString?: string;
  valueBoolean?: boolean; valueInteger?: number; valueDecimal?: number };
type Label = readonly [id: string, language: string, kind: string, value: string, accepted: boolean];
type Anchor = { code: string; display: string; labels: readonly Label[] };
type ImportedConcept = CodeSystemConcept & { extension: Extension[];
  designation: Array<{ language: string; value: string; extension: Extension[] }> };
type ImportedSystem = CodeSystem & { extension: Extension[]; concept: ImportedConcept[] };
type Route = 'coding' | 'binding';
const prefix = 'https://records-fhir.dev/StructureDefinition/imported-terminology-';
const valueSetUrl = 'https://records.test/ValueSet/imported-display-controls';
const loincSha = '5a599e970ea966f195b6e71374767464e43e2624e4e6506e38b44069377f090f';
const snomedSha = 'd2418d4599c5b7a899bd8bcb51076a753d5514d4bbe24be333fb439a911edd2e';
// Complete own description rows for these four concepts are retained from the pinned Loop85 metadata.
const loincAnchors: readonly Anchor[] = [
  { code: "18776-5", display: "Plan of care note", labels: [
    ["537313", "de-DE", "LONG_COMMON_NAME", "Behandlungsplan - Dokumentation", true],
    ["583959", "el-GR", "RELATEDNAMES2", "{Ρόλος} {Ρυθμίσεις} Doc DOC.ONTOLOGY Pt Εύρεση Σημείωμα σχεδίου φροντίδας Σημείωση", false],
    ["135674", "en-US", "LONG_COMMON_NAME", "Plan of care note", true],
    ["135675", "en-US", "RELATEDNAMES2", "Care plan; DOC.ONT; Document; Encounter; Evaluation and management; Evaluation and management note; Finding; Findings; notes; Point in time; Random; Treatment plan; Visit note", false],
    ["135676", "en-US", "SHORTNAME", "Plan of care note", true],
    ["658808", "es-AR", "SHORTNAME", "plan de tratamiento:hallazgo:punto en el tiempo:plan de tratamiento:Narrativo:", true],
    ["746837", "es-MX", "LONG_COMMON_NAME", "Nota del plan de cuidados:{Configuración} :Punto temporal:Tipo:Documento:{Role}", true],
    ["937069", "it-IT", "RELATEDNAMES2", "Documentazione dell''ontologia Osservazione Piano di cura Punto nel tempo (episodio) Ruolo non specificato", false],
    ["1023422", "nl-NL", "LONG_COMMON_NAME", "Behandelplan [bevinding] in {instelling} d.m.v. {rol} (document)", true],
    ["1023423", "nl-NL", "RELATEDNAMES2", "zorgplan", false],
    ["1362267", "zh-CN", "RELATEDNAMES2", "临床文档型;临床文档;文档;文书;医疗文书;临床医疗文书 事件发生的地方;场景;环境;背景 医疗服务（照护服务、护理服务、护理、照护、医疗照护、诊疗、诊疗服务、照顾、看护）计划（方案）记录 发现是一个原子型临床观察指标，并不是作为印象的概括陈述。体格检查、病史、系统检查及其他此类观察指标的属性均为发现。它们的标尺对于编码型发现可能是名义型，而对于叙述型文本之中所报告的发现，则可能是叙述型。;发现物;所见;结果;结论 文档本体;临床文档本体;文档本体;文书本体;医疗文书本体;临床医疗文书本体 时刻;随机;随意;瞬间 未加明确说明的角色 笔记;按语;注释;说明;票据;单据;证明书", false],
  ] },
  { code: "59284-0", display: "Consent Document", labels: [
    ["548064", "de-DE", "LONG_COMMON_NAME", "Einwilligung - Dokument", true],
    ["616873", "el-GR", "RELATEDNAMES2", "{Ρυθμίσεις} Doc DOC.ONTOLOGY Pt Ασθενής Εύρεση Συγκατάθεση", false],
    ["265605", "en-US", "LONG_COMMON_NAME", "Consent Document", true],
    ["265606", "en-US", "RELATEDNAMES2", "DOC.ONT; Document; Finding; Findings; Form; Point in time; Random", false],
    ["265607", "en-US", "SHORTNAME", "Consent", true],
    ["778506", "es-MX", "LONG_COMMON_NAME", "Consentimiento:{Configuración} :Punto temporal:Tipo:Documento:Patient", true],
    ["972232", "it-IT", "RELATEDNAMES2", "Documentazione dell''ontologia Osservazione Punto nel tempo (episodio)", false],
    ["1022488", "nl-NL", "LONG_COMMON_NAME", "Toestemming [bevinding] in {instelling} d.m.v. patiënt (document)", true],
    ["1400598", "zh-CN", "RELATEDNAMES2", "临床文档型;临床文档;文档;文书;医疗文书;临床医疗文书 事件发生的地方;场景;环境;背景 医疗服务对象;客户;病人;超系统 - 病人 发现是一个原子型临床观察指标，并不是作为印象的概括陈述。体格检查、病史、系统检查及其他此类观察指标的属性均为发现。它们的标尺对于编码型发现可能是名义型，而对于叙述型文本之中所报告的发现，则可能是叙述型。;发现物;所见;结果;结论 同意书;知情同意;知情同意书 文档本体;临床文档本体;文档本体;文书本体;医疗文书本体;临床医疗文书本体 时刻;随机;随意;瞬间", false],
  ] },
];
const snomedAnchors: readonly Anchor[] = [
  { code: "721912009", display: "Medication summary document (record artifact)", labels: [
    ["3327742011", "en", "900000000000003001", "Medication summary document (record artifact)", true],
    ["3327743018", "en", "900000000000013009", "Medication summary document", true],
  ] },
  { code: "72098002", display: "Entire left upper arm", labels: [
    ["119808013", "en", "900000000000013009", "Left arm", false],
    ["200254012", "en", "900000000000013009", "Left upper arm", false],
    ["502035018", "en", "900000000000013009", "Entire left upper arm", true],
    ["812337013", "en", "900000000000003001", "Entire left upper arm (body structure)", true],
    ["3329932013", "en", "900000000000013009", "Entire left arm", true],
  ] },
];

function projection(format: 'loinc' | 'snomed'): ImportedSystem {
  const anchors = format === 'loinc' ? loincAnchors : snomedAnchors;
  return { resourceType: 'CodeSystem', url: format === 'loinc' ? 'http://loinc.org' : 'http://snomed.info/sct',
    version: format === 'loinc' ? '2.82' : 'http://snomed.info/sct/900000000000207008/version/20250201',
    language: format === 'loinc' ? 'en-US' : 'en', content: 'fragment', caseSensitive: true,
    extension: [{ url: `${prefix}source`, extension: [
      { url: 'contract', valueCode: 'records.fhirsmith.terminology-projection.v1' },
      { url: 'format', valueCode: format }, { url: 'sha256', valueString: format === 'loinc' ? loincSha : snomedSha },
      { url: 'businessVersion', valueString: format === 'loinc' ? '2.82' : 'http://snomed.info/sct/900000000000207008/version/20250201' },
      { url: 'displayLanguageMatch', valueCode: 'base-language' },
    ] }],
    concept: anchors.map(anchor => {
      const designation: ImportedConcept['designation'] = [];
      const extension: Extension[] = [{ url: `${prefix}label-coverage`, extension: [
        { url: 'completeSourceDescriptions', valueBoolean: true },
        { url: 'sourceDescriptionCount', valueInteger: anchor.labels.length },
      ] }];
      for (const [id, language, kind, value, accepted] of anchor.labels) {
        const metadata = { url: `${prefix}description`, extension: [
          { url: 'id', valueString: id }, { url: 'language', valueCode: language },
          { url: 'kind', valueCode: kind }, { url: 'value', valueString: value },
          format === 'loinc' ? { url: 'acceptedLabel', valueBoolean: accepted } : { url: 'active', valueBoolean: accepted },
        ] };
        if (accepted) designation.push({ language, value, extension: [metadata] });
        else extension.push(metadata);
      }
      return { code: anchor.code, display: anchor.display, extension, designation };
    }),
  };
}

afterEach(() => vi.restoreAllMocks());
function validator(codeSystem: ImportedSystem) {
  vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
  const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
  values.setResolutionConfig({ strategy: 'local-only', servers: [], reportUnverifiedBindings: true,
    serverDelegation: { validateCodes: false, expandValueSets: false } });
  expect(values.registerExternalTerminologyResource(codeSystem, 'R4')).toBe(true);
  expect(values.registerExternalTerminologyResource({ resourceType: 'ValueSet', url: valueSetUrl,
    compose: { include: [{ system: codeSystem.url }] } }, 'R4')).toBe(true);
  return values;
}
async function owner(values: ValueSetValidator, route: Route, cs: ImportedSystem, code: string,
  display: string, language?: string, version?: string) {
  const coding = { system: cs.url, code, display, ...(version ? { version } : {}) };
  if (route === 'binding') return values.validateBinding(coding,
    { strength: 'required', valueSet: valueSetUrl }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: language });
  const result = await values.validateCodeInCodeSystem(code, cs.url, display, 'R4', version, language);
  return buildCodeSystemResultIssues(coding, result, 'Observation.code', 0, false);
}
function verify(issues: ValidationIssue[], verdict: 'P' | 'N' | 'U') {
  expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(verdict === 'N' ? 1 : 0);
  expect(issues.some(issue => issue.details?.validationComplete === false)).toBe(verdict === 'U');
  if (verdict === 'N') expect(issues).toContainEqual(expect.objectContaining({
    severity: 'error', path: 'Observation.code.display', code: 'terminology-display-mismatch',
  }));
  if (verdict === 'U') expect(issues).toContainEqual(expect.objectContaining({
    details: expect.objectContaining({ validationStatus: 'incomplete' }),
  }));
}
function replaceField(extension: Extension, name: string, replacement: Extension) {
  extension.extension = extension.extension!.map(field => field.url === name ? replacement : field);
}
const displayCases = [
  ['loinc', '18776-5', 'Plan of care note', 'en-US', 'P'],
  ['loinc', '18776-5', 'Plan of care note', 'en-NZ', 'P'],
  ['loinc', '18776-5', 'Behandlungsplan - Dokumentation', 'de-DE', 'P'],
  ['loinc', '18776-5', 'Behandlungsplan - Dokumentation', 'en-NZ', 'N'],
  ['loinc', '18776-5', 'Plan of care note', 'fr-FR', 'U'],
  ['loinc', '18776-5', 'Plan of care', undefined, 'N'],
  ['loinc', '59284-0', 'CONSENT', undefined, 'P'],
  ['loinc', '59284-0', 'DOC.ONT; Document; Finding; Findings; Form; Point in time; Random', undefined, 'N'],
  ['snomed', '721912009', 'Medication summary document', 'en-NZ', 'P'],
  ['snomed', '72098002', 'Entire left arm', 'en-US', 'P'],
  ['snomed', '72098002', 'Left arm', 'en-US', 'N'],
  ['snomed', '72098002', 'Entire left arm', 'fr-FR', 'U'],
] as const;
const malformed: Array<[string, (cs: ImportedSystem) => void]> = [
  ['non-array source extensions', cs => Reflect.set(cs, 'extension', cs.extension[0])],
  ['non-array designation', cs => Reflect.set(cs.concept[0], 'designation', cs.concept[0].designation[0])],
  ['unknown contract', cs => replaceField(cs.extension[0], 'contract', { url: 'contract', valueCode: 'unknown-projection.v1' })],
  ['wrong contract datatype', cs => replaceField(cs.extension[0], 'contract', { url: 'contract', valueString: 'records.fhirsmith.terminology-projection.v1' })],
  ['duplicate source contract', cs => cs.extension.push(structuredClone(cs.extension[0]))],
  ['source edition mismatch', cs => replaceField(cs.extension[0], 'businessVersion', { url: 'businessVersion', valueString: '2.77' })],
  ['malformed source hash', cs => replaceField(cs.extension[0], 'sha256', { url: 'sha256', valueString: 'unattested' })],
  ['missing complete coverage', cs => replaceField(cs.concept[0].extension[0], 'completeSourceDescriptions', { url: 'completeSourceDescriptions', valueBoolean: false })],
  ['duplicate coverage', cs => cs.concept[0].extension.push(structuredClone(cs.concept[0].extension[0]))],
  ['missing description count', cs => cs.concept[0].extension[0].extension!.pop()],
  ['wrong description count', cs => replaceField(cs.concept[0].extension[0], 'sourceDescriptionCount', { url: 'sourceDescriptionCount', valueInteger: 1 })],
  ['wrong count datatype', cs => replaceField(cs.concept[0].extension[0], 'sourceDescriptionCount', { url: 'sourceDescriptionCount', valueDecimal: cs.concept[0].designation.length + cs.concept[0].extension.length - 1 })],
  ['duplicate description identity', cs => {
    const first = cs.concept[0].designation[0].extension[0].extension!.find(field => field.url === 'id')!;
    replaceField(cs.concept[0].designation[1].extension[0], 'id', structuredClone(first));
  }],
  ['unannotated ordinary label', cs => cs.concept[0].designation.push({ language: 'en-US', value: 'Injected alias', extension: [] })],
];
for (const route of ['coding', 'binding'] as const) {
  describe(`${route} imported own labels through public registration`, () => {
    it.each(displayCases)('%s %s label=%s language=%s => %s first/repeated', async (format, code, display, language, verdict) => {
      const cs = projection(format); const before = structuredClone(cs); const values = validator(cs);
      for (let round = 0; round < 2; round++) verify(await owner(values, route, cs, code, display, language), verdict);
      expect(cs).toEqual(before);
    });
    it.each(malformed)('%s retains Unknown first/repeated', async (_name, mutate) => {
      const cs = projection('loinc'); mutate(cs); const values = validator(cs);
      for (let round = 0; round < 2; round++) verify(await owner(values, route, cs, '18776-5', 'Plan of care note', 'en-NZ'), 'U');
    });
    it('retains the generic language guard when no imported contract is present', async () => {
      const cs = projection('loinc'); cs.extension = []; const values = validator(cs);
      for (let round = 0; round < 2; round++) verify(await owner(values, route, cs, '18776-5', 'Plan of care note', 'en-NZ'), 'U');
    });
    it('does not borrow a source edition for an unavailable requested edition', async () => {
      const cs = projection('loinc'); const values = validator(cs);
      for (let round = 0; round < 2; round++) verify(await owner(values, route, cs, '18776-5', 'Plan of care note', 'en-NZ', '2.77'), 'U');
    });
    it('keeps unlisted fragment membership Unknown', async () => {
      const cs = projection('loinc'); const values = validator(cs);
      for (let round = 0; round < 2; round++) {
        const issues = await owner(values, route, cs, 'unlisted', 'Plan of care note', 'en-NZ');
        expect(issues.some(issue => issue.details?.validationComplete === false)).toBe(true);
        expect(issues.some(issue => issue.severity === 'error')).toBe(false);
      }
      expect(cs.content).toBe('fragment');
    });
    it('keeps unknown SCT description activity Unknown', async () => {
      const cs = projection('snomed');
      const concept = cs.concept.find(entry => entry.code === '72098002')!;
      const description = concept.extension.find(extension => extension.url === `${prefix}description`)!;
      description.extension = description.extension!.filter(field => field.url !== 'active');
      const values = validator(cs);
      for (let round = 0; round < 2; round++) verify(await owner(values, route, cs, '72098002', 'Left arm', 'en-US'), 'U');
    });
    it('preserves inactive-label semantics separately from ordinary wrong-label rejection', async () => {
      const cs = projection('snomed'); const values = validator(cs);
      for (let round = 0; round < 2; round++) {
        const issues = await owner(values, route, cs, '72098002', 'Left arm', 'en-US'); verify(issues, 'N');
        expect(issues.find(issue => issue.code === 'terminology-display-mismatch')?.message).toMatch(/^Inactive Display Name/);
        expect(await owner(values, route, cs, '72098002', 'Entire left arm', 'en-US')).toEqual([]);
      }
    });
  });
}
