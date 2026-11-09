import { expect, it } from 'vitest';
import { resolvePeriod } from '@/storage/db';

it('a fixed period is used as saved', () => {
  expect(resolvePeriod({ kind: 'fixed', start: '2025-01-01', end: '2025-03-31' })).toEqual({ start: '2025-01-01', end: '2025-03-31' });
});

it('a rolling period ends today and starts N days earlier', () => {
  expect(resolvePeriod({ kind: 'last', days: 90 }, new Date('2026-11-07T12:00:00Z'))).toEqual({
    start: '2026-08-09',
    end: '2026-11-07',
  });
});
