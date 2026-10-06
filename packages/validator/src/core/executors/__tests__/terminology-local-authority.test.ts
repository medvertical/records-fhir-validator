import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { TerminologyExecutor } from '../terminology-executor.js';
import { ValueSetValidator } from '../../../validators/valueset-validator.js';
import { ValueSetCache } from '../../../validators/valueset-cache.js';
import { ValueSetPackageResourceAccess } from '../../../validators/valueset-package-resource-access.js';
import { validateLocalCodeSystemCoding } from '../terminology-external-code-system-rules.js';
import { undefinedCoreCodeSystemIssues } from '../terminology-core-code-system-rules.js';
import { parseCodeSystemValidationParameters } from '../../../validators/terminology-code-system-result.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinition } from '../../structure-definition-types.js';
import type { FhirResourceRecord } from '../../../reference/bundle-reference-types.js';
import type { ProfileSourceContext } from '../../../persistence/index.js';
import { createTerminologyEvidencePort } from '../terminology-validation-evidence-port.js';
import type { CodeSystemValidationResult } from '../../../validators/terminology-api-types.js';
import { DEFAULT_RESOLUTION_CONFIG } from '../../../validators/valueset-types.js';

let own: string;
const originalEnvironment = {
  FHIR_PACKAGE_CACHE_PATH: process.env.FHIR_PACKAGE_CACHE_PATH,
  RECORDS_BUNDLED_PROFILES_PATH: process.env.RECORDS_BUNDLED_PROFILES_PATH,
};
const delegationDefaults=()=>{
 const defaults=DEFAULT_RESOLUTION_CONFIG.serverDelegation;
 if(!defaults)throw Error('Terminology defaults require server delegation configuration');
 return defaults;
};
const system='https://authority.example.test/CodeSystem/codes';
const coding=(code='member',version?:string,display?:string)=>({system,code,...(version?{version}:{}),...(display?{display}:{})});
const details=(issue:ValidationIssue)=>typeof issue.details==='object'&&issue.details!==null?issue.details:{};
const incomplete=(issues:ValidationIssue[])=>issues.some(issue=>details(issue).validationComplete===false||details(issue).validationStatus==='incomplete');
const parameters=(result:boolean,extra:unknown[]=[])=>({resourceType:'Parameters',parameter:[{name:'result',valueBoolean:result},...extra]});
const minimalSD:StructureDefinition={resourceType:'StructureDefinition',id:'Observation',url:'https://profiles.example.test/Observation',name:'Observation',status:'active',kind:'resource',abstract:false,type:'Observation',derivation:'constraint',snapshot:{element:[{id:'Observation',path:'Observation'},{id:'Observation.code',path:'Observation.code',min:0,max:'1',type:[{code:'CodeableConcept'}]}]}};
const resource=(codings=[coding()]):FhirResourceRecord=>({resourceType:'Observation',code:{coding:codings}});
let getter:ReturnType<typeof vi.spyOn>;
beforeAll(async()=>{own=await fs.mkdtemp(path.join(tmpdir(),'records-local-authority-'));await fs.mkdir(own+'/test-catalog',{recursive:true});process.env.FHIR_PACKAGE_CACHE_PATH=own+'/test-catalog';process.env.RECORDS_BUNDLED_PROFILES_PATH=own+'/test-catalog';});
beforeEach(()=>{vi.spyOn(ValueSetPackageResourceAccess.prototype,'getPackageDirectories').mockReturnValue([own+'/test-catalog']);getter=vi.spyOn(axios,'get');getter.mockImplementation(()=>{throw Error('Undeclared request');});});
afterEach(()=>{vi.restoreAllMocks();});
afterAll(async()=>{
  try { await fs.rm(own,{recursive:true,force:true}); } finally {
    for(const [name,value] of Object.entries(originalEnvironment)){
      if(value===undefined)delete process.env[name];else process.env[name]=value;
    }
  }
});
function validator(local?:{version?:string;content?:string;concept?:unknown[]}){
 const values=new ValueSetValidator(new ValueSetCache(),undefined,[own+'/test-catalog']);
 values.setResolutionConfig({strategy:'local-first',serverUrl:'https://tx.example.test',servers:[{id:'synthetic-authority',url:'https://tx.example.test',enabled:true,fhirVersions:['R4','R5','R6'],preferredSystems:[system]}],serverDelegation:{...delegationDefaults(),validateCodes:true,expandValueSets:false}});
 if(local)values.registerExternalTerminologyResource({resourceType:'CodeSystem',id:'test',url:system,status:'active',content:local.content??'complete',version:local.version??'1',concept:local.concept??[{code:'member',display:'Member'}]},'R4');
 return values;
}
async function execute(values:ValueSetValidator,body=resource(),fhirVersion:'R4'|'R5'|'R6'='R4',sourceContext?:ProfileSourceContext){
 return new TerminologyExecutor(values).validate({resource:body,structureDef:minimalSD,getValueAtPath:()=>undefined,fhirVersion,sourceContext});
}
const respond=(payload:unknown)=>getter.mockResolvedValue({data:payload,status:200,headers:{}});

