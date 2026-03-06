import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../fixtures');

interface CodecEntry {
  id: string;
  file: string;
  /** MSE type string — null means expected-unsupported (no-crash test only) */
  mseType: string | null;
}

/**
 * Codec test matrix. mseType=null entries are tested for graceful error
 * handling only (no crash, no unhandled exceptions).
 */
const CODEC_MATRIX: CodecEntry[] = [
  // --- Video codecs (should play) ---
  {
    id: 'h264-baseline',
    file: 'codec-h264-baseline.mp4',
    mseType: 'video/mp4; codecs="avc1.42E01E"',
  },
  { id: 'h264-main', file: 'codec-h264-main.mp4', mseType: 'video/mp4; codecs="avc1.4D401E"' },
  { id: 'h264-high', file: 'codec-h264-high.mp4', mseType: 'video/mp4; codecs="avc1.640028"' },
  { id: 'hevc', file: 'codec-hevc.mp4', mseType: 'video/mp4; codecs="hev1.1.6.L93.B0"' },
  { id: 'vp9', file: 'codec-vp9.webm', mseType: 'video/mp4; codecs="vp09.00.10.08"' },
  { id: 'vp8', file: 'codec-vp8.webm', mseType: 'video/mp4; codecs="vp08.00.10.08"' },
  { id: 'av1', file: 'codec-av1.mp4', mseType: 'video/mp4; codecs="av01.0.01M.08"' },

  // --- Unsupported video codecs (no-crash) ---
  { id: 'mpeg4', file: 'codec-mpeg4.mp4', mseType: null },
  { id: 'mpeg2', file: 'codec-mpeg2.ts', mseType: null },
  { id: 'mpeg1', file: 'codec-mpeg1.mpg', mseType: null },

  // --- Containers (should play) ---
  { id: 'h264-mkv', file: 'codec-h264-mkv.mkv', mseType: 'video/mp4; codecs="avc1.640028"' },
  { id: 'h264-ts', file: 'codec-h264-ts.ts', mseType: 'video/mp4; codecs="avc1.640028"' },

  // --- Unsupported containers (no-crash) ---
  { id: 'h264-avi', file: 'codec-h264-avi.avi', mseType: null },
  { id: 'h264-flv', file: 'codec-h264-flv.flv', mseType: null },

  // --- Audio codec variations with H.264 video (should play) ---
  { id: 'h264-ac3', file: 'codec-h264-ac3.mkv', mseType: 'video/mp4; codecs="avc1.640028"' },
  { id: 'h264-eac3', file: 'codec-h264-eac3.mkv', mseType: 'video/mp4; codecs="avc1.640028"' },
  { id: 'h264-flac', file: 'codec-h264-flac.mkv', mseType: 'video/mp4; codecs="avc1.640028"' },
  { id: 'h264-opus', file: 'codec-h264-opus.mkv', mseType: 'video/mp4; codecs="avc1.640028"' },

  // --- Unsupported audio codec (no-crash) ---
  { id: 'h264-mp3', file: 'codec-h264-mp3.mkv', mseType: null },

  // --- Special: video-only (should play) ---
  {
    id: 'h264-noaudio',
    file: 'codec-h264-noaudio.mp4',
    mseType: 'video/mp4; codecs="avc1.640028"',
  },

  // --- Audio-only (no-crash — requires video track) ---
  { id: 'audio-aac', file: 'codec-audio-aac.m4a', mseType: null },
  { id: 'audio-mp3', file: 'codec-audio-mp3.mp3', mseType: null },
  { id: 'audio-opus', file: 'codec-audio-opus.ogg', mseType: null },
  { id: 'audio-flac', file: 'codec-audio-flac.flac', mseType: null },
];

const PLAYBACK_WAIT_SEC = 5;

test.describe('codec smoke tests', () => {
  for (const { id, file, mseType } of CODEC_MATRIX) {
    const fixturePath = resolve(FIXTURES, file);

    if (mseType === null) {
      // Expected-unsupported: verify app doesn't crash
      test(`handles unsupported ${id}`, async ({ page }) => {
        test.setTimeout(30_000);

        if (!existsSync(fixturePath)) {
          test.skip(true, `Fixture not found: ${file} (run generate-codec-matrix.sh)`);
          return;
        }

        const pageErrors: string[] = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        await page.goto('/player');
        await page.waitForLoadState('networkidle');
        await page.locator('#file-input').setInputFiles(fixturePath);

        // Give it time to process and show an error
        await page.waitForTimeout(5_000);

        // Should not have unhandled page errors (thrown exceptions)
        expect(pageErrors).toEqual([]);
      });
      continue;
    }

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

      await page.goto('/player');
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
