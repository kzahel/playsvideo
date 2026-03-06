import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_FORMATS, FilePathSource, Input, type SubtitleCue } from 'mediabunny';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const BIGVIDEO = join(FIXTURES_DIR, 'bigvideo.mp4');
const hasBigVideo = existsSync(BIGVIDEO);
const describeIfBigVideo = hasBigVideo ? describe : describe.skip;

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

describeIfBigVideo('subtitle deep inspection', () => {
  let input: Input;
  let allCues: SubtitleCue[];

  it('extracts all cues for inspection', async () => {
    input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(BIGVIDEO) });

    const subtitleTracks = await input.getSubtitleTracks();
    expect(subtitleTracks.length).toBeGreaterThan(0);

    const track = subtitleTracks[0];
    console.log('\n=== TRACK METADATA ===');
    console.log('  codec:', track.codec);
    console.log('  language:', track.languageCode);
    console.log('  name:', track.name);
    console.log('  id:', track.id);
    console.log('  number:', track.number);

    // Check for codecPrivate data via the backing
    const codecPrivate = (track as any)._backing?.getCodecPrivate?.();
    if (codecPrivate) {
      console.log('\n=== CODEC PRIVATE / SubtitleConfig ===');
      console.log('  length:', codecPrivate.length, 'chars');
      console.log('  content (first 500 chars):', codecPrivate.slice(0, 500));
      if (codecPrivate.length > 500) {
        console.log('  ... (truncated, total', codecPrivate.length, 'chars)');
      }
    } else {
      console.log('\n=== CODEC PRIVATE: (none) ===');
    }

    // Collect all cues
    allCues = [];
    for await (const cue of track.getCues()) {
      allCues.push(cue);
    }

    console.log('\n=== TOTAL CUES:', allCues.length, '===');
    expect(allCues.length).toBeGreaterThan(0);
  });

  it('reports detailed cue statistics', () => {
    // Empty/whitespace vs real text
    const emptyCues = allCues.filter((c) => c.text.trim().length === 0);
    const realTextCues = allCues.filter((c) => c.text.trim().length > 0);

    console.log('\n=== TEXT CONTENT STATS ===');
    console.log('  Cues with real text:', realTextCues.length);
    console.log('  Cues with empty/whitespace text:', emptyCues.length);

    // Settings field
    const withSettings = allCues.filter((c) => c.settings && c.settings.trim().length > 0);
    console.log('\n=== OPTIONAL FIELDS ===');
    console.log('  Cues with settings (VTT positioning):', withSettings.length);
    if (withSettings.length > 0) {
      console.log(
        '    Examples:',
        withSettings.slice(0, 3).map((c) => c.settings),
      );
    }

    // Identifier field
    const withIdentifier = allCues.filter((c) => c.identifier && c.identifier.trim().length > 0);
    console.log('  Cues with identifier:', withIdentifier.length);
    if (withIdentifier.length > 0) {
      console.log(
        '    Examples:',
        withIdentifier.slice(0, 3).map((c) => c.identifier),
      );
    }

    // Notes field
    const withNotes = allCues.filter((c) => c.notes && c.notes.trim().length > 0);
    console.log('  Cues with notes:', withNotes.length);
    if (withNotes.length > 0) {
      console.log(
        '    Examples:',
        withNotes.slice(0, 3).map((c) => c.notes),
      );
    }

    // Duration stats
    const durations = allCues.map((c) => c.duration);
    const minDur = Math.min(...durations);
    const maxDur = Math.max(...durations);
    const avgDur = durations.reduce((a, b) => a + b, 0) / durations.length;

    console.log('\n=== DURATION STATS ===');
    console.log('  Min duration:', minDur.toFixed(3), 's');
    console.log('  Max duration:', maxDur.toFixed(3), 's');
    console.log('  Average duration:', avgDur.toFixed(3), 's');

    // Find shortest and longest cues
    const shortestIdx = durations.indexOf(minDur);
    const longestIdx = durations.indexOf(maxDur);
    console.log('  Shortest cue text:', JSON.stringify(allCues[shortestIdx].text.slice(0, 80)));
    console.log('  Longest cue text:', JSON.stringify(allCues[longestIdx].text.slice(0, 80)));

    // Overlapping cues
    let overlapCount = 0;
    const overlapExamples: string[] = [];
    for (let i = 0; i < allCues.length; i++) {
      const a = allCues[i];
      const aEnd = a.timestamp + a.duration;
      for (let j = i + 1; j < allCues.length; j++) {
        const b = allCues[j];
        // b starts after a ends => no overlap with a from here on (assuming sorted)
        if (b.timestamp >= aEnd) break;
        // overlap
        overlapCount++;
        if (overlapExamples.length < 5) {
          overlapExamples.push(
            `  Cue ${i} [${formatTimestamp(a.timestamp)}-${formatTimestamp(aEnd)}] overlaps ` +
              `Cue ${j} [${formatTimestamp(b.timestamp)}-${formatTimestamp(b.timestamp + b.duration)}]`,
          );
        }
      }
    }

    console.log('\n=== OVERLAP ANALYSIS ===');
    console.log('  Overlapping cue pairs:', overlapCount);
    if (overlapExamples.length > 0) {
      console.log('  Examples:');
      for (const ex of overlapExamples) {
        console.log(ex);
      }
    }

    expect(realTextCues.length).toBeGreaterThan(0);
  });

  it('analyzes SDH/accessibility indicators', () => {
    console.log('\n=== SDH / ACCESSIBILITY ANALYSIS ===');

    // Bracketed text like [horse snorts], [softly]
    const bracketPattern = /\[([^\]]+)\]/;
    const withBrackets = allCues.filter((c) => bracketPattern.test(c.text));
    console.log('\n  Cues with [bracketed] text:', withBrackets.length);
    if (withBrackets.length > 0) {
      console.log('  Examples:');
      for (const cue of withBrackets.slice(0, 10)) {
        const matches = cue.text.match(/\[([^\]]+)\]/g);
        console.log(
          `    [${formatTimestamp(cue.timestamp)}] ${JSON.stringify(cue.text.slice(0, 100))} -- brackets: ${matches?.join(', ')}`,
        );
      }
    }

    // Parenthesized text like (sighs), (in Spanish)
    const parenPattern = /\(([^)]+)\)/;
    const withParens = allCues.filter((c) => parenPattern.test(c.text));
    console.log('\n  Cues with (parenthesized) text:', withParens.length);
    if (withParens.length > 0) {
      console.log('  Examples:');
      for (const cue of withParens.slice(0, 10)) {
        const matches = cue.text.match(/\(([^)]+)\)/g);
        console.log(
          `    [${formatTimestamp(cue.timestamp)}] ${JSON.stringify(cue.text.slice(0, 100))} -- parens: ${matches?.join(', ')}`,
        );
      }
    }

    // Speaker labels: lines starting with "- " (dialogue dash)
    const dashSpeaker = allCues.filter((c) => /(?:^|\n)- /.test(c.text));
    console.log('\n  Cues with "- " dialogue dash:', dashSpeaker.length);
    if (dashSpeaker.length > 0) {
      console.log('  Examples:');
      for (const cue of dashSpeaker.slice(0, 10)) {
        console.log(
          `    [${formatTimestamp(cue.timestamp)}] ${JSON.stringify(cue.text.slice(0, 100))}`,
        );
      }
    }

    // Speaker labels: NAME: pattern (e.g., "JOHN:", "MAN:")
    const nameLabelPattern = /(?:^|\n)[A-Z][A-Z\s]+:/;
    const withNameLabels = allCues.filter((c) => nameLabelPattern.test(c.text));
    console.log('\n  Cues with NAME: speaker labels:', withNameLabels.length);
    if (withNameLabels.length > 0) {
      console.log('  Examples:');
      for (const cue of withNameLabels.slice(0, 10)) {
        console.log(
          `    [${formatTimestamp(cue.timestamp)}] ${JSON.stringify(cue.text.slice(0, 100))}`,
        );
      }
    }

    // Music notes (common in SDH)
    const musicPattern = /[♪♫#]/;
    const withMusic = allCues.filter((c) => musicPattern.test(c.text));
    console.log('\n  Cues with music indicators:', withMusic.length);
    if (withMusic.length > 0) {
      console.log('  Examples:');
      for (const cue of withMusic.slice(0, 5)) {
        console.log(
          `    [${formatTimestamp(cue.timestamp)}] ${JSON.stringify(cue.text.slice(0, 100))}`,
        );
      }
    }

    // Italic markers (HTML <i> tags common in tx3g/SRT)
    const italicPattern = /<i>|{\\i1}/;
    const withItalics = allCues.filter((c) => italicPattern.test(c.text));
    console.log('\n  Cues with italic markup:', withItalics.length);
    if (withItalics.length > 0) {
      console.log('  Examples:');
      for (const cue of withItalics.slice(0, 5)) {
        console.log(
          `    [${formatTimestamp(cue.timestamp)}] ${JSON.stringify(cue.text.slice(0, 100))}`,
        );
      }
    }
  });

  it('shows 10 representative cues from across the video', () => {
    console.log('\n=== REPRESENTATIVE CUES (10 samples) ===');

    const totalCues = allCues.length;
    // Pick indices: 0, 1, 2 (beginning), middle-2, middle-1, middle, middle+1, end-2, end-1, end
    const indices = [
      0,
      1,
      2,
      Math.floor(totalCues * 0.25),
      Math.floor(totalCues * 0.4),
      Math.floor(totalCues * 0.5),
      Math.floor(totalCues * 0.6),
      Math.floor(totalCues * 0.75),
      totalCues - 2,
      totalCues - 1,
    ];

    for (const idx of indices) {
      const cue = allCues[idx];
      if (!cue) continue;
      const endTime = cue.timestamp + cue.duration;
      console.log(`\n  --- Cue #${idx} / ${totalCues} ---`);
      console.log(`    time: ${formatTimestamp(cue.timestamp)} --> ${formatTimestamp(endTime)}`);
      console.log(`    duration: ${cue.duration.toFixed(3)}s`);
      console.log(`    text: ${JSON.stringify(cue.text)}`);
      if (cue.identifier !== undefined)
        console.log(`    identifier: ${JSON.stringify(cue.identifier)}`);
      if (cue.settings !== undefined) console.log(`    settings: ${JSON.stringify(cue.settings)}`);
      if (cue.notes !== undefined) console.log(`    notes: ${JSON.stringify(cue.notes)}`);
    }
  });

  it('cleanup', () => {
    input.dispose();
  });
});
