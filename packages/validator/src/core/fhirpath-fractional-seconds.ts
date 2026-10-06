import { createRequire } from 'module';

type TimePartsFn = (this: unknown, timeMatchData: unknown) => string[];

interface FhirPathTimeBasePrototype {
  _getTimeParts?: TimePartsFn;
  recordsFractionalSecondsFix?: true;
}

const require = createRequire(import.meta.url);

/**
 * fhirpath.js 4.11 reads the fractional seconds of a dateTime, instant or
 * time as whole milliseconds: `02:13:58.566000` becomes 566 000 ms, about
 * nine minutes later than written, so `lastModified >= authoredOn` fails for
 * microsecond timestamps the reference validator accepts. FHIR allows any
 * number of fractional digits and FHIRPath compares at millisecond
 * precision, so digits beyond the third are truncated before fhirpath.js
 * builds its Date.
 */
export function installFhirPathFractionalSecondsFix(): void {
  const types = require('fhirpath/src/types.js') as {
    FP_TimeBase?: { prototype: FhirPathTimeBasePrototype };
  };
  const prototype = types.FP_TimeBase?.prototype;
  const original = prototype?._getTimeParts;
  if (!prototype || typeof original !== 'function' || prototype.recordsFractionalSecondsFix) return;

  prototype._getTimeParts = function truncatedFractionTimeParts(this: unknown, timeMatchData: unknown) {
    const parts = original.call(this, timeMatchData);
    const fraction = parts[3];
    if (typeof fraction === 'string' && fraction.length > 4) {
      parts[3] = fraction.slice(0, 4);
    }
    return parts;
  };
  prototype.recordsFractionalSecondsFix = true;
}
