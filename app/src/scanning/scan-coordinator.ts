export class DirectoryScanCoordinator {
  private readonly tails = new Map<number, Promise<void>>();

  run<T>(directoryId: number, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(directoryId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(directoryId, tail);
    void tail.finally(() => {
      if (this.tails.get(directoryId) === tail) this.tails.delete(directoryId);
    });
    return run;
  }
}
