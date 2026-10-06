import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import type { ProfileConformanceVerdict } from '../sd-fhirpath-profile-conformance.js';
import { SlicingValidator } from '../slicing-validator.js';

const canonical = (name: string) => `https://example.org/StructureDefinition/direct-${name}`;
interface Control {
  verdict?: ProfileConformanceVerdict;
  sequence?: string[];
  perOccurrence?: Record<string, ProfileConformanceVerdict>;
  perProfile?: Record<string, Record<string, ProfileConformanceVerdict>>;
  claim?: boolean;
  missing?: boolean;
  publication?: unknown;
  canonical?: string;
  requestedEdition?: string;
  loadedEdition?: string;
  missingEdition?: boolean;
  alternatives?: boolean;
  missingAlternative?: boolean;
  twoSlices?: boolean;
  min?: number;
  minB?: number;
  max?: string;
  rules?: 'open' | 'closed' | 'openAtEnd';
  ordered?: boolean;
  scope?: 'subset' | 'clone';
}

async function run(control: Control) {
  const path = 'Bundle.entry';
  const elements: StructureDefinition['snapshot'] = { element: [
    {id:'Bundle',path:'Bundle',min:0,max:'*'},
    {id:path,path,min:0,max:'*',type:[{code:'BackboneElement'}],slicing:{discriminator:[{type:'profile',path:'resource'}],rules:control.rules??'open',ordered:control.ordered??false}},
    {id:path+':A',path,sliceName:'A',min:control.min??1,max:control.max??'1',type:[{code:'BackboneElement'}]},
    {id:path+':A.resource',path:path+'.resource',min:1,max:'1',type:[{code:'Observation',profile:[canonical('A')+(control.requestedEdition?'|'+control.requestedEdition:''),...(control.alternatives?[canonical('alternative')]:[])]}]},
  ]};
  if(control.twoSlices)elements.element.push(
    {id:path+':B',path,sliceName:'B',min:control.minB??0,max:'*',type:[{code:'BackboneElement'}]},
    {id:path+':B.resource',path:path+'.resource',min:1,max:'1',type:[{code:'Observation',profile:[canonical('B')]}]},
  );
  const profile: StructureDefinition = {resourceType:'StructureDefinition',url:canonical('host'),name:'DirectHost',status:'active',kind:'resource',abstract:false,type:'Bundle',snapshot:elements};
  const entries = (control.sequence??['observation']).map(label=>({resource:label==='patient'?{resourceType:'Patient'}:{resourceType:'Observation',status:'final',code:{text:'normative contract'},...(control.claim?{meta:{profile:[canonical('A')]}}:{})}}));
  if(control.sequence?.includes('duplicate'))entries[1]=entries[0];
  const resource={resourceType:'Bundle',entry:entries};
  const group=control.scope==='subset'?entries.slice(0,1):control.scope==='clone'?structuredClone(entries):entries;
  const callbacks: {index:number;profile:string;verdict:ProfileConformanceVerdict}[]=[];
  const resolve=async(url:string):Promise<StructureDefinition|null>=>{
    if(control.missing||(control.missingAlternative&&url===canonical('alternative')))return null;
    return {resourceType:'StructureDefinition',url:control.canonical??url.split('|')[0],name:'DirectTarget',status:'active',kind:'resource',abstract:false,type:'Observation',
      ...(control.missingEdition?{}:{version:control.loadedEdition??'1'}),
      ...(Object.hasOwn(control,'publication')?{fhirVersion:control.publication as string}:{fhirVersion:'4.0.1'})};
  };
  const validator=new SlicingValidator({valueSetLoader:{loadValueSet:async()=>null}});
  validator.setTypeProfileResolver(resolve);
  const issues=await validator.validateSlicing(group,path,profile,null,path,'R4',resource,path,async(target,url)=>{
    const index=group.findIndex(entry=>entry.resource===target);
    const key=url===canonical('B')?'B':'A';
    const verdict=control.perProfile?control.perProfile[key]?.[String(index)]:control.perOccurrence?control.perOccurrence[String(index)]:control.verdict;
    callbacks.push({index,profile:url,verdict});return verdict;
  });
  const has=(code:string)=>issues.some(issue=>issue.code===code);
  return {issues,callbacks,min:has('profile-slice-min-cardinality'),max:has('profile-slice-max-cardinality'),closed:has('profile-slice-closed-unmatched'),ordering:has('profile-slice-ordering-violation'),ambiguous:has('profile-slice-ambiguous-match'),incomplete:issues.some(issue=>typeof issue.details==='object'&&issue.details?.validationComplete===false)};
}

