import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_FORMATS,
  FilePathSource,
  Input,
  type InputSubtitleTrack,
  type SubtitleCue,
  formatCuesToWebVTT,
} from 'mediabunny';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const BIGVIDEO = join(FIXTURES_DIR, 'bigvideo.mp4');
const hasBigVideo = existsSync(BIGVIDEO);
const describeIfBigVideo = hasBigVideo ? describe : describe.skip;

describeIfBigVideo('subtitle extraction', () => {
  let input: Input;

  it('finds the subtitle track', async () => {
    input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(BIGVIDEO) });

    const subtitleTracks = await input.getSubtitleTracks();
    expect(subtitleTracks.length).toBe(1);

    const track = subtitleTracks[0];
    expect(track.isSubtitleTrack()).toBe(true);
    expect(track.codec).toBe('tx3g');
    expect(track.languageCode).toBe('eng');
    console.log('Subtitle track:', {
      codec: track.codec,
      language: track.languageCode,
      name: track.name,
      id: track.id,
      number: track.number,
    });
  });

  it('extracts subtitle cues', async () => {
    const subtitleTracks = await input.getSubtitleTracks();
    const track = subtitleTracks[0];
    const cues: SubtitleCue[] = [];

    for await (const cue of track.getCues()) {
      cues.push(cue);
    }

    expect(cues.length).toBe(2735);
    console.log(`Extracted ${cues.length} subtitle cues`);

    // First few cues should have valid timing and text
    for (const cue of cues.slice(0, 5)) {
      expect(cue.timestamp).toBeGreaterThanOrEqual(0);
      expect(cue.duration).toBeGreaterThan(0);
      expect(cue.text.length).toBeGreaterThan(0);
    }

    // Log first 5 cues for inspection
    for (const cue of cues.slice(0, 5)) {
      console.log(
        `  [${formatTimestamp(cue.timestamp)} --> ${formatTimestamp(cue.timestamp + cue.duration)}] ${cue.text}`,
      );
    }

    // Cues should span most of the video duration (~93 min = ~5580s)
    const lastCue = cues[cues.length - 1];
    expect(lastCue.timestamp + lastCue.duration).toBeGreaterThan(5000);
  });

  it('exports to WebVTT text', async () => {
    const subtitleTracks = await input.getSubtitleTracks();
    const track = subtitleTracks[0];

    const webvtt = await track.exportToText('webvtt');
    expect(webvtt).toContain('WEBVTT');
    expect(webvtt).toContain('-->');

    // Should have content for all cues
    const arrowCount = (webvtt.match(/-->/g) || []).length;
    expect(arrowCount).toBe(2735);

    console.log('WebVTT output (first 500 chars):', webvtt.slice(0, 500));
  });

  it('converts cues to WebVTT via formatCuesToWebVTT', async () => {
    const subtitleTracks = await input.getSubtitleTracks();
    const track = subtitleTracks[0];
    const cues: SubtitleCue[] = [];

    for await (const cue of track.getCues()) {
      cues.push(cue);
    }

    const webvtt = formatCuesToWebVTT(cues);
    expect(webvtt).toContain('WEBVTT');
    expect(webvtt).toContain('-->');

    const arrowCount = (webvtt.match(/-->/g) || []).length;
    expect(arrowCount).toBe(cues.length);

    console.log('formatCuesToWebVTT output (first 500 chars):', webvtt.slice(0, 500));
  });

  it('also discovers subtitles via getTracks + isSubtitleTrack', async () => {
    const allTracks = await input.getTracks();
    const subtitleTracks = allTracks.filter((t) => t.isSubtitleTrack()) as InputSubtitleTrack[];
    expect(subtitleTracks.length).toBe(1);
    expect(subtitleTracks[0].codec).toBe('tx3g');

    // Cleanup
    input.dispose();
  });
});

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}
