import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIGVIDEO_LINK = resolve(__dirname, '../fixtures/bigvideo.mp4');
const BIGVIDEO = existsSync(BIGVIDEO_LINK) ? realpathSync(BIGVIDEO_LINK) : BIGVIDEO_LINK;

const hasBigvideo = existsSync(BIGVIDEO_LINK);

test.describe('bigvideo smoke test', () => {
  test.skip(!hasBigvideo, 'tests/fixtures/bigvideo.mp4 not found (symlink missing)');

  test('plays bigvideo without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    await page.goto('/');

    // Pick the bigvideo file
    await page.locator('#file-input').setInputFiles(BIGVIDEO);

    // Wait for status to change from initial text (confirms change event fired)
    await expect(page.locator('#status')).not.toHaveText('Select a video file to play.', {
      timeout: 5_000,
    });

    // Wait for the video element to become visible (MANIFEST_PARSED sets display:block)
    const video = page.locator('#video');
    await video.waitFor({ state: 'visible', timeout: 60_000 });

    // Ensure playback starts
    await video.evaluate((el: HTMLVideoElement) => {
      el.play().catch(() => {});
    });

    // Wait for playback to start (currentTime > 0)
    await expect(async () => {
      const currentTime = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
      expect(currentTime).toBeGreaterThan(0);
    }).toPass({ timeout: 60_000, intervals: [1_000] });

    // Observe ~20 seconds of playback, sampling currentTime every second
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const currentTime = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
      samples.push(currentTime);
      console.log(`  [${i + 1}/20] currentTime = ${currentTime.toFixed(2)}s`);
      if (i < 19) {
        await page.waitForTimeout(1_000);
      }
    }

    // Assert playback advanced past 5 seconds
    const finalTime = samples[samples.length - 1];
    expect(finalTime).toBeGreaterThan(5);

    // Assert currentTime advanced (not stuck at one value)
    const uniqueTimes = new Set(samples.map((t) => Math.floor(t)));
    expect(uniqueTimes.size).toBeGreaterThan(1);

    // Assert no video error
    const videoError = await video.evaluate((el: HTMLVideoElement) => el.error);
    expect(videoError).toBeNull();

    // Assert video dimensions are set
    const { videoWidth, videoHeight } = await video.evaluate((el: HTMLVideoElement) => ({
      videoWidth: el.videoWidth,
      videoHeight: el.videoHeight,
    }));
    expect(videoWidth).toBeGreaterThan(0);
    expect(videoHeight).toBeGreaterThan(0);

    // Assert status does not contain "Error"
    const statusText = await page.locator('#status').textContent();
    expect(statusText).not.toContain('Error');

    // Assert no console.error calls were observed
    expect(consoleErrors).toEqual([]);
  });
});
