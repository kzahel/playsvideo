import type { Input, SubtitleCue } from 'mediabunny';
import { formatCuesToWebVTT } from 'mediabunny';
import type { SubtitleCueEntry, SubtitleData, SubtitleTrackInfo } from './types.js';

/** Discover subtitle tracks from a demuxed input. Cheap — reads only metadata, no cue extraction. */
export async function getSubtitleTrackInfos(input: Input): Promise<SubtitleTrackInfo[]> {
  const tracks = await input.getSubtitleTracks();
  return tracks.map((track, i) => {
    const d = track.disposition;
    return {
      index: i,
      codec: track.codec ?? 'unknown',
      language: track.languageCode,
      name: track.name,
      disposition: {
        default: d.default,
        forced: d.forced,
        hearingImpaired: d.hearingImpaired,
      },
    };
  });
}

/** Extract all cues from a subtitle track and return cleaned SubtitleData. */
export async function extractSubtitleData(input: Input, trackIndex: number): Promise<SubtitleData> {
  const tracks = await input.getSubtitleTracks();
  const track = tracks[trackIndex];
  if (!track) {
    throw new Error(`Subtitle track index ${trackIndex} not found`);
  }

  const codec = track.codec ?? 'unknown';
  const rawCues: SubtitleCue[] = [];

  for await (const cue of track.getCues()) {
    rawCues.push(cue);
  }

  const cues = cleanCues(rawCues, codec);

  // For ASS/SSA, try to get the header from exportToText
  let header: string | undefined;
  if (codec === 'ass' || codec === 'ssa') {
    const exported = await track.exportToText();
    header = extractAssHeader(exported);
  }

  return { cues, codec, header };
}

/**
 * Convert SubtitleData to a WebVTT string suitable for a Blob URL.
 * Works for any source codec — ASS override tags are stripped to plain text.
 */
export function subtitleDataToWebVTT(data: SubtitleData): string {
  // If we have clean cues, use mediabunny's formatter
  const mbCues: SubtitleCue[] = data.cues.map((c) => ({
    timestamp: c.startSec,
    duration: c.endSec - c.startSec,
    text: stripAssTags(c.text),
    settings: c.settings,
  }));
  return formatCuesToWebVTT(mbCues);
}

/**
 * Parse a user-imported subtitle file into SubtitleData.
 * Supports .srt, .vtt, .ass/.ssa files.
 */
export function parseSubtitleFile(text: string, filename: string): SubtitleData {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'vtt') {
    return parseWebVTT(text);
  }
  if (ext === 'srt') {
    return parseSRT(text);
  }
  if (ext === 'ass' || ext === 'ssa') {
    return { cues: [], codec: ext, header: text };
    // For ASS, the full file IS the data — keep it opaque for JASSUB
    // Could also parse into cues for WebVTT fallback
  }

  throw new Error(`Unsupported subtitle format: .${ext}`);
}

// --- Internal helpers ---

/** Strip tx3g 2-byte length prefix, filter empty gap cues. */
function cleanCues(raw: SubtitleCue[], codec: string): SubtitleCueEntry[] {
  const cleaned: SubtitleCueEntry[] = [];

  for (const cue of raw) {
    let text = cue.text;

    // tx3g samples have a 2-byte big-endian length prefix
    if (codec === 'tx3g' && text.length >= 2) {
      text = text.slice(2);
    }

    text = text.trim();
    if (!text || cue.duration <= 0) continue;

    cleaned.push({
      startSec: cue.timestamp,
      endSec: cue.timestamp + cue.duration,
      text,
      settings: cue.settings,
    });
  }

  return cleaned;
}

/** Strip ASS/SSA override tags like {\b1}, {\pos(x,y)}, {\an8} → plain text. */
function stripAssTags(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n');
}

/** Extract the ASS header (everything before the first Dialogue: line). */
function extractAssHeader(fullText: string): string | undefined {
  const idx = fullText.indexOf('Dialogue:');
  if (idx === -1) return fullText;
  return fullText.slice(0, idx).trimEnd();
}

function parseWebVTT(text: string): SubtitleData {
  const cues: SubtitleCueEntry[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const timeRegex = /([\d:.]+)\s+-->\s+([\d:.]+)(.*)/;

  for (let i = 0; i < lines.length; i++) {
    const match = timeRegex.exec(lines[i]);
    if (!match) continue;

    const startSec = parseVTTTimestamp(match[1]);
    const endSec = parseVTTTimestamp(match[2]);
    const settings = match[3]?.trim() || undefined;

    const textLines: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j].trim(); j++) {
      textLines.push(lines[j]);
      i = j;
    }

    if (textLines.length > 0) {
      cues.push({ startSec, endSec, text: textLines.join('\n'), settings });
    }
  }

  // Extract preamble as header
  const firstArrow = text.indexOf('-->');
  let header: string | undefined;
  if (firstArrow !== -1) {
    const beforeFirstCue = text.slice(
      0,
      text.lastIndexOf('\n', text.lastIndexOf('\n', firstArrow) - 1),
    );
    if (beforeFirstCue.includes('WEBVTT')) {
      header = beforeFirstCue.trim();
    }
  }

  return { cues, codec: 'webvtt', header };
}

function parseSRT(text: string): SubtitleData {
  const cues: SubtitleCueEntry[] = [];
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/);
  const timeRegex = /([\d:,]+)\s+-->\s+([\d:,]+)/;

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    // Find the timing line (skip sequence number)
    let timingIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (timeRegex.test(lines[i])) {
        timingIdx = i;
        break;
      }
    }

    const match = timeRegex.exec(lines[timingIdx]);
    if (!match) continue;

    const startSec = parseSRTTimestamp(match[1]);
    const endSec = parseSRTTimestamp(match[2]);
    const cueText = lines
      .slice(timingIdx + 1)
      .join('\n')
      .trim();

    if (cueText) {
      cues.push({ startSec, endSec, text: cueText });
    }
  }

  return { cues, codec: 'srt' };
}

function parseVTTTimestamp(ts: string): number {
  const parts = ts.split(':');
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function parseSRTTimestamp(ts: string): number {
  const [time, ms] = ts.split(',');
  const parts = time.split(':');
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]) + Number(ms) / 1000;
}
