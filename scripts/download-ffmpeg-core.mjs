import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FFMPEG_CORE_VERSION = '0.12.10';
const BASE_URL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`;

const FILES = [
  {
    name: 'ffmpeg-core.js',
    sha256: '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3',
  },
  {
    name: 'ffmpeg-core.wasm',
    sha256: '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7',
  },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../src/vendor/ffmpeg-core');
const force = process.argv.includes('--force');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readIfExists(filePath) {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

await mkdir(outDir, { recursive: true });

for (const file of FILES) {
  const filePath = path.join(outDir, file.name);

  if (!force) {
    const existing = await readIfExists(filePath);
    if (existing && sha256(existing) === file.sha256) {
      console.log(`ffmpeg-core: up to date ${file.name}`);
      continue;
    }
  }

  const url = `${BASE_URL}/${file.name}`;
  console.log(`ffmpeg-core: downloading ${url}`);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status} ${response.statusText}).`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== file.sha256) {
    throw new Error(
      `Checksum mismatch for ${file.name}. Expected ${file.sha256}, got ${digest}.`,
    );
  }

  await writeFile(filePath, bytes);
  console.log(`ffmpeg-core: wrote ${file.name}`);
}
