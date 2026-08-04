import { describe, expect, it } from 'vitest';
import { magnetWithFileIndex } from '../../app/src/torrent-magnet.js';

describe('magnetWithFileIndex', () => {
  it('adds the selected file index', () => {
    expect(magnetWithFileIndex('magnet:?xt=urn:btih:abc', 4)).toContain('so=4');
  });

  it('replaces an existing selected file index', () => {
    const result = magnetWithFileIndex('magnet:?xt=urn:btih:abc&so=1', 8);
    expect(result).toContain('so=8');
    expect(result.match(/(?:\?|&)so=/g)).toHaveLength(1);
  });

  it('rejects non-magnet URLs', () => {
    expect(() => magnetWithFileIndex('https://example.com/file', 1)).toThrow(
      'Expected a magnet URL',
    );
  });
});