describe('direct resource profile evidence',()=>{
  it.each([
    ['confirmed true',{verdict:true},{min:false,incomplete:false}],
    ['confirmed false',{verdict:false},{min:true,incomplete:false}],
    ['unknown',{verdict:undefined},{min:false,incomplete:true}],
    ['unknown with declaration',{verdict:undefined,claim:true},{min:false,incomplete:true}],
    ['false with declaration',{verdict:false,claim:true},{min:true,incomplete:false}],
    ['missing definition',{missing:true},{min:false,incomplete:true}],
    ['foreign definition',{verdict:false,canonical:canonical('foreign')},{min:false,incomplete:true}],
    ['contradictory family',{verdict:false,publication:'5.0.0'},{min:false,incomplete:true}],
    ['same R4B family',{verdict:false,publication:'4.3.0'},{min:true,incomplete:false}],
    ['malformed publication',{verdict:false,publication:['4.0.1']},{min:false,incomplete:true}],
    ['matching business edition',{verdict:false,requestedEdition:'2',loadedEdition:'2'},{min:true,incomplete:false}],
    ['wrong business edition',{verdict:false,requestedEdition:'2',loadedEdition:'1'},{min:false,incomplete:true}],
    ['missing business edition',{verdict:false,requestedEdition:'2',missingEdition:true},{min:false,incomplete:true}],
    ['OR false plus unknown',{verdict:false,alternatives:true,missingAlternative:true},{min:false,incomplete:true}],
    ['OR all false',{verdict:false,alternatives:true},{min:true,incomplete:false}],
    ['OR true plus unknown',{verdict:true,alternatives:true,missingAlternative:true},{min:false,incomplete:false}],
  ] as const)('%s',async(_name,control,expected)=>{expect(await run(control)).toMatchObject(expected);});

  it('keeps a finite impossible minimum as an upper bound beside uncertainty',async()=>{
    const result=await run({sequence:['observation','observation'],min:3,max:'*'});
    expect(result).toMatchObject({min:true,max:false,incomplete:true});
    expect(result.issues.find(issue=>issue.code==='profile-slice-min-cardinality')?.details).toMatchObject({cardinalityUpperBound:2,occurrenceCount:2});
  });
  it('keeps empty applicable minima complete',async()=>{expect(await run({sequence:[]})).toMatchObject({min:true,incomplete:false});});
  it('counts duplicate physical occurrences for known maxima',async()=>{expect(await run({sequence:['observation','duplicate'],verdict:true})).toMatchObject({min:false,max:true,incomplete:false});});
  it.each(['subset','clone'] as const)('leaves unsupported %s on existing fallback',async(scope)=>{expect(await run({sequence:['observation','patient'],scope})).toMatchObject({min:true,incomplete:false});});
  it('does not close an unknown occurrence as a nonmember',async()=>{expect(await run({rules:'closed'})).toMatchObject({min:false,closed:false,incomplete:true});});
  it('retains an independently known closed nonmember beside unknown',async()=>{expect(await run({sequence:['observation','patient'],rules:'closed'})).toMatchObject({min:false,closed:true,incomplete:true});});
  it('keeps all confirmed failures definitive',async()=>{expect(await run({verdict:false,rules:'closed'})).toMatchObject({min:true,closed:true,incomplete:false});});
  it('does not turn an unknown gap into open-at-end content',async()=>{expect(await run({sequence:['observation','observation'],perOccurrence:{'1':true},rules:'openAtEnd'})).toMatchObject({min:false,max:false,ordering:false,incomplete:true});});
  it('retains known open-at-end ordering with its established warning severity',async()=>{
    const result=await run({sequence:['patient','observation'],verdict:true,rules:'openAtEnd'});
    expect(result).toMatchObject({ordering:true,incomplete:false});
    expect(result.issues.find(issue=>issue.code==='profile-slice-ordering-violation')?.severity).toBe('warning');
  });
  it('retains a known reversal through an unknown occurrence',async()=>{expect(await run({sequence:['observation','observation','observation'],max:'*',twoSlices:true,ordered:true,perProfile:{A:{'0':false,'2':true},B:{'0':true,'2':false}}})).toMatchObject({min:false,ordering:true,incomplete:true});});
  it('keeps a known A member while B stays unknown',async()=>{expect(await run({twoSlices:true,minB:1,perProfile:{A:{'0':true},B:{}}})).toMatchObject({min:false,incomplete:true});});
  it('proves an A minimum beside unknown B',async()=>{expect(await run({twoSlices:true,minB:1,perProfile:{A:{'0':false},B:{}}})).toMatchObject({min:true,incomplete:true});});
  it('does not arbitrarily assign two confirmed sibling profiles',async()=>{expect(await run({twoSlices:true,minB:1,verdict:true})).toMatchObject({min:false,max:false,ambiguous:true,incomplete:false});});
});
