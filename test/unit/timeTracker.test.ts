import { describe, it, expect } from 'vitest';
import { parseDuration } from '../../src/domain/timeTracker';

describe('parseDuration', () => {
  it.each([
    ['1h30m', 5400],
    ['90m', 5400],
    ['1.5h', 5400],
    ['2h', 7200],
    ['45m', 2700],
    ['5400', 5400],
    ['1h', 3600],
    ['0.25h', 900],
    ['30s', 30],
    ['1h30m15s', 5415],
  ])('parses %s to %d seconds', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', 'abc', '1h2x', '-5m'])('returns null for invalid %s', (bad) => {
    expect(parseDuration(bad)).toBeNull();
  });
});
