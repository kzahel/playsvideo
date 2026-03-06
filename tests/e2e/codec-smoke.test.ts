import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../fixtures');

/**
 * Codec test matrix. Each entry maps a fixture file to the MSE codec string
 * used to check MediaSource.isTypeSupported() in the browser.
 */
const CODEC_MATRIX = [
  {
    id: 'h264-baseline',
    file: 'codec-h264-baseline.mp4',
    mseType: 'video/mp4; codecs="avc1.42E01E"',
  },
  {
    id: 'h264-main',
    file: 'codec-h264-main.mp4',
    mseType: 'video/mp4; codecs="avc1.4D401E"',
  },
  {
    id: 'h264-high',
    file: 'codec-h264-high.mp4',
    mseType: 'video/mp4; codecs="avc1.640028"',
  },
  {
    id: 'hevc',
    file: 'codec-hevc.mp4',
    mseType: 'video/mp4; codecs="hev1.1.6.L93.B0"',
  },
  {
    id: 'vp9',
    file: 'codec-vp9.webm',
    mseType: 'video/mp4; codecs="vp09.00.10.08"',
  },
  {
    id: 'av1',
    file: 'codec-av1.mp4',
    mseType: 'video/mp4; codecs="av01.0.01M.08"',
  },
  {
    id: 'h264-ac3',
    file: 'codec-h264-ac3.mkv',
    mseType: 'video/mp4; codecs="avc1.640028"',
  },
  {
    id: 'h264-noaudio',
    file: 'codec-h264-noaudio.mp4',
    mseType: 'video/mp4; codecs="avc1.640028"',
  },
];

const PLAYBACK_WAIT_SEC = 5;

test.describe('codec smoke tests', () => {
  for (const { id, file, mseType } of CODEC_MATRIX) {
    const fixturePath = resolve(FIXTURES, file);

    test(`plays ${id}`, async ({ page }) => {
      test.setTimeout(60_000);

      if (!existsSync(fixturePath)) {
        test.skip(true, `Fixture not found: ${file} (run generate-codec-matrix.sh)`);
        return;
      }

      // Check if browser supports this codec in MSE
      const supported = await page.evaluate(
        (mime) => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime),
        mseType,
      );

      if (!supported) {
        test.skip(true, `Browser does not support ${mseType}`);
        return;
      }

      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => consoleErrors.push(err.message));

      await page.goto('/');
      // Wait for app JS to initialize before setting files
      await page.waitForLoadState('networkidle');
      await page.locator('#file-input').setInputFiles(fixturePath);

      // Wait for video element to become visible (MANIFEST_PARSED)
      const video = page.locator('#video');
      await video.waitFor({ state: 'visible', timeout: 30_000 });

      // Start playback
      await video.evaluate((el: HTMLVideoElement) => {
        el.play().catch(() => {});
      });

      // Wait for playback to start
      await expect(async () => {
        const t = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
        expect(t).toBeGreaterThan(0);
      }).toPass({ timeout: 15_000, intervals: [500] });

      // Observe for a few seconds
      await page.waitForTimeout(PLAYBACK_WAIT_SEC * 1_000);

      // Assertions
      const finalTime = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
      expect(finalTime).toBeGreaterThan(0.5);

      const videoError = await video.evaluate((el: HTMLVideoElement) => el.error);
      expect(videoError).toBeNull();

      const { videoWidth, videoHeight } = await video.evaluate((el: HTMLVideoElement) => ({
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight,
      }));
      expect(videoWidth).toBeGreaterThan(0);
      expect(videoHeight).toBeGreaterThan(0);

      const statusText = await page.locator('#status').textContent();
      expect(statusText).not.toContain('Error');

      expect(consoleErrors).toEqual([]);
    });
  }
});
