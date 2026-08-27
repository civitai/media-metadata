import { describe, expect, it } from 'vitest';
import type { GenerationMetadata } from '../../../shared/schema';
import { jsonBlockDetailExtractor } from '../detail-extractors';

function run(line: string) {
  const metadata: GenerationMetadata = {};
  const rest = jsonBlockDetailExtractor(line, metadata);
  return { rest, metadata };
}

describe('jsonBlockDetailExtractor', () => {
  it('lifts object and array blocks out as raw strings, leaving plain pairs intact', () => {
    const { rest, metadata } = run(
      'Steps: 30, My resources: [{"id": 1}, {"id": 2}], Sampler: Euler, Tool state: {"a": {"b": 2}}'
    );
    expect(rest).toBe('Steps: 30, Sampler: Euler');
    expect(metadata['My resources']).toBe('[{"id": 1}, {"id": 2}]');
    expect(metadata['Tool state']).toBe('{"a": {"b": 2}}');
  });

  it('ignores brackets inside quoted values and inside JSON strings', () => {
    const { rest } = run('Wildcard prompt: "text with, X: {fake}", Steps: 30');
    expect(rest).toBe('Wildcard prompt: "text with, X: {fake}", Steps: 30');

    const { metadata } = run('Blob: {"s": "}]"}, Steps: 1');
    expect(metadata['Blob']).toBe('{"s": "}]"}');
  });

  it('leaves non-JSON bracketed text alone', () => {
    const { rest } = run('Steps: 30, Note: {not json at all}');
    expect(rest).toBe('Steps: 30, Note: {not json at all}');
  });

  it('removes but does not store blocks whose key collides with a typed schema field', () => {
    // a raw string under `resources` would fail the array schema and nuke the meta
    const { rest, metadata } = run('Steps: 30, resources: [{"x": 1}]');
    expect(rest).toBe('Steps: 30');
    expect(metadata.resources).toBeUndefined();
  });
});
