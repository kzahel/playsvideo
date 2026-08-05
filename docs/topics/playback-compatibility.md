# Playback Compatibility

Topic: `playback-compatibility`

Status: direct playback, remuxed HLS/fMP4 playback, and on-demand audio
transcode are implemented. Unsupported video codecs still have no transcode
fallback.

## Scope

This topic owns playback-path selection and compatibility evidence: native
passthrough versus remux/HLS, MSE codec probing, segment processing, audio
transcode, the mediabunny fork boundary, and the unsupported-video roadmap.

It does not own catalog identity, file permission UX, or application sync.

## Current Playback Decision

The engine demuxes enough source metadata to describe both:

- short source codecs such as `avc`, `hevc`, `ac3`, or `opus`; and
- full decoder codec strings such as `avc1.640028` or `mp4a.40.2`.

Direct/native playback and remuxed pipeline playback are evaluated separately:

- direct playback asks `HTMLMediaElement.canPlayType()` about the source
  container plus full codec list;
- the pipeline asks `MediaSource.isTypeSupported()` about the codecs after
  remuxing to fragmented MP4;
- direct playback is preferred when both paths are supported;
- otherwise the HLS path is selected only if hls.js and the source video codec
  are supported;
- missing capabilities/metadata produce an explicit unknown result, and no
  viable option produces an explicit playback error.

`loadWithOptions()` lets an external consumer offer direct URL/byte and HLS
options, choose a preference order, or force HLS. The engine emits a
`playbackdecision` event with the evaluated options and retains a `codecPath`
description of source and output codecs for diagnostics.

## Remux Pipeline Contract

```text
Source bytes
  -> mediabunny demux
  -> sparse MKV cue index or key-packet index
  -> keyframe-aligned segment plan
  -> collect video/audio packets for requested segment
  -> optional audio transcode to AAC
  -> mediabunny fragmented-MP4 mux
  -> hls.js custom playlist/fragment loaders
  -> browser MSE decoder
```

Video packets are copied, not decoded or encoded. The worker retains the demux
handle and produces segments on demand. Segment 0 is prepared during startup;
later segments are cached/prefetched in a bounded near-playhead flow. hls.js
aborts propagate between stages and into abort-aware external sources. A
running ffmpeg operation cannot be interrupted, so its result is discarded if
the request was canceled.

Large source files are never copied into ffmpeg MEMFS. Mediabunny reads the
original Blob, URL, or external `Source`; only the encoded audio packets for a
short segment enter ffmpeg.wasm.

The project deliberately does not require `SharedArrayBuffer` or COOP/COEP.
The ffmpeg core is single-threaded, and independent transcode workers provide
inter-segment concurrency with separate MEMFS heaps.

## Audio Compatibility Contract

AAC is retained when the active pipeline reports it safe. MP3, AC-3, E-AC-3,
DTS, FLAC, and Opus can be transcoded to AAC using the audio-only ffmpeg.wasm
bundle. The output is stereo AAC-LC at 160 kbps in ADTS framing, parsed back
into timestamped encoded packets before fMP4 muxing.

Unknown audio codecs take the safe path and require transcode. If the minimal
bundle cannot handle the codec, the disabled full tier produces a clear error
rather than silently loading the large video-capable bundle.

AC-3 and E-AC-3 are always treated as unsafe in the remux/HLS path even when
MSE advertises support. This preserves the observed distinction where direct
file playback worked but Safari produced audible stalls after the same audio
was remuxed into HLS/fMP4. Direct passthrough may still use the source audio.

## Video Compatibility Contract

The pipeline supports a video codec only when the active browser reports its
full fMP4 codec string through MSE. H.264 is the broad baseline; HEVC, VP9, and
AV1 remain runtime/platform decisions rather than hardcoded browser promises.

There is no software video encode path. When neither direct playback nor MSE
can decode the source video codec, playback fails with diagnostics. The future
direction remains WebCodecs decode/encode, preferably hardware H.264 output;
the full ffmpeg.wasm tier is disabled and is not an acceptable whole-file video
encoder.

## Mediabunny Boundary

Both workspaces depend on the public `kzahel/mediabunny` `integration` branch,
currently pinned in `pnpm-lock.yaml` to commit
`cd3cd2beb9c122dfa6fa89edbd7a73f2fa9df7a0`.

The required fork delta is intentionally narrow:

- subtitle support;
- the HEVC/H.264 reordered-GOP timestamp guard correction.

PlaysVideo owns its sparse MKV cue parser because mediabunny key-packet
iteration can seek broadly through clusters even in metadata-only mode. The
authoritative fork checkout is `~/code/references/mediabunny`; disposable
`node_modules` patches are never source of truth. Prefer a pinned package
dependency over adding a submodule.

## Evidence and Diagnostics

- `tests/unit/playback-selection.test.ts` covers path preference, audio
  transcode viability, unsupported video, and unknown inputs.
- `tests/unit/codec-probe.test.ts` covers MSE mappings, conservative fallbacks,
  caching, and forced AC-3/E-AC-3 transcode.
- Pipeline unit tests cover segment planning, packet collection, ADTS parsing,
  aborts, workers, subtitles, and engine state.
- `tests/integration/hevc-gop-regression.test.ts` protects reordered GOP muxing
  when fixtures are available.
- Engine events expose selected codecs, transcode-worker state, segment state,
  and playback-decision diagnostics.

## Known Gaps and Next Work

1. Build a browser/platform compatibility fixture matrix from measured direct
   and remux/HLS results; do not infer one path from the other.
2. Implement video transcode only as a bounded WebCodecs design with capability
   probes, timestamps, backpressure, and hardware/fallback evidence.
3. Keep the mediabunny fork rebased and pinned to a public commit containing
   only required patches and regression coverage.
4. Expand integration fixtures for unsupported/edge codecs, multichannel
   audio, damaged inputs, and long seek sequences.
5. Keep published compatibility claims aligned with runtime evidence in
   [`supported-media.md`](../supported-media.md).

## Code and Documentation Map

- `src/playback-selection.ts` — pure path evaluation.
- `src/pipeline/codec-probe.ts` — MSE codec decisions.
- `src/engine.ts` and `src/worker.ts` — selection and browser orchestration.
- `src/pipeline/segment-processor.ts` — on-demand segment stages.
- `src/pipeline/audio-transcode.ts` — encoded-audio to AAC path.
- `src/adapters/wasm-ffmpeg.ts` — lazy audio bundle and disabled full tier.
- [`codec-architecture.md`](../codec-architecture.md) — architecture and
  licensing background.
- [`mediabunny-integration.md`](../mediabunny-integration.md) — fork history.
- [`source-contract.md`](../source-contract.md) — external byte-source contract.
- [`no-shared-array-buffer.md`](../no-shared-array-buffer.md) — hosting choice.
