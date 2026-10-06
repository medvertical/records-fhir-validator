import { promises as fs } from 'node:fs';
import { vi } from 'vitest';

/** Observe completed byte reads rather than making absence-of-open assertions vacuous. */
export function observePackageFileReads(): string[] {
  const paths: string[] = [];
  const readFile = fs.readFile.bind(fs);
  vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
    const result = await readFile(...args);
    const file = args[0];
    if (typeof file === 'string') paths.push(file);
    return result;
  });
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    const file = args[0];
    const read = handle.read.bind(handle);
    let recorded = false;
    vi.spyOn(handle, 'read').mockImplementation(async (...args) => {
      const result = await read(...args);
      if (result.bytesRead > 0 && !recorded) { paths.push(String(file)); recorded = true; }
      return result;
    });
    return handle;
  });
  return paths;
}
