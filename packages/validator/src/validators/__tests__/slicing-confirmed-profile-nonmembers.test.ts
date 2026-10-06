import { describe, expect, it } from 'vitest';
import {SlicingValidator} from '../slicing-validator.js';
import {extractSlicingInfo} from '../slice-info-extractor.js';
import {prepareValidatedProfileConformance} from '../slice-validated-conformance.js';
import {assignElementsToSlices} from '../slicing-match-assignment.js';
import * as cardinality from '../slicing-slice-validation.js';
const canonical=(key:string)=>`https://example.org/StructureDefinition/g3a-${key}`;
async function run(c:any){
 const path='List.entry',rows:any[]=[{id:'List',path:'List',min:0,max:'*'},{id:path,path,type:[{code:'BackboneElement'}],min:0,max:'*',slicing:{discriminator:[{type:'profile',path:c.path??'item.resolve()'},...(c.andDiscriminator?[{type:'exists',path:'flag'}]:[])],rules:c.rules??'closed',ordered:!!c.ordered}}];
 for(const name of ['A','B']){rows.push({id:`${path}:${name}`,path,sliceName:name,min:name==='B'?(c.minB??0):0,max:'*',type:[{code:'BackboneElement'}]});rows.push({id:`${path}:${name}.item`,path:`${path}.item`,min:1,max:'1',type:[{code:'Reference',targetProfile:(name==='A'?(c.aProfiles??['A']):['B']).map(canonical)}]});if(c.andDiscriminator)rows.push({id:`${path}:${name}.flag`,path:`${path}.flag`,min:1,max:'1'});}
 if(c.duplicateSliceName)rows.find(e=>e.id===`${path}:B`).sliceName='A';
 if(c.scope==='conditional')rows.push({id:`${path}:conditional.child`,path,slicing:{discriminator:[{type:'profile',path:'item.resolve()'}],rules:'closed'}});
 const profile:any={resourceType:'StructureDefinition',url:canonical('host'),name:'G3aHost',status:'active',kind:'resource',abstract:false,type:'List',snapshot:{element:rows}};
 const calls:any={profiles:[],conformance:[],references:[]};const targets=new Map<string,any>();const entries:any[]=[];
 for(const [index,label]of c.sequence.entries()){
  if(label==='duplicate'){entries.push(structuredClone(entries[0]));continue;}
  if(label==='same-object'){entries.push(entries[0]);continue;}
  const unavailable=label.startsWith('unavailable'),mode=label.startsWith('true-B')?'true-B':label.startsWith('true-A')?'true-A':label==='unknown-meta'?'unknown':'false';
  const ref=`urn:uuid:g3a-${index}`;const target:any={resourceType:mode==='true-B'?'Patient':'Observation',id:`target-${index}`,status:'final',code:{text:'synthetic norm'}};
  if(label.includes('meta'))target.meta={profile:[canonical('A')]};if(!unavailable)targets.set(ref,{...target,_mode:mode});
  const item:any={reference:ref};if(label==='unavailable-meta')item.meta={profile:[canonical('A')]};entries.push({item});
 }
 const resource={resourceType:'List',entry:entries};let elements=entries,source:any=resource;if(c.scope==='subset')elements=entries.slice(0,1);if(c.scope==='clone')elements=structuredClone(entries);if(c.scope==='no-source')source=undefined;
 const provider=async(url:string)=>{calls.profiles.push(url);const key=url.split('-').at(-1)!;const t=key==='A'?(Object.hasOwn(c,'aType')?c.aType:'Observation'):key==='B'?(Object.hasOwn(c,'bType')?c.bType:'Patient'):Object.hasOwn(c,'cType')?c.cType:'Observation';if(t===null)return null;const definitionUrl=key==='A'&&c.aDefinitionUrl?(c.aDefinitionUrl==='missing'?undefined:canonical('foreign')):url;return {resourceType:'StructureDefinition',url:definitionUrl,kind:'resource',status:'active',abstract:false,type:t,snapshot:{element:[{id:t,path:t,min:0,max:'*'}]}} as any;};
 const resolver=(ref:string)=>{calls.references.push(ref);return targets.get(ref)??null;};
 const conforms=async(target:any,url:string)=>{calls.conformance.push({id:target.id,profile:url});const key=url.split('-').at(-1)!;let verdict=c.verdicts[key];if(c.perTargetVerdicts&&target._mode==='false')verdict=false;return verdict==='unknown'?undefined:verdict;};
 const validator=new SlicingValidator({valueSetLoader:{loadValueSet:async()=>null}});validator.setTypeProfileResolver(provider);
 const issues=await validator.validateSlicing(elements,path,profile,resolver,path,'R4',source,path,c.callbackAbsent?undefined:conforms);
 const info=await extractSlicingInfo(path,profile,provider,{loadValueSet:async()=>null},path);
 const guard=(cardinality as any).hasAttestedUnconditionalGroup;const scope=typeof guard==='function'?guard({elements,slices:info!.slices,profile,definitionPath:path,elementPath:path,selectedSlicingElementId:(info as any).selectedSlicingElementId,rootResource:source}):false;
 const prepared=await (prepareValidatedProfileConformance as any)(elements,info!.slices,info!.slicing,provider,c.callbackAbsent?undefined:conforms,resolver,scope,'R4');const assignment=assignElementsToSlices(elements,prepared,info!.slicing,resolver);
 const indices=(map:Map<string,any[]>)=>[...map].map(([slice,values])=>({slice,indices:values.map(v=>v.index)}));
 return {issues,calls,scopeReceipt:scope,assignment:{known:indices(assignment.cardinalityMatches),matched:indices(assignment.sliceMatches),possible:indices(assignment.possibleCardinalityMatches),nonmembers:assignment.provedUnmatchedElements?.map(v=>v.index)??null,unresolvedReference:assignment.hasUnresolvedReferenceDiscriminator,unverifiedProfile:(assignment as any).hasUnverifiedProfileConformance??null},definition:profile,resource,physicalDuplicate:c.sequence.includes('same-object')&&entries[0]===entries[1]};
}

