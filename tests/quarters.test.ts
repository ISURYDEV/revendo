import { describe, it, expect } from 'vitest';
import { quarterPeriod, quarterForDate, allQuartersFor } from '../electron/services/declarations/quarters';

describe('quarterPeriod', () => {
  it('Q1 = 01/01 → 31/03, échéance 30/04', () => {
    const p = quarterPeriod(2026, 1);
    expect(p.periodStart).toBe('2026-01-01');
    expect(p.periodEnd).toBe('2026-03-31');
    expect(p.dueDate).toBe('2026-04-30');
  });
  it('Q2 → échéance 31/07', () => {
    expect(quarterPeriod(2026, 2).dueDate).toBe('2026-07-31');
  });
  it('Q3 → échéance 31/10', () => {
    expect(quarterPeriod(2026, 3).dueDate).toBe('2026-10-31');
  });
  it('Q4 → échéance 31/01 N+1', () => {
    expect(quarterPeriod(2026, 4).dueDate).toBe('2027-01-31');
  });
});

describe('quarterForDate', () => {
  it.each([
    ['2026-01-15', 1],
    ['2026-03-31', 1],
    ['2026-04-01', 2],
    ['2026-06-30', 2],
    ['2026-07-01', 3],
    ['2026-09-30', 3],
    ['2026-10-01', 4],
    ['2026-12-31', 4]
  ])('%s → Q%d', (date, expected) => {
    expect(quarterForDate(date)).toBe(expected);
  });
});

describe('allQuartersFor', () => {
  it('returns 4 periods', () => {
    const qs = allQuartersFor(2026);
    expect(qs).toHaveLength(4);
    expect(qs.map((q) => q.quarter)).toEqual([1, 2, 3, 4]);
  });
});
