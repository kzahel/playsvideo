/// <reference lib="webworker" />

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type {
  GeneratedThumbnailResult,
  ThumbnailFrameDiagnostics,
  ThumbnailWorkerRequest,
  ThumbnailWorkerResponse,
} from './thumbnails/protocol.js';
import {
  buildThumbnailCandidateTimestamps,
  scoreThumbnailPixels,
  selectBestThumbnailFrame,
} from './thumbnails/selection.js';

declare const self: DedicatedWorkerGlobalScope;

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 180;
const WEBP_QUALITY = 0.82;

function formatDiagnostics(candidate: ThumbnailFrameDiagnostics): string {
  const decision = candidate.accepted ? 'accepted' : 'fallback';
  return [
    `${decision} ${candidate.timestampSec.toFixed(2)}s`,
    `score=${candidate.score.toFixed(1)}`,
    `mean=${candidate.meanLuma.toFixed(1)}`,
    `stddev=${candidate.standardDeviation.toFixed(1)}`,
    `edge=${candidate.edgeScore.toFixed(1)}`,
    `dark=${candidate.darkPixelRatio.toFixed(2)}`,
  ].join('; ');
}

function postResponse(response: ThumbnailWorkerResponse): void {
  self.postMessage(response);
}

async function generateThumbnail(
  request: ThumbnailWorkerRequest,
): Promise<GeneratedThumbnailResult> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(request.file),
  });

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error('The file has no video track.');
    }
    if (!(await videoTrack.canDecode())) {
      const codec = (await videoTrack.getCodecParameterString()) ?? videoTrack.codec ?? 'unknown';
      throw new Error(`The browser cannot decode the video track (${codec}).`);
    }

    const firstTimestampSec = Math.max(0, await videoTrack.getFirstTimestamp());
    const endTimestampSec = await videoTrack.computeDuration();
    const durationSec = endTimestampSec - firstTimestampSec;
    const candidateOffsets = buildThumbnailCandidateTimestamps(durationSec);
    if (candidateOffsets.length === 0) {
      throw new Error('The video track has no usable duration.');
    }

    const sink = new CanvasSink(videoTrack, {
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      fit: 'cover',
    });
    const canvases = new Map<number, OffscreenCanvas>();
    const diagnostics: ThumbnailFrameDiagnostics[] = [];

    for (const offsetSec of candidateOffsets) {
      const requestedTimestampSec = firstTimestampSec + offsetSec;
      const wrappedCanvas = await sink.getCanvas(requestedTimestampSec);
      if (!wrappedCanvas) {
        continue;
      }
      if (!(wrappedCanvas.canvas instanceof OffscreenCanvas)) {
        throw new Error('Thumbnail worker did not receive an OffscreenCanvas.');
      }

      const context = wrappedCanvas.canvas.getContext('2d');
      if (!context) {
        throw new Error('Unable to read the thumbnail canvas.');
      }
      const imageData = context.getImageData(
        0,
        0,
        wrappedCanvas.canvas.width,
        wrappedCanvas.canvas.height,
      );
      const score = scoreThumbnailPixels(imageData);
      const timestampSec = wrappedCanvas.timestamp;
      canvases.set(timestampSec, wrappedCanvas.canvas);
      diagnostics.push({ timestampSec, ...score });
    }

    const selected = selectBestThumbnailFrame(diagnostics);
    if (!selected) {
      throw new Error('No candidate video frame could be decoded.');
    }
    const selectedCanvas = canvases.get(selected.timestampSec);
    if (!selectedCanvas) {
      throw new Error('The selected thumbnail canvas is unavailable.');
    }

    const blob = await selectedCanvas.convertToBlob({
      type: 'image/webp',
      quality: WEBP_QUALITY,
    });

    return {
      type: 'generated',
      jobId: request.jobId,
      blob,
      width: selectedCanvas.width,
      height: selectedCanvas.height,
      selectedTimestampSec: selected.timestampSec,
      durationSec,
      debugReason: formatDiagnostics(selected),
      candidates: diagnostics,
    };
  } finally {
    input.dispose();
  }
}

let queue = Promise.resolve();

self.onmessage = (event: MessageEvent<ThumbnailWorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'generate') {
    return;
  }

  queue = queue.then(async () => {
    try {
      postResponse(await generateThumbnail(request));
    } catch (error) {
      postResponse({
        type: 'error',
        jobId: request.jobId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
