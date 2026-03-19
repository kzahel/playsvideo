import { describe, expect, it } from 'vitest';
import { computeContentHash } from '../../../app/src/content-hash.js';

describe('computeContentHash', () => {
  it('produces a 40-char hex string (SHA-1)', async () => {
    const blob = new Blob(['hello world']);
    const hash = await computeContentHash(blob);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('is deterministic for the same content', async () => {
    const blob1 = new Blob(['test content 12345']);
    const blob2 = new Blob(['test content 12345']);
    expect(await computeContentHash(blob1)).toBe(await computeContentHash(blob2));
  });

  it('differs for different content', async () => {
    const a = await computeContentHash(new Blob(['aaa']));
    const b = await computeContentHash(new Blob(['bbb']));
    expect(a).not.toBe(b);
  });

  it('differs for same content but different sizes (padding test)', async () => {
    // Two blobs with same head bytes but different total sizes
    const small = new Blob(['x'.repeat(100)]);
    const large = new Blob(['x'.repeat(100) + 'y'.repeat(200)]);
    expect(await computeContentHash(small)).not.toBe(await computeContentHash(large));
  });

  it('handles blobs larger than chunk size (64KB)', async () => {
    const size = 200_000;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) data[i] = i % 256;
    const blob = new Blob([data]);
    const hash = await computeContentHash(blob);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('handles small blobs (< chunk size) without tail', async () => {
    const blob = new Blob(['tiny']);
    const hash = await computeContentHash(blob);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });
});
