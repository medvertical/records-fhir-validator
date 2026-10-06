import { beforeAll, describe, it, expect } from 'vitest';
import { createFilesystemProfileSource } from '../filesystem-profile-source.js';

export function registerFilesystemProfileSourceContracts(label: string, packageDirs: () => string[]): void {
  describe(label, () => {
      let source: ReturnType<typeof createFilesystemProfileSource>;
      beforeAll(() => { source = createFilesystemProfileSource({ packageDirs: packageDirs() }); });

      it('exposes only findByUrl (not resolveProfile or warmupRecent)', () => {
          expect(source.findByUrl).toBeTypeOf('function');
          expect(source.resolveProfile).toBeUndefined();
          expect(source.loadAllForWarmup).toBeUndefined();
          expect(source.warmupRecent).toBeUndefined();
      });

      it('resolves a core R4 StructureDefinition from the bundled directory', async () => {
          const sd = await source.findByUrl!(
              'http://hl7.org/fhir/StructureDefinition/Patient',
              'R4',
          );
          expect(sd).not.toBeNull();
          expect(sd?.resourceType).toBe('StructureDefinition');
          expect(sd?.url).toBe('http://hl7.org/fhir/StructureDefinition/Patient');
      });

      it('returns null for an unknown profile URL', async () => {
          const sd = await source.findByUrl!(
              'http://example.com/StructureDefinition/Nonexistent',
              'R4',
          );
          expect(sd).toBeNull();
      });
  });

}
