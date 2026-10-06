import { promises as fs, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';
import { ValueSetPackageLoader } from '../valueset-package-loader.js';
import { ValueSetCache } from '../valueset-cache.js';
import { clearPackageCanonicalIndex } from '../valueset-package-search.js';
const fixture=new URL('./fixtures/fhir-publication-context/',import.meta.url);
const roots:string[]=[];
const digest=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
const read=(release:string,kind:string)=>readFileSync(new URL(`device-${release}-${kind}.json`,fixture),'utf8');
async function harness(release:'r4'|'r5',route:'named'|'declared'|'scan') {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'records-publication-read-epoch-'));roots.push(root);
 const version=release==='r4'?'4.0.1':'5.0.0';const directory=path.join(root,`hl7.fhir.${release}.core#${version}`,'package');await fs.mkdir(directory,{recursive:true});
 const filename=route==='scan'?'ValueSet-unconventional-device.json':'ValueSet-device-nametype.json';
 await fs.writeFile(path.join(directory,filename),read(release,'valueset'));
 const manifestPath=path.join(directory,'package.json');const originalManifest=read(release,'manifest');await fs.writeFile(manifestPath,originalManifest);
 if (route==='declared') await fs.writeFile(path.join(directory,'.index.json'),JSON.stringify({files:[{filename,resourceType:'ValueSet',url:'http://hl7.org/fhir/ValueSet/device-nametype',version}]}));
 const access=new ValueSetPackageResourceAccess([root]);const loader=new ValueSetPackageLoader(new ValueSetCache(),access);
 const valueSet=route==='scan'?await access.findByCanonicalScan('http://hl7.org/fhir/ValueSet/device-nametype','ValueSet',undefined,version):await loader.loadValueSetResource(`http://hl7.org/fhir/ValueSet/device-nametype|${version}`);
 expect(valueSet).not.toBeNull();return {access,loader,valueSet:valueSet!,manifestPath,originalManifest,version};
}
afterEach(async()=>{clearPackageCanonicalIndex();await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
describe('cached ValueSet publication belongs to its actual read epoch',()=>{
 it.each((['r4','r5'] as const).flatMap(release=>(['named','declared','scan'] as const).flatMap(route=>[false,true].map(priorGet=>({release,route,priorGet})))))('$release $route changed manifest after prior attestation $priorGet',async ({release,route,priorGet})=>{
  const h=await harness(release,route);const original=release==='r4'?'R4':'R5';const other=release==='r4'?'5.0.0':'4.0.1';
  if(priorGet) expect((await h.access.getPublicationContext(h.valueSet))?.fhirVersion).toBe(original);
  const changed={...JSON.parse(h.originalManifest),fhirVersions:[other]};await fs.writeFile(h.manifestPath,JSON.stringify(changed));
  const origin=await h.access.getPublicationContext(h.valueSet);
  expect(origin?.fhirVersion).toBeUndefined();
  expect(origin?.packageManifestSha256).toBe(digest(h.originalManifest));
  await fs.writeFile(h.manifestPath,h.originalManifest);
  expect((await h.access.getPublicationContext(h.valueSet))?.fhirVersion).toBe(original);
 });
 it.each(['r4','r5'] as const)('%s must not upgrade absent original metadata using a new manifest',async release=>{
  const h=await harness(release,'named');await fs.rm(h.manifestPath);
  // A cold read after absence is a new object; restore metadata only afterwards.
  const cold=await h.access.findInPackages('http://hl7.org/fhir/ValueSet/device-nametype',['ValueSet-device-nametype.json'],undefined,h.version);
  await fs.writeFile(h.manifestPath,h.originalManifest);
  const origin=await h.access.getPublicationContext(cold!);expect(origin?.fhirVersion).toBeUndefined();expect(origin?.packageManifestSha256).toBeUndefined();
 });
 it.each(['r4','r5'] as const)('%s retains source SHA separately from malformed replacement',async release=>{
  const h=await harness(release,'named');await fs.writeFile(h.manifestPath,'{');
  const origin=await h.access.getPublicationContext(h.valueSet);expect(origin?.fhirVersion).toBeUndefined();expect(origin?.packageManifestSha256).toBe(digest(h.originalManifest));
 });
 it('does not let a returned declaration array mutate the origin of a later get',async()=>{
  const h=await harness('r4','named');const first=(await h.access.getPublicationContext(h.valueSet))!;first.declaredFhirVersions[0]='5.0.0';
  expect((await h.access.getPublicationContext(h.valueSet))?.declaredFhirVersions).toEqual(['4.0.1']);
 });
});
