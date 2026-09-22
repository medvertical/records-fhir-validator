import { describe, it, expect } from 'vitest';
import { checkRangeBounds, isRangeBoundType } from '../range-bound-invariants';

const MG = { system: 'http://unitsofmeasure.org', code: 'mg', unit: 'mg' };

describe('checkRangeBounds', () => {
    it('reports an inverted Range that carries units', () => {
        const issue = checkRangeBounds(
            { low: { value: 10, ...MG }, high: { value: 2, ...MG } },
            'Observation.valueRange',
            'Range',
            'R4',
        );
        expect(issue?.severity).toBe('error');
        expect(issue?.details).toMatchObject({ constraintKey: 'rng-2', low: 10, high: 2 });
        expect(issue?.message).toContain('Observation.valueRange');
    });

    // fhirpath.js answers `low <= high` with true for two unit-less Quantities,
    // so this pair passed R4 validation before the substitute existed.
    it('reports an inverted Range without units', () => {
        const issue = checkRangeBounds(
            { low: { value: 10 }, high: { value: 2 } },
            'Observation.valueRange',
            'Range',
            'R4',
        );
        expect(issue?.details).toMatchObject({ constraintKey: 'rng-2' });
    });

    it('reports an inverted Range on R5, where the boundary expression cannot run', () => {
        const issue = checkRangeBounds(
            { low: { value: 10, ...MG }, high: { value: 2, ...MG } },
            'Observation.valueRange',
            'Range',
            'R5',
        );
        expect(issue?.severity).toBe('error');
    });

    it('reports an inverted RatioRange on its numerators', () => {
        const issue = checkRangeBounds(
            {
                lowNumerator: { value: 10, ...MG },
                highNumerator: { value: 2, ...MG },
                denominator: { value: 1, ...MG },
            },
            'Dosage.doseAndRate[0].doseRatioRange',
            'RatioRange',
            'R5',
        );
        expect(issue?.details).toMatchObject({ constraintKey: 'ratrng-2' });
        expect(issue?.message).toContain('RatioRange.lowNumerator');
    });

    it('accepts an ordered Range', () => {
        expect(checkRangeBounds(
            { low: { value: 2, ...MG }, high: { value: 10, ...MG } },
            'Observation.valueRange',
            'Range',
            'R5',
        )).toBeNull();
    });

    it('accepts equal bounds', () => {
        expect(checkRangeBounds(
            { low: { value: 5 }, high: { value: 5 } },
            'Observation.valueRange',
            'Range',
            'R4',
        )).toBeNull();
    });

    it('accepts a half-open Range', () => {
        expect(checkRangeBounds(
            { low: { value: 10, ...MG } },
            'Observation.valueRange',
            'Range',
            'R5',
        )).toBeNull();
    });

    // R5 restated rng-2 over precision boundaries: 1.5 and 1.4 still touch at
    // 1.45, so the pair is conformant there while R4 compares as written.
    it('separates the R4 and R5 readings of adjacent precision', () => {
        const adjacent = { low: { value: 1.5 }, high: { value: 1.4 } };
        expect(checkRangeBounds(adjacent, 'Observation.valueRange', 'Range', 'R5')).toBeNull();
        expect(checkRangeBounds(adjacent, 'Observation.valueRange', 'Range', 'R4')).not.toBeNull();
    });

    // fhirpath.js converts commensurable UCUM units before comparing, so the
    // substitute has to as well or R4 would lose a case it used to catch.
    it('converts commensurable UCUM units before ordering', () => {
        const backwards = {
            low: { value: 1, unit: 'g', system: 'http://unitsofmeasure.org', code: 'g' },
            high: { value: 100, ...MG },
        };
        expect(checkRangeBounds(backwards, 'Observation.valueRange', 'Range', 'R4')).not.toBeNull();
        expect(checkRangeBounds(backwards, 'Observation.valueRange', 'Range', 'R5')).not.toBeNull();

        const ordered = {
            low: { value: 1, unit: 'g', system: 'http://unitsofmeasure.org', code: 'g' },
            high: { value: 5000, ...MG },
        };
        expect(checkRangeBounds(ordered, 'Observation.valueRange', 'Range', 'R5')).toBeNull();
    });

    // `1 g` carries precision to the unit, so R5 reads it as [0.5 g, 1.5 g] —
    // which still meets `500 mg`. R4 compares the values as written and does not.
    it('applies the converted precision interval on R5 only', () => {
        const touching = {
            low: { value: 1, unit: 'g', system: 'http://unitsofmeasure.org', code: 'g' },
            high: { value: 500, ...MG },
        };
        expect(checkRangeBounds(touching, 'Observation.valueRange', 'Range', 'R5')).toBeNull();
        expect(checkRangeBounds(touching, 'Observation.valueRange', 'Range', 'R4')).not.toBeNull();
    });

    it('converts an affine unit pair', () => {
        expect(checkRangeBounds(
            {
                low: { value: 100, unit: '[degF]', system: 'http://unitsofmeasure.org', code: '[degF]' },
                high: { value: 10, unit: 'Cel', system: 'http://unitsofmeasure.org', code: 'Cel' },
            },
            'Observation.valueRange',
            'Range',
            'R5',
        )).not.toBeNull();
    });

    it('leaves an incommensurable pair alone', () => {
        expect(checkRangeBounds(
            { low: { value: 10, ...MG }, high: { value: 2, system: 'http://unitsofmeasure.org', code: 's', unit: 's' } },
            'Observation.valueRange',
            'Range',
            'R5',
        )).toBeNull();
    });

    it('orders a free-text unit pair only when the labels match', () => {
        expect(checkRangeBounds(
            { low: { value: 10, unit: 'drops' }, high: { value: 2, unit: 'drops' } },
            'Observation.valueRange',
            'Range',
            'R4',
        )).not.toBeNull();
        expect(checkRangeBounds(
            { low: { value: 10, unit: 'drops' }, high: { value: 2, unit: 'puffs' } },
            'Observation.valueRange',
            'Range',
            'R4',
        )).toBeNull();
    });

    it('leaves an open-ended bound alone', () => {
        expect(checkRangeBounds(
            { low: { value: 10, comparator: '>', ...MG }, high: { value: 2, ...MG } },
            'Observation.valueRange',
            'Range',
            'R5',
        )).toBeNull();
    });

    it('ignores a type that carries no ordered bounds', () => {
        expect(isRangeBoundType('Period')).toBe(false);
        expect(checkRangeBounds({ low: { value: 10 }, high: { value: 2 } }, 'x', 'Period', 'R4')).toBeNull();
    });
});
