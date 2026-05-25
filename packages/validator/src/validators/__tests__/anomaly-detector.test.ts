import { describe, expect, it } from 'vitest';
import { AnomalyDetector } from '../anomaly-detector';

function makeTemperatureObservation(value: number, code: string, unit: string) {
  return {
    resourceType: 'Observation',
    id: `temp-${value}-${code}`,
    status: 'final',
    code: {
      coding: [{ system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' }],
    },
    subject: { reference: 'Patient/p1' },
    effectiveDateTime: '2024-06-15T10:00:00Z',
    valueQuantity: { value, system: 'http://unitsofmeasure.org', code, unit },
  };
}

describe('AnomalyDetector value range outliers', () => {
  it('does not apply Celsius temperature ranges to Fahrenheit values', () => {
    const detector = new AnomalyDetector({ minBatchSize: 1 });

    const findings = detector.detect([
      makeTemperatureObservation(101.2, '[degF]', '°F'),
    ]);

    expect(findings.filter(finding => finding.type === 'value-distribution-outlier')).toHaveLength(0);
  });

  it('still flags implausible Fahrenheit temperatures against Fahrenheit ranges', () => {
    const detector = new AnomalyDetector({ minBatchSize: 1 });

    const findings = detector.detect([
      makeTemperatureObservation(130, '[degF]', '°F'),
    ]);

    const rangeFindings = findings.filter(finding => finding.type === 'value-distribution-outlier');
    expect(rangeFindings).toHaveLength(1);
    expect(rangeFindings[0].suggestion).toContain('Expected range 77–113 [degF]');
  });
});

describe('AnomalyDetector temporal gaps', () => {
  function makeDatedObservation(id: string, effectiveDateTime: string) {
    return {
      ...makeTemperatureObservation(37, 'Cel', 'Cel'),
      id,
      effectiveDateTime,
    };
  }

  it('does not flag routine annual intervals as care gaps by default', () => {
    const detector = new AnomalyDetector({ minBatchSize: 1 });

    const findings = detector.detect([
      makeDatedObservation('annual-1', '2021-01-01T10:00:00Z'),
      makeDatedObservation('annual-2', '2022-01-07T10:00:00Z'),
      makeDatedObservation('annual-3', '2023-01-13T10:00:00Z'),
    ]);

    expect(findings.filter(finding => finding.type === 'temporal-gap')).toHaveLength(0);
  });

  it('still flags multi-year gaps by default', () => {
    const detector = new AnomalyDetector({ minBatchSize: 1 });

    const findings = detector.detect([
      makeDatedObservation('visit-1', '2021-01-01T10:00:00Z'),
      makeDatedObservation('visit-2', '2021-02-01T10:00:00Z'),
      makeDatedObservation('visit-3', '2024-03-01T10:00:00Z'),
    ]);

    expect(findings.filter(finding => finding.type === 'temporal-gap')).toHaveLength(1);
  });

  it('does not compare unrelated clinical codes as one care timeline', () => {
    const detector = new AnomalyDetector({ minBatchSize: 1 });

    const findings = detector.detect([
      {
        ...makeDatedObservation('systolic-old', '2021-01-01T10:00:00Z'),
        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
      },
      {
        ...makeDatedObservation('height-mid', '2022-01-01T10:00:00Z'),
        code: { coding: [{ system: 'http://loinc.org', code: '8302-2' }] },
      },
      {
        ...makeDatedObservation('temperature-new', '2024-03-01T10:00:00Z'),
        code: { coding: [{ system: 'http://loinc.org', code: '8310-5' }] },
      },
    ]);

    expect(findings.filter(finding => finding.type === 'temporal-gap')).toHaveLength(0);
  });
});
