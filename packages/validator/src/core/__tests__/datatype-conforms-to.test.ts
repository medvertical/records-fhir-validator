import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { RecordsValidator } from '../validator-engine';
import { setProfileSource } from '../../persistence';
import { createFilesystemProfileSource } from '../../persistence/filesystem-profile-source';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';

const holder = 'http://example.org/StructureDefinition/manufacturer-identifier';
const actual = 'http://example.org/StructureDefinition/actual-identifier';
const folders: string[] = [];
afterEach(async () => { setProfileSource({});clearCanonicalPinCaches();await Promise.all(folders.splice(0).map(p=>rm(p,{recursive:true,force:true}))); });
async function validator(missing = false) {
 const root=await mkdtemp(join(tmpdir(),'records-datatype-conforms-'));folders.push(root);
 const folder=join(root,'example.datatype#1.0.0','package');await mkdir(folder,{recursive:true});
 await writeFile(join(folder,'package.json'),JSON.stringify({name:'example.datatype',version:'1.0.0',fhirVersions:['4.0.1']}));
 for(const [url,elements]of [
  [holder,[{id:'Identifier',path:'Identifier',constraint:[{key:'manufacturer',severity:'error',human:'Conform to identifier',expression:`conformsTo('${actual}')`}]}]],
  [actual,[{id:'Identifier',path:'Identifier'},{id:'Identifier.system',path:'Identifier.system',min:1,max:'1',type:[{code:'uri'}],patternUri:'urn:manufacturer'},
   {id:'Identifier.value',path:'Identifier.value',min:1,max:'1',type:[{code:'string'}],constraint:[{key:'digits',severity:'error',human:'Nine digits',expression:"matches('^[0-9]{9}$')"}]}]],
 ] as const)if (!missing || url !== actual) await writeFile(join(folder,url.split('/').at(-1)+'.json'),JSON.stringify({resourceType:'StructureDefinition',url,version:'1.0.0',
  name:'Identifier',status:'active',kind:'complex-type',abstract:false,type:'Identifier',fhirVersion:'4.0.1',
  baseDefinition:'http://hl7.org/fhir/StructureDefinition/Identifier',derivation:'constraint',snapshot:{element:elements}}));
 const pins={'example.datatype':'1.0.0'};setProfileSource(createFilesystemProfileSource({packageDirs:[root],packageVersionPins:pins}));
 const v=new RecordsValidator({packageCachePath:root,bundledProfilesPath:null,autoDownload:false,packageVersionPins:pins,prewarmProfileSource:false,preloadPackageInventory:false});
 await v.waitForInitialization();return v;
}
describe('actual conformance of a typed datatype projection',()=>{
 it('evaluates its target definition rather than requiring meta.profile on an Identifier',async()=>{
  const v=await validator();const resource={resourceType:'Identifier',system:'urn:manufacturer',value:'123456789'};
  const issues=await v.validate(resource,holder,'R4');
  expect(issues.filter(i=>i.severity==='error'||i.severity==='fatal')).toEqual([]);
  expect(resource).not.toHaveProperty('meta');
 });
 it.each([{system:'urn:other',value:'123456789'},{system:'urn:manufacturer',value:'123'}])('rejects actual target-profile defects: $system / $value',async fields=>{
  const v=await validator();const issues=await v.validate({resourceType:'Identifier',...fields},holder,'R4');
  expect(issues).toContainEqual(expect.objectContaining({severity:'error',ruleId:'manufacturer'}));
 });
 it('reports an unavailable target as incomplete without inventing a conformance violation',async()=>{
  const v=await validator(true);const issues=await v.validate({resourceType:'Identifier',system:'urn:manufacturer',value:'123456789'},holder,'R4');
  expect(issues.some(i=>i.severity==='error'||i.severity==='fatal')).toBe(false);
  expect(issues).toContainEqual(expect.objectContaining({code:'profile-constraint-evaluation-error',ruleId:'manufacturer'}));
 });
});
