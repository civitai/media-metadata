import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBytes } from '../exif';

/**
 * Pins that `toBytes` omits credentials when it fetches a URL input.
 *
 * Why this is a security guard and not a style preference: a caller can hand
 * `toBytes` a URL it did not author (image metadata is attacker-writable in at
 * least one consumer), and this function READS THE RESPONSE BODY and returns it.
 * Under the browser default of `credentials: 'same-origin'`, a metadata URL
 * naming the consumer's own origin therefore became a cookie-bearing,
 * body-readable GET in the victim's session. Omitting credentials is what stops
 * that; nothing this library fetches is cookie-authenticated.
 *
 * The assertion is on the REQUEST OPTIONS rather than on any parse result, so it
 * fails if the option is dropped even when the fetch itself still succeeds.
 */
const fetchMock = vi.fn();

describe('toBytes — URL fetch credentials', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // Body contents are irrelevant; `ok: true` only gets past the res.ok check
    // so the call itself is observable.
    fetchMock.mockImplementation(
      async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches a URL input with credentials: 'omit'", async () => {
    await toBytes('https://example.invalid/some-image.png');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    // Explicitly not `toBeTruthy()` / `toBeDefined()`: 'include' and
    // 'same-origin' would both satisfy those and both send cookies.
    expect(options?.credentials).toBe('omit');
  });

  it('still returns the fetched bytes', async () => {
    const bytes = await toBytes('https://example.invalid/some-image.png');

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it('does not fetch for non-URL inputs', async () => {
    await toBytes(new Uint8Array([9, 9]));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
