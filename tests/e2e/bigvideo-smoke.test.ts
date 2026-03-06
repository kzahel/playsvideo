import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIGVIDEO_LINK = resolve(__dirname, '../fixtures/bigvideo.mp4');
const BIGVIDEO = existsSync(BIGVIDEO_LINK) ? realpathSync(BIGVIDEO_LINK) : BIGVIDEO_LINK;

const hasBigvideo = existsSync(BIGVIDEO_LINK);
const PLAYBACK_SECONDS = Number(process.env.SMOKE_DURATION) || 45;
const STALL_THRESHOLD_SEC = 3; // max seconds without time advancing before flagging stall

interface LogEntry {
  ts: number; // wall-clock ms since test start
  source: string; // 'worker' | 'main' | 'video' | 'page' | 'error'
  text: string;
}

interface VideoEvent {
  ts: number;
  event: string;
  time: number;
  readyState: number;
  buffered: number;
}

test.describe('bigvideo smoke test', () => {
  test.skip(!hasBigvideo, 'tests/fixtures/bigvideo.mp4 not found (symlink missing)');

  test('plays bigvideo without errors', async ({ page, context }) => {
    test.setTimeout(180_000); // 3 min: 60s startup + 45s playback + margin

    const testStart = Date.now();
    const logs: LogEntry[] = [];
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      const ts = Date.now() - testStart;

      if (msg.type() === 'error') {
        consoleErrors.push(text);
        logs.push({ ts, source: 'error', text });
      } else if (text.startsWith('[worker]')) {
        logs.push({ ts, source: 'worker', text: text.slice('[worker] '.length) });
      } else if (text.startsWith('[main]')) {
        logs.push({ ts, source: 'main', text: text.slice('[main] '.length) });
      } else if (text.startsWith('[video]')) {
        logs.push({ ts, source: 'video', text: text.slice('[video] '.length) });
      } else {
        logs.push({ ts, source: 'page', text });
      }
    });

    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
      logs.push({ ts: Date.now() - testStart, source: 'error', text: err.message });
    });

    // CDP session for CPU metrics (Performance.getMetrics)
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');

    async function getCpuTime(): Promise<{ taskDuration: number; jsHeapUsedMB: number }> {
      const { metrics } = await cdp.send('Performance.getMetrics');
      const get = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
      return {
        taskDuration: get('TaskDuration'),
        jsHeapUsedMB: Math.round((get('JSHeapUsedSize') / 1024 / 1024) * 10) / 10,
      };
    }

    const cpuBaseline = await getCpuTime();

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

    // Inject video event listeners to track DOM media events
    await video.evaluate((el: HTMLVideoElement) => {
      const events = [
        'waiting', 'playing', 'stalled', 'seeking', 'seeked',
        'pause', 'ended', 'error', 'canplay', 'canplaythrough',
      ];
      (window as any).__videoEvents = [];
      let lastTimeUpdate = 0;

      for (const name of events) {
        el.addEventListener(name, () => {
          (window as any).__videoEvents.push({
            ts: performance.now(),
            event: name,
            time: el.currentTime,
            readyState: el.readyState,
            buffered: el.buffered.length > 0 ? el.buffered.end(el.buffered.length - 1) : 0,
          });
          console.log(`[video] ${name} t=${el.currentTime.toFixed(2)} rs=${el.readyState} buf=${el.buffered.length > 0 ? el.buffered.end(el.buffered.length - 1).toFixed(1) : '0'}`);
        });
      }

      // Throttled timeupdate — only log every 2 seconds of media time
      el.addEventListener('timeupdate', () => {
        if (el.currentTime - lastTimeUpdate >= 2) {
          lastTimeUpdate = el.currentTime;
          (window as any).__videoEvents.push({
            ts: performance.now(),
            event: 'timeupdate',
            time: el.currentTime,
            readyState: el.readyState,
            buffered: el.buffered.length > 0 ? el.buffered.end(el.buffered.length - 1) : 0,
          });
          console.log(`[video] timeupdate t=${el.currentTime.toFixed(2)}`);
        }
      });
    });

    // Wait for playback to start (currentTime > 0)
    await expect(async () => {
      const currentTime = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
      expect(currentTime).toBeGreaterThan(0);
    }).toPass({ timeout: 60_000, intervals: [1_000] });

    const samples: {
      time: number;
      buffered: number;
      paused: boolean;
      readyState: number;
      cpuSec: number;
      heapMB: number;
    }[] = [];
    const stalls: { at: number; from: number; to: number; durationSec: number }[] = [];

    for (let i = 0; i < PLAYBACK_SECONDS; i++) {
      const [snap, cpu] = await Promise.all([
        video.evaluate((el: HTMLVideoElement) => ({
          time: el.currentTime,
          buffered: el.buffered.length > 0 ? el.buffered.end(el.buffered.length - 1) : 0,
          paused: el.paused,
          readyState: el.readyState,
        })),
        getCpuTime(),
      ]);
      const cpuSec = Math.round((cpu.taskDuration - cpuBaseline.taskDuration) * 100) / 100;
      const cpuDelta =
        i > 0 ? Math.round((cpuSec - samples[i - 1].cpuSec) * 100) / 100 : cpuSec;
      samples.push({ ...snap, cpuSec, heapMB: cpu.jsHeapUsedMB });

      const prevTime = i > 0 ? samples[i - 1].time : snap.time;
      const delta = snap.time - prevTime;
      const stallFlag = i > 0 && delta < 0.1 ? ' ** STALL **' : '';
      const cpuHot = cpuDelta > 0.5 ? ' ** CPU HOT **' : '';

      console.log(
        `  [${i + 1}/${PLAYBACK_SECONDS}] time=${snap.time.toFixed(2)}s  buf=${snap.buffered.toFixed(1)}s  cpu=${cpuSec.toFixed(2)}s(+${cpuDelta.toFixed(2)})  heap=${cpu.jsHeapUsedMB}MB  rs=${snap.readyState}${stallFlag}${cpuHot}`,
      );

      // Detect stalls (time not advancing)
      if (i > 0 && delta < 0.1) {
        const lastStall = stalls.length > 0 ? stalls[stalls.length - 1] : null;
        if (lastStall && lastStall.to === i - 1) {
          // Extend existing stall
          lastStall.to = i;
          lastStall.durationSec = lastStall.to - lastStall.from + 1;
        } else {
          stalls.push({ at: i, from: i, to: i, durationSec: 1 });
        }
      }

      if (i < PLAYBACK_SECONDS - 1) {
        await page.waitForTimeout(1_000);
      }
    }

    // CPU summary
    const finalCpu = samples[samples.length - 1].cpuSec;
    const avgCpuPerSec = Math.round((finalCpu / PLAYBACK_SECONDS) * 100) / 100;
    const peakHeap = Math.max(...samples.map((s) => s.heapMB));
    console.log(
      `  CPU: total=${finalCpu.toFixed(2)}s over ${PLAYBACK_SECONDS}s wall (${(avgCpuPerSec * 100).toFixed(0)}% avg)  peakHeap=${peakHeap}MB`,
    );

    // Report stalls
    if (stalls.length > 0) {
      console.log(`  STALLS DETECTED: ${stalls.length}`);
      for (const s of stalls) {
        console.log(
          `    Stall at sample ${s.from}-${s.to} (${s.durationSec}s), time=${samples[s.from].time.toFixed(2)}s`,
        );
      }
    }

    // Retrieve video events accumulated in the page
    const pageVideoEvents = await video.evaluate(() => {
      return (window as any).__videoEvents as VideoEvent[];
    });

    // --- Timeline Summary ---
    console.log('\n  === TIMELINE SUMMARY ===');

    const workerLogs = logs.filter((l) => l.source === 'worker');
    console.log(`\n  Worker activity (${workerLogs.length} messages):`);
    for (const l of workerLogs) {
      console.log(`    +${(l.ts / 1000).toFixed(1)}s  ${l.text}`);
    }

    const mainLogs = logs.filter((l) => l.source === 'main');
    console.log(`\n  Main thread (${mainLogs.length} messages):`);
    for (const l of mainLogs) {
      console.log(`    +${(l.ts / 1000).toFixed(1)}s  ${l.text}`);
    }

    console.log(`\n  Video events (${pageVideoEvents.length}):`);
    for (const e of pageVideoEvents) {
      if (e.event !== 'timeupdate') {
        console.log(
          `    ${e.event} at media t=${e.time.toFixed(2)} rs=${e.readyState} buf=${e.buffered.toFixed(1)}`,
        );
      }
    }

    const warnLogs = logs.filter((l) => l.text.startsWith('WARN'));
    if (warnLogs.length > 0) {
      console.log(`\n  WARNINGS (${warnLogs.length}):`);
      for (const l of warnLogs) {
        console.log(`    +${(l.ts / 1000).toFixed(1)}s  [${l.source}] ${l.text}`);
      }
    }

    if (consoleErrors.length > 0) {
      console.log(`\n  ERRORS (${consoleErrors.length}):`);
      for (const e of consoleErrors) {
        console.log(`    ${e}`);
      }
    }

    console.log('  === END TIMELINE ===\n');

    // Assert: no stall longer than threshold
    const longStalls = stalls.filter((s) => s.durationSec >= STALL_THRESHOLD_SEC);
    expect(longStalls, `Found ${longStalls.length} stalls >= ${STALL_THRESHOLD_SEC}s`).toHaveLength(
      0,
    );

    // Assert playback advanced
    const finalTime = samples[samples.length - 1].time;
    expect(finalTime).toBeGreaterThan(5);

    // Assert currentTime advanced (not stuck at one value)
    const uniqueTimes = new Set(samples.map((s) => Math.floor(s.time)));
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

    // Assert: no duplicate segment requests (race detection)
    const duplicateWarns = logs.filter(
      (l) => l.source === 'main' && l.text.startsWith('WARN duplicate'),
    );
    expect(
      duplicateWarns,
      `Race detected: ${duplicateWarns.length} duplicate segment requests`,
    ).toHaveLength(0);

    // Assert: no video 'error' events
    const errorEvents = pageVideoEvents.filter((e) => e.event === 'error');
    expect(errorEvents, 'Video error events detected').toHaveLength(0);

    // Assert: no unrecoverable stalled events (stalled without 'playing' within 5s, after initial buffer)
    const stalledEvents = pageVideoEvents.filter((e) => e.event === 'stalled');
    const playingEvents = pageVideoEvents.filter((e) => e.event === 'playing');
    const unresolvedStalls = stalledEvents.filter((stall) => {
      const recovery = playingEvents.find(
        (p) => p.ts > stall.ts && p.ts - stall.ts < 5000,
      );
      return !recovery;
    });
    if (unresolvedStalls.length > 0) {
      console.log(`  WARN: ${unresolvedStalls.length} stalled events without recovery within 5s`);
    }
    const lateUnresolvedStalls = unresolvedStalls.filter((s) => s.time > 2);
    expect(
      lateUnresolvedStalls,
      `${lateUnresolvedStalls.length} unrecoverable stall events after initial buffer`,
    ).toHaveLength(0);

    // Final summary
    console.log(
      `  Summary: ${PLAYBACK_SECONDS}s observed, final time=${finalTime.toFixed(2)}s, ` +
        `stalls=${stalls.length}, errors=${consoleErrors.length}, ` +
        `worker-msgs=${workerLogs.length}, main-msgs=${mainLogs.length}, ` +
        `video-events=${pageVideoEvents.length}, warnings=${warnLogs.length}`,
    );
  });
});
