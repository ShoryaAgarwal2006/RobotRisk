import { describe, it, expect } from 'vitest';
import {
  deepStructuralEqual,
  strictOptionalFloatEq,
  strictOptionalPoint2Eq,
  strictOptionalPoint3Eq,
} from '../../state/snapshotUtils';

describe('Structural Equality & Strict Optional Comparison', () => {
  it('treats objects with reordered keys as strictly equal', () => {
    const objA = { x: 10, y: 20, z: 30 };
    const objB = { z: 30, x: 10, y: 20 };
    expect(deepStructuralEqual(objA, objB)).toBe(true);
  });

  it('detects nested reordered key equality', () => {
    const nestedA = { outer: { a: [1, 2], b: { inner1: true, inner2: 'yes' } } };
    const nestedB = { outer: { b: { inner2: 'yes', inner1: true }, a: [1, 2] } };
    expect(deepStructuralEqual(nestedA, nestedB)).toBe(true);
  });

  it('rejects undefined vs null in strictOptionalFloatEq', () => {
    expect(strictOptionalFloatEq(undefined, undefined)).toBe(true);
    expect(strictOptionalFloatEq(null as any, null as any)).toBe(true);
    expect(strictOptionalFloatEq(undefined, null as any)).toBe(false);
    expect(strictOptionalFloatEq(null as any, undefined)).toBe(false);
    expect(strictOptionalFloatEq(0, undefined)).toBe(false);
    expect(strictOptionalFloatEq(undefined, 0)).toBe(false);
    expect(strictOptionalFloatEq(0, null as any)).toBe(false);
  });

  it('handles floating point tolerances correctly', () => {
    expect(strictOptionalFloatEq(1.00001, 1.00002, 0.001)).toBe(true);
    expect(strictOptionalFloatEq(1.01, 1.05, 0.001)).toBe(false);
  });

  it('strictly validates point2 coordinates with optionality checks', () => {
    expect(strictOptionalPoint2Eq([1.0, 2.0], [1.0, 2.0])).toBe(true);
    expect(strictOptionalPoint2Eq(undefined, undefined)).toBe(true);
    expect(strictOptionalPoint2Eq([1.0, 2.0], undefined)).toBe(false);
    expect(strictOptionalPoint2Eq([1.0, 2.0], [1.0, 2.5])).toBe(false);
  });

  it('strictly validates point3 coordinates with optionality checks', () => {
    expect(strictOptionalPoint3Eq([1.0, 2.0, 3.0], [1.0, 2.0, 3.0])).toBe(true);
    expect(strictOptionalPoint3Eq(undefined, undefined)).toBe(true);
    expect(strictOptionalPoint3Eq([1.0, 2.0, 3.0], undefined)).toBe(false);
    expect(strictOptionalPoint3Eq([1.0, 2.0, 3.0], [1.0, 2.0, 3.5])).toBe(false);
  });
});
