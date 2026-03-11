export interface ReadResult {
  bytes: Uint8Array;
  view: DataView;
  offset: number;
}

/**
 * Lightweight source base class for reading bytes from a file-like resource.
 * Consumers extend this to provide custom byte sources (e.g. torrent streams).
 * Adapted to mediabunny's Source via SourceAdapter at the pipeline boundary.
 */
export abstract class Source {
  abstract _retrieveSize(): number | null | Promise<number | null>;
  abstract _read(start: number, end: number): ReadResult | Promise<ReadResult | null> | null;
  abstract _dispose(): void;

  private _sizePromise: Promise<number | null> | null = null;

  async getSizeOrNull(): Promise<number | null> {
    if (!this._sizePromise) {
      this._sizePromise = Promise.resolve(this._retrieveSize());
    }
    return this._sizePromise;
  }

  async getSize(): Promise<number> {
    const result = await this.getSizeOrNull();
    if (result === null) throw new Error('Cannot determine the size of an unsized source.');
    return result;
  }
}
