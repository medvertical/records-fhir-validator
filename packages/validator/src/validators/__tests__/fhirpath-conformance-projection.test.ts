import { describe, expect, it } from 'vitest';
import { SDFHIRPathExecutor } from '../sd-fhirpath-executor';
import { ConstraintValidator } from '../constraint-validator';
import type { ProfileConformanceLookup } from '../sd-fhirpath-profile-conformance';
import { precomputeProfileConformance } from '../sd-fhirpath-profile-conformance';
import type { StructureDefinition } from '../../core/structure-definition-types';
const target='http://example.org/StructureDefinition/target';
const definition:StructureDefinition={resourceType:'StructureDefinition',url:'http://example.org/profile',name:'Organization',status:'active',kind:'resource',abstract:false,type:'Organization',snapshot:{element:[{id:'Organization',path:'Organization',constraint:[{key:'actual-conformance',severity:'error',human:'Actual profile conformance',expression:`conformsTo('${target}')`}]}]}};
const runners={
 snapshot:(r:Record<string,unknown>,lookup:ProfileConformanceLookup)=>new SDFHIRPathExecutor().execute({resource:r,resourceType:'Organization',structureDef:definition,profileConformance:lookup}),
 constraint:(r:Record<string,unknown>,lookup:ProfileConformanceLookup)=>new ConstraintValidator().validate(r,definition.snapshot!.element,definition.url,{profileConformance:lookup}),
};
describe.each(Object.entries(runners))('%s projected conformance identity',(_name,run)=>{
 it('retains an established positive verdict for the original node',async()=>{
  const resource={resourceType:'Organization',active:true};const verdicts=new WeakMap<object,boolean>([[resource,true]]);
  expect(await run(resource,node=>verdicts.get(node))).toEqual([]);
 });
 it('retains an established rejection even when meta.profile declares the target',async()=>{
  const resource={resourceType:'Organization',meta:{profile:[target]}};const verdicts=new WeakMap<object,boolean>([[resource,false]]);
  expect(await run(resource,node=>verdicts.get(node))).toContainEqual(expect.objectContaining({severity:'error',ruleId:'actual-conformance'}));
 });
});
it('keeps a requested but unavailable datatype verdict distinct from an undeclared profile',async()=>{
 const resource={resourceType:'Identifier'};
 const lookup=await precomputeProfileConformance(definition.snapshot!.element,resource,async()=>undefined,{strictUnknown:true});
 expect(()=>lookup?.(resource,target)).toThrow('could not be established');
});