const cases: any[] = [
  {
    "name": "known false only",
    "sequence": [
      "false"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "closedCount": 1
  },
  {
    "name": "known false plus matching meta declaration",
    "sequence": [
      "false-meta"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "closedCount": 1
  },
  {
    "name": "known false beside unknown target",
    "sequence": [
      "false",
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "closedCount": 1,
    "incomplete": true
  },
  {
    "name": "known false meta contradiction beside unknown target",
    "sequence": [
      "false-meta",
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "closedCount": 1,
    "incomplete": true
  },
  {
    "name": "true A unknown B available target",
    "sequence": [
      "true-A"
    ],
    "verdicts": {
      "A": true,
      "B": "unknown"
    },
    "bType": "Observation",
    "closedCount": 0,
    "incomplete": true
  },
  {
    "name": "false A unknown B available target",
    "sequence": [
      "false"
    ],
    "verdicts": {
      "A": false,
      "B": "unknown"
    },
    "bType": "Observation",
    "closedCount": 0,
    "incomplete": true
  },
  {
    "name": "OR false plus unverified alternative",
    "sequence": [
      "false"
    ],
    "verdicts": {
      "A": false,
      "C": "unknown",
      "B": false
    },
    "aProfiles": [
      "A",
      "C"
    ],
    "cType": "Observation",
    "closedCount": 0,
    "incomplete": true
  },
  {
    "name": "OR false plus confirmed true alternative",
    "sequence": [
      "false"
    ],
    "verdicts": {
      "A": false,
      "C": true,
      "B": false
    },
    "aProfiles": [
      "A",
      "C"
    ],
    "cType": "Observation",
    "closedCount": 0
  },
  {
    "name": "OR false plus missing SD alternative",
    "sequence": [
      "false"
    ],
    "verdicts": {
      "A": false,
      "C": false,
      "B": false
    },
    "aProfiles": [
      "A",
      "C"
    ],
    "cType": null,
    "closedCount": 0,
    "incomplete": true
  },
  {
    "name": "all target SDs missing",
    "sequence": [
      "false"
    ],
    "verdicts": {
      "A": true,
      "B": true
    },
    "aType": null,
    "bType": null,
    "closedCount": 0,
    "incomplete": true
  },
  {
    "name": "no conformance callback unsupported",
    "sequence": [
      "false-meta"
    ],
    "verdicts": {},
    "callbackAbsent": true,
    "unchangedOutsideScope": true
  },
  {
    "name": "one unknown target",
    "sequence": [
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "closedCount": 0,
    "incomplete": true
  },
  {
    "name": "unknown reference with matching meta declaration",
    "sequence": [
      "unavailable-meta"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "closedCount": 0,
    "incomplete": true
  },
  {
    "name": "duplicate referent false plus unknown",
    "sequence": [
      "false",
      "duplicate",
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "closedCount": 2,
    "incomplete": true
  },
  {
    "name": "duplicate physical object occurrences false",
    "sequence": [
      "false",
      "same-object"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "closedCount": 2
  },
  {
    "name": "open known false beside unknown",
    "sequence": [
      "false",
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "rules": "open",
    "closedCount": 0,
    "incomplete": true,
    "openAdviceIndices": [
      0
    ]
  },
  {
    "name": "open meta false beside unknown",
    "sequence": [
      "false-meta",
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "rules": "open",
    "closedCount": 0,
    "incomplete": true,
    "openAdviceIndices": [
      0
    ]
  },
  {
    "name": "open only unknown",
    "sequence": [
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "rules": "open",
    "closedCount": 0,
    "incomplete": true,
    "openAdviceIndices": []
  },
  {
    "name": "openAtEnd known false before A",
    "sequence": [
      "false",
      "true-A",
      "unavailable"
    ],
    "verdicts": {
      "A": true,
      "B": false
    },
    "rules": "openAtEnd",
    "perTargetVerdicts": true,
    "orderingError": true,
    "incomplete": true
  },
  {
    "name": "openAtEnd unknown before A",
    "sequence": [
      "unavailable",
      "true-A"
    ],
    "verdicts": {
      "A": true,
      "B": false
    },
    "rules": "openAtEnd",
    "orderingError": false,
    "incomplete": true
  },
  {
    "name": "openAtEnd A unknown false tail",
    "sequence": [
      "true-A",
      "unavailable",
      "false"
    ],
    "verdicts": {
      "A": true,
      "B": false
    },
    "rules": "openAtEnd",
    "perTargetVerdicts": true,
    "orderingError": false,
    "incomplete": true
  },
  {
    "name": "ordered B then A",
    "sequence": [
      "true-B",
      "true-A"
    ],
    "verdicts": {
      "A": true,
      "B": true
    },
    "rules": "open",
    "ordered": true,
    "orderingError": true
  },
  {
    "name": "ordered A unknown B",
    "sequence": [
      "true-A",
      "unavailable",
      "true-B"
    ],
    "verdicts": {
      "A": true,
      "B": true
    },
    "rules": "open",
    "ordered": true,
    "orderingError": false,
    "incomplete": true
  },
  {
    "name": "tighter B min remains separate",
    "sequence": [
      "true-A",
      "unavailable"
    ],
    "verdicts": {
      "A": true,
      "B": false
    },
    "minB": 2,
    "noG2bMinimum": true,
    "incomplete": true
  },
  {
    "name": "conditional nested group unsupported",
    "sequence": [
      "false",
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "scope": "conditional",
    "unchangedOutsideScope": true
  },
  {
    "name": "caller subset unsupported",
    "sequence": [
      "false",
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "scope": "subset",
    "unchangedOutsideScope": true
  },
  {
    "name": "cloned array unsupported",
    "sequence": [
      "false",
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "scope": "clone",
    "unchangedOutsideScope": true
  },
  {
    "name": "rest after resolve unsupported",
    "sequence": [
      "false",
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "path": "item.resolve().status",
    "unchangedOutsideScope": true
  },
  {
    "name": "mixed discriminator AND unsupported",
    "sequence": [
      "false",
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "andDiscriminator": true,
    "unchangedOutsideScope": true
  },
  {
    "name": "missing source resource unsupported",
    "sequence": [
      "false",
      "unavailable"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "scope": "no-source",
    "unchangedOutsideScope": true
  },
  {
    "name": "unverified target matching meta cannot become positive proof",
    "sequence": [
      "unknown-meta",
      "unavailable"
    ],
    "verdicts": {
      "A": "unknown",
      "B": false
    },
    "unchangedOutsideScope": true
  },
  {
    "name": "duplicate slice labels remain opaque",
    "sequence": [
      "false"
    ],
    "verdicts": {
      "A": "unknown",
      "B": false
    },
    "duplicateSliceName": true,
    "unchangedOutsideScope": true
  },
  {
    "name": "malformed empty target SD type is unverified",
    "sequence": [
      "false"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "aType": "",
    "closedCount": 0,
    "incomplete": true
  },
  {
    "name": "unrecognized target SD type is unverified",
    "sequence": [
      "false"
    ],
    "verdicts": {
      "A": false,
      "B": false
    },
    "aType": "InventedResourceType",
    "closedCount": 0,
    "incomplete": true
  },
  {
    "name": "foreign target-definition URL remains unknown",
    "sequence": [
      "false",
      "unavailable"
    ],
    "aType": "Patient",
    "aDefinitionUrl": "foreign",
    "verdicts": {
      "A": false,
      "B": false
    },
    "closedCount": 0,
    "incomplete": true,
    "sourceContract": "Mismatch of concrete type is negative evidence only for the actual requested loaded definition. Legacy Boolean output remains unchanged; unknown cannot be converted to confirmed negative from unavailable canonical identity."
  },
  {
    "name": "missing target-definition URL remains unknown",
    "sequence": [
      "false",
      "unavailable"
    ],
    "aType": "Patient",
    "aDefinitionUrl": "missing",
    "verdicts": {
      "A": false,
      "B": false
    },
    "closedCount": 0,
    "incomplete": true,
    "sourceContract": "Mismatch of concrete type is negative evidence only for the actual requested loaded definition. Legacy Boolean output remains unchanged; unknown cannot be converted to confirmed negative from unavailable canonical identity."
  }
];

describe('Scoped confirmed profile nonmembers preserve unknown neighbors', () => {
  it.each(cases)('$name', async c => {
    const result = await run(c);
    const details = (issue: any): Record<string, unknown> => issue && typeof issue.details === 'object' && issue.details !== null ? issue.details : {};
    const closed = result.issues.find(issue => issue.code === 'profile-slice-closed-unmatched');
    if (c.closedCount !== undefined) {
      if (c.closedCount === 0) expect(closed).toBeUndefined();
      else expect(details(closed).count).toBe(c.closedCount);
    }
    if (c.incomplete !== undefined) expect(result.issues.some(issue => details(issue).validationComplete === false)).toBe(c.incomplete);
    if (c.orderingError !== undefined) expect(result.issues.some(issue => issue.code === 'profile-slice-ordering-violation')).toBe(c.orderingError);
    if (c.openAdviceIndices !== undefined) expect(result.issues.filter(issue => issue.code === 'profile-slice-open-unmatched')
      .map(issue => Number(issue.path?.match(/\[(\d+)\]$/)?.[1]))).toEqual(c.openAdviceIndices);
    if (c.noG2bMinimum) expect(result.issues.some(issue => issue.code === 'profile-slice-min-cardinality' && details(issue).sliceName === 'B')).toBe(false);
    if (c.unchangedOutsideScope) {
      if (c.andDiscriminator) expect(result.assignment.unverifiedProfile).toBeNull();
      else expect(result.assignment.nonmembers).toBeNull();
    }
    for (const index of result.assignment.nonmembers ?? []) {
      expect(result.assignment.known.some(slice => slice.indices.includes(index))).toBe(false);
      expect(result.assignment.matched.some(slice => slice.indices.includes(index))).toBe(false);
    }
  });
});
