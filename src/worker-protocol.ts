export type WorkerSegmentPhase =
  | 'queued'
  | 'prefetching'
  | 'processing'
  | 'ready'
  | 'cache-hit'
  | 'aborted'
  | 'error';

export interface WorkerSegmentStateMessage {
  type: 'segment-state';
  index: number;
  phase: WorkerSegmentPhase;
  sizeBytes?: number;
  message?: string;
}
