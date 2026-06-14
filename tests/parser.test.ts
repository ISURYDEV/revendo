import { describe, it, expect } from 'vitest';
import { parseFrenchNumber, parseFrenchDate } from '../electron/services/csv/parser';

describe('parseFrenchNumber', () => {
  it('handles French decimal comma', () => {
    expect(parseFrenchNumber('11,6')).toBe(11.6);
    expect(parseFrenchNumber('1234,56')).toBe(1234.56);
  });
  it('handles dot decimal', () => {
    expect(parseFrenchNumber('11.60')).toBe(11.6);
  });
  it('handles thousand separator', () => {
    expect(parseFrenchNumber('1.234,56')).toBe(1234.56);
  });
  it('strips euro symbol and spaces', () => {
    expect(parseFrenchNumber('€ 12,50')).toBe(12.5);
    expect(parseFrenchNumber('12,50 €')).toBe(12.5);
  });
  it('returns null for empty/invalid', () => {
    expect(parseFrenchNumber('')).toBeNull();
    expect(parseFrenchNumber(null)).toBeNull();
    expect(parseFrenchNumber('abc')).toBeNull();
    expect(parseFrenchNumber('-')).toBeNull();
  });
  it('handles negative numbers', () => {
    expect(parseFrenchNumber('-7')).toBe(-7);
    expect(parseFrenchNumber('-12,50')).toBe(-12.5);
  });
});

describe('parseFrenchDate', () => {
  it('parses Vinteer ISO datetime', () => {
    expect(parseFrenchDate('2026-03-24 07:44:14')).toBe('2026-03-24T07:44:14.000Z');
  });
  it('parses date only', () => {
    expect(parseFrenchDate('2026-03-24')).toBe('2026-03-24T00:00:00.000Z');
  });
  it('parses dd/mm/yyyy', () => {
    expect(parseFrenchDate('24/03/2026')).toBe('2026-03-24T00:00:00.000Z');
  });
  it('parses WhatNot UTC suffix', () => {
    expect(parseFrenchDate('2026-05-21 17:29 (UTC)')).toBe('2026-05-21T17:29:00.000Z');
  });
  it('returns null on invalid', () => {
    expect(parseFrenchDate('')).toBeNull();
    expect(parseFrenchDate(null)).toBeNull();
  });
});
