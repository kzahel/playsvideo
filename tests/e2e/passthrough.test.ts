import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../fixtures');

interface PassthroughCase {
  id: string;
  file: string;
  /** Whether we expect the engine to use passthrough (native playback) */
  expectPassthrough: boolean;
}

const CASES: PassthroughCase[] = [
  // MP4 with AAC — canPlayType returns "probably", should passthrough
  { id: 'mp4-aac', file: 'codec-h264-baseline.mp4', expectPassthrough: true },
  // MP4 with MP3 — canPlayType returns "probably" (native video/mp4 supports MP3)
  { id: 'mp4-mp3', file: 'passthrough-h264-mp3.mp4', expectPassthrough: true },
  // MP4 with AC3 — canPlayType rejects AC3 in Chromium, should use pipeline
  { id: 'mp4-ac3', file: 'passthrough-h264-ac3.mp4', expectPassthrough: false },
  // MKV with AC3 — canPlayType doesn't support matroska MIME, should use pipeline
  { id: 'mkv-ac3', file: 'codec-h264-ac3.mkv', expectPassthrough: false },
];

test.describe('passthrough mode detection', () => {
  for (const { id, file, expectPassthrough } of CASES) {
    const fixturePath = resolve(FIXTURES, file);

    test(`${id}: ${expectPassthrough === true ? 'passthrough' : expectPassthrough === false ? 'pipeline' : 'detect'}`, async ({
      page,
    }) => {
      test.setTimeout(60_000);

      if (!existsSync(fixturePath)) {
        test.skip(true, `Fixture not found: ${file}`);
        return;
      }

      // Capture engine log messages
      const engineLogs: string[] = [];
      const consoleErrors: string[] = [];

      page.on('console', (msg) => {
        const text = msg.text();
        if (text.startsWith('[engine]')) {
          engineLogs.push(text);
        }
        if (msg.type() === 'error') consoleErrors.push(text);
      });
      page.on('pageerror', (err) => consoleErrors.push(err.message));

      await page.goto('/player');
      await page.waitForLoadState('networkidle');
      await page.locator('#file-input').setInputFiles(fixturePath);

      // Wait for the video to become visible (ready state)
      const video = page.locator('#video');
      await video.waitFor({ state: 'visible', timeout: 30_000 });

      // Wait for playback to start
      await video.evaluate((el: HTMLVideoElement) => {
        el.play().catch(() => {});
      });
      await expect(async () => {
        const t = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
        expect(t).toBeGreaterThan(0);
      }).toPass({ timeout: 15_000, intervals: [500] });

      // Check the status text for mode
      const statusText = await page.locator('#status').textContent();

      // Determine which mode was actually used
      const isPassthrough = statusText?.includes('direct playback') ?? false;
      const isPipeline = statusText?.includes('segments') ?? false;

      // Log the result for diagnosis
      console.log(`[${id}] status: ${statusText}`);
      console.log(`[${id}] passthrough=${isPassthrough} pipeline=${isPipeline}`);
      console.log(
        `[${id}] engine logs:`,
        engineLogs.filter(
          (l) => l.includes('passthrough') || l.includes('pipeline') || l.includes('ready'),
        ),
      );

      if (expectPassthrough === true) {
        expect(isPassthrough).toBe(true);
      } else if (expectPassthrough === false) {
        expect(isPipeline).toBe(true);
      }
      // When expectPassthrough is null, we just log the result (discovery test for AC3)

      // Check if audio tracks are available (detects silent AC3 passthrough)
      const audioInfo = await video.evaluate((el: HTMLVideoElement) => ({
        // AudioTrack API (may not be available in all browsers)
        audioTrackCount: (el as any).audioTracks?.length ?? -1,
        // WebAudio-based check: is the video element producing audio?
        muted: el.muted,
        volume: el.volume,
        // If the browser decoded audio, duration should match
        duration: el.duration,
      }));
      console.log(
        `[${id}] audio: tracks=${audioInfo.audioTrackCount} muted=${audioInfo.muted} volume=${audioInfo.volume} duration=${audioInfo.duration}`,
      );

      // Video should not have errors
      const videoError = await video.evaluate((el: HTMLVideoElement) => el.error);
      expect(videoError).toBeNull();

      // No page errors
      expect(consoleErrors).toEqual([]);
    });
  }
});
