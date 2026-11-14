/** IFA PZN: weighted modulo 11; a remainder of 10 cannot be assigned. */
export function hasInvalidPznCheckDigit(code: string): boolean {
  if (!/^[0-9]{7,8}$/.test(code)) return false;
  // Pre-2013 PZNs retain their check digit when padded with a leading zero.
  // A passing check does not establish assignment or catalog membership.
  const digits = code.padStart(8, '0');
  let sum = 0;
  for (let index = 0; index < 7; index++) {
    sum += Number(digits[index]) * (index + 1);
  }
  return sum % 11 !== Number(digits[7]);
}
