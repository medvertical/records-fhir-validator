// SNOMED CT Release File Specification, §6.4: SCTIDs use Verhoeff's D5 check.
const PRODUCTS = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;

const PERMUTATIONS = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;

export function hasInvalidSnomedCheckDigit(code: string): boolean {
  // Post-coordinated expressions need their own parser. A passing checksum
  // establishes neither concept existence nor membership in an edition.
  if (!/^[1-9][0-9]{5,17}$/.test(code)) return false;
  let checksum: number = 0;
  for (let index = 0; index < code.length; index++) {
    const digit = Number(code[code.length - index - 1]);
    checksum = PRODUCTS[checksum][PERMUTATIONS[index % 8][digit]];
  }
  return checksum !== 0;
}

export function invalidSnomedCodingIdentifierReason(
  code: string,
): 'snomed-check-digit' | 'snomed-component-kind' | 'snomed-partition' | undefined {
  if (!/^[1-9][0-9]{5,17}$/.test(code)) return undefined;
  if (hasInvalidSnomedCheckDigit(code)) return 'snomed-check-digit';
  const partition = code.slice(-3, -1);
  // RF2 §6.5 also assigns 16 to postcoordinated expressions. This check does
  // not establish assignment, expression semantics or edition membership.
  if (partition === '00' || partition === '10' || partition === '16') return undefined;
  if (['01', '02', '11', '12'].includes(partition)) return 'snomed-component-kind';
  return 'snomed-partition';
}
