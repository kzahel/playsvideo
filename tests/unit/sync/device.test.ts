import { describe, expect, it } from 'vitest';
import { generateDeviceLabel } from '../../../app/src/device.js';

describe('generateDeviceLabel', () => {
  it('returns a non-empty string', () => {
    const label = generateDeviceLabel();
    expect(label.length).toBeGreaterThan(0);
  });
});
