import { describe, expect, it } from 'vitest';
import { extractBalancedJson, normalizeGenerationDetails, parseDetailsLine } from '../a1111-text';

describe('parseDetailsLine', () => {
  it('splits comma-separated Key: value pairs and maps known keys', () => {
    expect(parseDetailsLine('Steps: 30, Sampler: Euler a, CFG scale: 7')).toEqual({
      steps: '30',
      sampler: 'Euler a',
      cfgScale: '7',
    });
  });

  it('keeps commas inside quoted values and recurses into nested key/value blocks', () => {
    const result = parseDetailsLine('Lora hashes: "a: 111, b: 222", Version: v1.9');
    expect(result['Lora hashes']).toEqual({ a: '111', b: '222' });
    expect(result.Version).toBe('v1.9');
  });

  it('keeps ISO timestamps as one value despite their internal colons', () => {
    const result = parseDetailsLine('Created Date: 2026-02-25T22:09:08.816Z, Steps: 40');
    // Known quirk, kept for parity with the civitai app: the colon that flips the
    // scanner into date mode is consumed, so the hour separator goes missing.
    expect(result['Created Date']).toBe('2026-02-25T2209:08.816Z');
    expect(result.steps).toBe('40');
  });

  it('returns an empty object for undefined input', () => {
    expect(parseDetailsLine(undefined)).toEqual({});
  });
});

describe('extractBalancedJson', () => {
  it('extracts a nested object and reports the full span including the prefix', () => {
    const line = 'Steps: 20, Meta: {"a": {"b": 2}}, Seed: 1';
    const result = extractBalancedJson(line, ', Meta: ');
    expect(result?.json).toBe('{"a": {"b": 2}}');
    expect(line.slice(0, result!.start) + line.slice(result!.end)).toBe('Steps: 20, Seed: 1');
  });

  it('ignores braces inside strings', () => {
    const result = extractBalancedJson('x, Meta: {"s": "}{"}', ', Meta: ');
    expect(result?.json).toBe('{"s": "}{"}');
  });

  it('returns null when the prefix is missing or the object never closes', () => {
    expect(extractBalancedJson('no json here', ', Meta: ')).toBeNull();
    expect(extractBalancedJson('x, Meta: {"open": 1', ', Meta: ')).toBeNull();
  });
});

describe('normalizeGenerationDetails', () => {
  it('leaves already-structured multi-line text untouched', () => {
    const structured = 'a prompt with steps: inside\nNegative prompt: bad\nSteps: 30, Seed: 1';
    expect(normalizeGenerationDetails(structured)).toBe(structured);
  });

  it('splits jammed single-line formats on real delimiters', () => {
    const jammed = 'a prompt.Negative prompt: bad.Steps: 4, Seed: 1';
    expect(normalizeGenerationDetails(jammed)).toBe(
      'a prompt\nNegative prompt: bad\nSteps: 4, Seed: 1'
    );
  });

  it('strips the "Parameters :" header some tools prepend', () => {
    expect(normalizeGenerationDetails('Parameters      : x\nSteps: 1')).toBe('x\nSteps: 1');
  });
});
