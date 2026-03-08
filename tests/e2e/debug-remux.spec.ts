import { expect, test } from '@playwright/test';

const DEFAULT_VIDEO =
  '/Users/kgraehl/Downloads/JSTorrent/Z00topia.2.2025.1080p.hevc.x265.RMTeam.mkv';

test('debug player remuxes the local HEVC MKV without GOP timestamp regression', async ({ page }) => {
  const videoPath = process.env.PLAYSVIDEO_TEST_FILE || DEFAULT_VIDEO;
  const muxerError = /Timestamps cannot be smaller than the largest timestamp of the previous GOP/;

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (muxerError.test(text)) {
      consoleErrors.push(text);
    }
  });

  await page.goto('/debug');
  await page.locator('#file-input').setInputFiles(videoPath);

  const status = page.locator('#status');
  await expect(status).not.toHaveText(/Error:/, { timeout: 90_000 });
  await expect(status).toHaveText(/Ready/, { timeout: 90_000 });

  const logText = await page.locator('#log').innerText();
  expect(logText).not.toMatch(muxerError);
  expect(consoleErrors).toHaveLength(0);
});
