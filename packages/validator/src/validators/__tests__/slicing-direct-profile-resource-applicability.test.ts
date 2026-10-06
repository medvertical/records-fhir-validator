import { expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import { SlicingValidator } from '../slicing-validator.js';

const canonical=(name:string)=>`https://example.org/StructureDefinition/direct-applicability-${name}`;
async function run(kind:'datatype'|'resource',sequence:string[]) {
  const type=kind==='datatype'?'Organization':'Patient';
  const path=type+(kind==='datatype'?'.identifier':'.contained');
  const targetType=kind==='datatype'?'Identifier':'Patient';
  const names=kind==='datatype'?['A','B']:['A'];
  const profile:StructureDefinition={resourceType:'StructureDefinition',url:canonical('host'),name:'ApplicabilityHost',status:'active',kind:'resource',abstract:false,type,fhirVersion:'4.0.1',snapshot:{element:[
    {id:type,path:type,min:0,max:'*'},
    {id:path,path,min:0,max:'*',type:[{code:kind==='datatype'?'Identifier':'Resource'}],slicing:{discriminator:[{type:'profile',path:'$this'}],rules:'closed'}},
    ...names.map(name=>({id:path+':'+name,path,sliceName:name,min:name==='A'?1:0,max:'1',type:[{code:kind==='datatype'?'Identifier':'Resource',profile:[canonical(name)]}]})),
  ]}};
  const definitions=new Map<string,StructureDefinition>(names.map(name=>[canonical(name),{resourceType:'StructureDefinition',url:canonical(name),name:'ApplicabilityTarget'+name,status:'active',kind:kind==='datatype'?'complex-type':'resource',abstract:false,type:targetType,fhirVersion:'4.0.1',snapshot:{element:[{id:targetType,path:targetType,min:0,max:'*'},...(kind==='datatype'?[{id:'Identifier.system',path:'Identifier.system',min:1,max:'1',fixedUri:'urn:direct:'+name}]:[])]}}]));
  const values=sequence.map(name=>kind==='datatype'?{system:'urn:direct:'+name,value:'normative'}:{resourceType:name});
  const resource={resourceType:type,[kind==='datatype'?'identifier':'contained']:values};
  let callbackCalls=0;
  const validator=new SlicingValidator({valueSetLoader:{loadValueSet:async()=>null}});
  validator.setTypeProfileResolver(async requested=>definitions.get(requested)??null);
  const issues=await validator.validateSlicing(values,path,profile,null,path,'R4',resource,path,async()=>{callbackCalls++;return undefined;});
  return {callbackCalls,incomplete:issues.some(issue=>typeof issue.details==='object'&&issue.details?.validationComplete===false),min:issues.some(issue=>issue.code==='profile-slice-min-cardinality'),closed:issues.some(issue=>issue.code==='profile-slice-closed-unmatched'),max:issues.some(issue=>issue.code==='profile-slice-max-cardinality')};
}
it('preserves Identifier fixed-system datatype membership with a resource-only callback',async()=>{expect(await run('datatype',['A'])).toEqual({callbackCalls:0,incomplete:false,min:false,closed:false,max:false});});
it('preserves a complete mixed Identifier datatype group',async()=>{expect(await run('datatype',['A','B'])).toEqual({callbackCalls:0,incomplete:false,min:false,closed:false,max:false});});
it('retains Resource $this uncertainty beside a known negative Resource',async()=>{expect(await run('resource',['Patient','Observation'])).toEqual({callbackCalls:1,incomplete:true,min:false,closed:true,max:false});});
