# PlaysVideoEngine API

```bash
npm install playsvideo
```

```ts
import { PlaysVideoEngine } from 'playsvideo';
```

## Constructor

```ts
const engine = new PlaysVideoEngine(video: HTMLVideoElement);
```

Attaches to a `<video>` element. Does not start playback until `loadFile` or `loadUrl` is called.

## Methods

### `loadFile(file: File): void`

Load a video from a local `File` object (from `<input type="file">`, drag-and-drop, File Handling API, etc.).

```ts
input.addEventListener('change', () => {
  const file = input.files?.[0];
  if (file) engine.loadFile(file);
});
```

### `loadUrl(url: string): void`

Load a video from an HTTP URL. The server must support CORS and HTTP range requests.

```ts
engine.loadUrl('https://example.com/video.mkv');
```

### `destroy(): void`

Tear down the engine, terminate the worker, and release all resources. Safe to call multiple times.

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `phase` | `'idle' \| 'demuxing' \| 'ready' \| 'error'` | Current engine state |
| `loading` | `boolean` | `true` while demuxing (shorthand for `phase === 'demuxing'`) |
| `totalSegments` | `number` | Number of segments in the plan (0 until ready) |
| `durationSec` | `number` | Video duration in seconds (0 until ready) |
| `subtitleTracks` | `SubtitleTrackInfo[]` | Embedded subtitle tracks (empty until ready) |

## Events

`PlaysVideoEngine` extends `EventTarget`. All events are `CustomEvent` with typed `detail`.

### `loading`

Fired when a file or URL starts loading.

```ts
engine.addEventListener('loading', (e) => {
  // e.detail.file — the File object (if loadFile was called)
  // e.detail.url  — the URL string (if loadUrl was called)
});
```

### `ready`

Fired when demuxing is complete and playback begins.

```ts
engine.addEventListener('ready', (e) => {
  console.log(e.detail.totalSegments);  // number of segments
  console.log(e.detail.durationSec);    // duration in seconds
  console.log(e.detail.subtitleTracks); // SubtitleTrackInfo[]
});
```

### `error`

Fired on fatal errors (demux failure, unsupported format, playback error, etc.).

```ts
engine.addEventListener('error', (e) => {
  console.error(e.detail.message);
});
```

## Types

### `SubtitleTrackInfo`

```ts
interface SubtitleTrackInfo {
  index: number;        // 0-based track index
  codec: string;        // original codec (e.g. 'subrip', 'ass')
  language: string;     // ISO 639-2/T code (e.g. 'eng', 'spa', 'und')
  name: string | null;  // user-visible track name, if any
  disposition: {
    default: boolean;
    forced: boolean;
    hearingImpaired: boolean;
  };
}
```

## Full example

```ts
import { PlaysVideoEngine } from 'playsvideo';

const video = document.querySelector('video')!;
const status = document.querySelector('#status')!;
const engine = new PlaysVideoEngine(video);

engine.addEventListener('loading', () => {
  status.textContent = 'Loading...';
});

engine.addEventListener('ready', (e) => {
  const { totalSegments, durationSec, subtitleTracks } = e.detail;
  const mins = Math.floor(durationSec / 60);
  const secs = Math.floor(durationSec % 60);
  status.textContent = `${totalSegments} segments, ${mins}:${secs.toString().padStart(2, '0')}`;
  if (subtitleTracks.length > 0) {
    console.log(`${subtitleTracks.length} subtitle tracks`);
  }
});

engine.addEventListener('error', (e) => {
  status.textContent = `Error: ${e.detail.message}`;
});

// Load from file input
document.querySelector('input[type=file]')!.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) engine.loadFile(file);
});

// Or load from URL
engine.loadUrl('https://example.com/video.mkv');
```

## Notes

- Calling `loadFile` or `loadUrl` while already playing will cleanly tear down the previous session and start a new one.
- Embedded subtitles (SRT, ASS/SSA) are automatically extracted and attached as `<track>` elements on the video.
- Audio codecs unsupported by the browser (AC-3, DTS, FLAC, etc.) are transcoded to AAC on the fly using a lightweight ffmpeg.wasm build that is lazy-loaded only when needed.
- URL loading uses HTTP range requests for random access — the entire file is **not** downloaded upfront.
