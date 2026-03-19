const CHUNK_SIZE = 65536; // 64KB

/**
 * Compute a lightweight content hash from head + tail + size of a file/blob.
 * Fast even for multi-GB files since it only reads 128KB total.
 */
export async function computeContentHash(file: Blob): Promise<string> {
  const head = await file.slice(0, CHUNK_SIZE).arrayBuffer();
  const tail =
    file.size > CHUNK_SIZE ? await file.slice(-CHUNK_SIZE).arrayBuffer() : new ArrayBuffer(0);
  const sizeBytes = new TextEncoder().encode(String(file.size));

  const combined = new Uint8Array(head.byteLength + tail.byteLength + sizeBytes.byteLength);
  combined.set(new Uint8Array(head), 0);
  combined.set(new Uint8Array(tail), head.byteLength);
  combined.set(sizeBytes, head.byteLength + tail.byteLength);

  const digest = await crypto.subtle.digest('SHA-1', combined);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