describe('same-Coding remote authority and local fallback',()=>{
 it.each([true,false])('preserves an explicit remote result %s when local data is absent',async result=>{
  respond(parameters(result));const issues=await execute(validator());
  expect(incomplete(issues)).toBe(false);expect(issues.filter(issue=>issue.code==='terminology-code-invalid')).toHaveLength(result?0:1);expect(getter).toHaveBeenCalledTimes(1);
 });
 it('does not trust unmarked transport-failure acceptance',async()=>{
  getter.mockRejectedValue(new Error('Synthetic network failure'));const issues=await execute(validator());
  expect(incomplete(issues)).toBe(true);expect(issues.some(issue=>issue.severity==='error')).toBe(false);
 });
 it('preserves a remote display error without adding local uncertainty',async()=>{
  respond(parameters(false,[{name:'message',valueString:'Wrong Display Name'},{name:'issues',resource:{resourceType:'OperationOutcome',issue:[{severity:'error',code:'invalid',details:{coding:[{system:'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type',code:'invalid-display'}],text:'Wrong Display Name'}}]}}]));
  const issues=await execute(validator(),resource([coding('member','1','Wrong')]));
  expect(issues.some(issue=>issue.code==='terminology-display-mismatch')).toBe(true);expect(incomplete(issues)).toBe(false);
 });
 it('keeps an unresolved response unknown',async()=>{
  respond({resourceType:'Parameters',parameter:[{name:'message',valueString:'CodeSystem unavailable'}]});const issues=await execute(validator());expect(incomplete(issues)).toBe(true);
 });
 it('does not let a receipt for one edition cover a different edition',async()=>{
  getter.mockImplementation(async(_url:unknown,config:unknown)=>{
  const params=typeof config==='object'&&config!==null&&'params' in config?config.params:undefined;
  const version=typeof params==='object'&&params!==null&&'version' in params?params.version:undefined;
  return {data:version==='1'?parameters(true):{resourceType:'Parameters',parameter:[{name:'message',valueString:'Cannot resolve CodeSystem'}]},status:200,headers:{}};
 });
  const issues=await execute(validator(),resource([coding('member','1'),coding('member','2')]));
  expect(issues.some(issue=>issue.path?.includes('[0]')&&details(issue).validationComplete===false)).toBe(false);
  expect(issues.some(issue=>issue.path?.includes('[1]')&&details(issue).validationComplete===false)).toBe(true);expect(getter).toHaveBeenCalledTimes(2);
 });
 it('never shares one validation run receipt with another run',async()=>{
  const values=validator();respond(parameters(true));expect(incomplete(await execute(values,resource(),'R4',{organizationId:1,serverId:1,fhirVersion:'R4'}))).toBe(false);
  getter.mockRejectedValue(new Error('Synthetic outage in next scope'));const issues=await execute(values,resource(),'R5',{organizationId:2,serverId:2,fhirVersion:'R5'});expect(incomplete(issues)).toBe(true);
 });

 it('does not cover an unvisited Coding from a different edition',async()=>{
  respond(parameters(true));const issues=await execute(validator(),{...resource([coding('member','1')]),extension:[{url:'https://example.test/ext',valueCoding:coding('member','2')}]});
  expect(issues.some(issue=>issue.path?.includes('code.coding')&&details(issue).validationComplete===false)).toBe(false);expect(issues.some(issue=>issue.path?.includes('extension')&&details(issue).validationComplete===false)).toBe(true);
 });
 it('does not cover an unvisited Coding from a different display',async()=>{
  respond(parameters(true));const issues=await execute(validator(),{...resource([coding('member','1','Remote label')]),extension:[{url:'https://example.test/ext',valueCoding:coding('member','1','Other label')}]});expect(issues.some(issue=>issue.path?.includes('extension')&&details(issue).validationComplete===false)).toBe(true);
 });
 it('does not treat conflicting duplicate result booleans as completion evidence',async()=>{
  respond(parameters(true,[{name:'result',valueBoolean:false}]));expect(incomplete(await execute(validator()))).toBe(true);
 });

 it('retains verified rejection despite equivalent display spelling',async()=>{
  respond(parameters(false,[{name:'message',valueString:"Wrong Display Name 'member'. Valid display is 'Member'."},{name:'issues',resource:{resourceType:'OperationOutcome',issue:[{severity:'error',code:'invalid',details:{coding:[{system:'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type',code:'invalid-display'}],text:"Wrong Display Name 'member'. Valid display is 'Member'."}}]}}]));
  const issues=await execute(validator(),resource([coding('member','1','member')]));expect(issues).toContainEqual(expect.objectContaining({code:'terminology-display-mismatch',severity:'error'}));expect(incomplete(issues)).toBe(false);
 });
 it('does not reuse a language-specific remote receipt for an omitted-language local request',async()=>{
  const values=validator();
  const remote=vi.spyOn(values,'validateCodeInCodeSystem').mockImplementation(async(code,system)=>parseCodeSystemValidationParameters(parameters(true),code,system));
  const local=vi.spyOn(values,'validateCodeInLocalCodeSystemOnly').mockResolvedValue(null);
  const wrapped=createTerminologyEvidencePort(values);
  await wrapped.validateCodeInCodeSystem('member',system,'Member','R4','1','en-NZ');
  expect(await wrapped.validateCodeInLocalCodeSystemOnly('member',system,'Member','R4','1')).toBeNull();
  expect(remote).toHaveBeenCalledWith('member',system,'Member','R4','1','en-NZ');
  expect(local).toHaveBeenCalledWith('member',system,'Member','R4','1');
 });
 it('preserves legacy exact-coding receipts and original private-field receivers',async()=>{
  class PrivateEvidencePort extends ValueSetValidator {
   #calls=0;get callCount(){return this.#calls;}
   override async validateCodeInCodeSystem(...args:Parameters<ValueSetValidator['validateCodeInCodeSystem']>):Promise<CodeSystemValidationResult>{this.#calls++;return parseCodeSystemValidationParameters(parameters(true),args[0],args[1]);}
   override async validateCodeInLocalCodeSystemOnly(..._args:Parameters<ValueSetValidator['validateCodeInLocalCodeSystemOnly']>):Promise<CodeSystemValidationResult|null>{this.#calls++;return null;}
   override getResolutionConfig(){this.#calls++;return super.getResolutionConfig();}
  }
  const values=new PrivateEvidencePort(new ValueSetCache(),undefined,[own+'/test-catalog']);
  const wrapped=createTerminologyEvidencePort(values);
  const receipt=await wrapped.validateCodeInCodeSystem('member',system,'Member','R4','1');
  expect(await wrapped.validateCodeInLocalCodeSystemOnly('member',system,'Member','R4','1')).toBe(receipt);
  expect(wrapped.getResolutionConfig()).toBeDefined();expect(Reflect.get(wrapped,'callCount')).toBe(3);
 });
 it('preserves host-port receivers that use private fields',async()=>{
  class PrivatePort extends ValueSetValidator {#calls=0;get callCount(){return this.#calls;}override getResolutionConfig(){this.#calls+=1;return super.getResolutionConfig();}}
  respond(parameters(true));const values=new PrivatePort(new ValueSetCache(),undefined,[own+'/test-catalog']);values.setResolutionConfig(validator().getResolutionConfig());expect(incomplete(await execute(values))).toBe(false);expect(values.getResolutionConfig()).toBeDefined();expect(values.callCount).toBeGreaterThan(0);
 });
});

describe('actual local authority and its unavailable boundary',()=>{
 it.each([['member',true],['absent',false]] as const)('preserves complete local %s',async(code,valid)=>{
  const issues=await execute(validator({content:'complete'}),resource([coding(code,'1')]));expect(incomplete(issues)).toBe(false);expect(issues.some(issue=>issue.code==='terminology-code-invalid')).toBe(!valid);expect(getter).not.toHaveBeenCalled();
 });
 it('preserves complete local display mismatch',async()=>{const issues=await execute(validator({content:'complete'}),resource([coding('member','1','Wrong')]));expect(issues.some(issue=>issue.code==='terminology-display-mismatch')).toBe(true);expect(incomplete(issues)).toBe(false);});
 it('preserves a present fragment code',async()=>{const issues=await execute(validator({content:'fragment'}));expect(incomplete(issues)).toBe(false);expect(issues.some(issue=>issue.severity==='error')).toBe(false);});
 it('keeps absence from a fragment uncertain',async()=>{const issues=await execute(validator({content:'fragment'}),resource([coding('absent')]));expect(incomplete(issues)).toBe(true);expect(issues.some(issue=>issue.severity==='error')).toBe(false);});
 it.each(['not-present','supplement'])('keeps non-assertable %s local-only data unknown',async content=>{
  const values=validator({content});values.setResolutionConfig({strategy:'local-only',serverDelegation:{...delegationDefaults(),validateCodes:false,expandValueSets:false}});
  const issues=await execute(values,{resourceType:'Observation',extension:[{url:'https://example.test/ext',valueCoding:coding()}]});
  expect(incomplete(issues)).toBe(true);expect(issues.some(issue=>issue.severity==='error')).toBe(false);
 });
 it('does not reinterpret another local edition as requested membership',async()=>{
  const values=validator({version:'1'});const issues=await validateLocalCodeSystemCoding(coding('member','99'),'Observation.valueCoding',values,'R4');expect(incomplete(issues)).toBe(true);expect(issues.some(issue=>issue.severity==='error')).toBe(false);
 });
 it('keeps the namespace error but annotates the cannot-validate warning',()=>{
  const issues=undefinedCoreCodeSystemIssues('http://hl7.org/fhir/CodeSystem/absent','member',undefined,'Observation.code.system');
  expect(issues.map(issue=>[issue.code,issue.severity,issue.path])).toEqual([['terminology-codesystem-undefined','error','Observation.code.system'],['terminology-codesystem-unresolvable','warning','Observation.code.system']]);expect(details(issues[0]).validationComplete).toBeUndefined();expect(details(issues[1]).validationComplete).toBe(false);
 });
});

describe('existing algorithmic namespaces and response shape',()=>{
 it.each([['https://example.test/id',false],['relative',true]] as const)('keeps URI code %s',async(code,invalid)=>{
  const issues=await validateLocalCodeSystemCoding({system:'urn:ietf:rfc:3986',code},'Parameters.parameter[0].valueCoding',{validateCodeInLocalCodeSystemOnly:async()=>null},'R4');expect(incomplete(issues)).toBe(false);expect(issues.some(issue=>issue.severity==='error')).toBe(invalid);
 });
 it.each([['mg',false],['invalid_unit_xyz',true]] as const)('keeps UCUM code %s',async(code,invalid)=>{
  const issues=await validateLocalCodeSystemCoding({system:'http://unitsofmeasure.org',code},'Observation.valueCoding',{validateCodeInLocalCodeSystemOnly:async()=>null},'R4');expect(incomplete(issues)).toBe(false);expect(issues.some(issue=>issue.severity==='error')).toBe(invalid);
 });
 it('keeps operational meta.tag out of membership validation',async()=>{
  const issues=await execute(validator(),{resourceType:'Observation',meta:{tag:[{system:'https://example.test/tags',code:'custom'}]}});expect(incomplete(issues)).toBe(false);expect(getter).not.toHaveBeenCalled();
 });
 it('retains the exact public parser result shape',()=>{
  expect(parseCodeSystemValidationParameters(parameters(true),'member',system)).toEqual({valid:true,message:undefined,issues:[],inactive:false,display:undefined});
  expect(parseCodeSystemValidationParameters(parameters(false),'member',system)).toEqual({valid:false,message:`Unknown code 'member' in CodeSystem '${system}'`,reason:'code-unknown',issues:[],inactive:false,display:undefined});
 });
});
