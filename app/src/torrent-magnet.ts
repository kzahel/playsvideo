export function magnetWithFileIndex(magnetUrl: string, fileIndex?: number): string {
  const url = new URL(magnetUrl);
  if (url.protocol !== 'magnet:') {
    throw new Error('Expected a magnet URL');
  }
  if (fileIndex != null) {
    url.searchParams.set('so', String(fileIndex));
  }
  return url.toString();
}
