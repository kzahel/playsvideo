import type { ActivityFact } from './activity-view.js';
import type { LocalPlaybackTarget } from '../playback-identity-resolver.js';
import { magnetWithFileIndex } from '../torrent-magnet.js';

export type HandoffAvailability =
  | 'available-here'
  | 'download-required'
  | 'incomplete-download'
  | 'ambiguous-local-match'
  | 'no-source';

export interface HandoffCapabilities {
  availability: HandoffAvailability;
  magnetUrl?: string;
  canResume: boolean;
  localTarget?: LocalPlaybackTarget;
}

export function resolveHandoffCapabilities(input: {
  fact: ActivityFact;
  localTarget?: LocalPlaybackTarget;
  ambiguous?: boolean;
}): HandoffCapabilities {
  if (input.ambiguous) {
    return { availability: 'ambiguous-local-match', canResume: false };
  }

  const localTarget = input.localTarget;
  const magnet =
    localTarget?.catalogEntry.torrentMagnetUrl ?? input.fact.torrentMagnetUrl;
  const fileIndex =
    localTarget?.catalogEntry.torrentFileIndex ?? input.fact.torrentFileIndex;
  let magnetUrl: string | undefined;
  if (magnet) {
    try {
      magnetUrl = magnetWithFileIndex(magnet, fileIndex);
    } catch {
      magnetUrl = undefined;
    }
  }

  if (localTarget?.hasLocalFile) {
    return {
      availability: 'available-here',
      canResume: true,
      localTarget,
      magnetUrl,
    };
  }
  if (
    localTarget?.catalogEntry.torrentComplete === false ||
    input.fact.torrentComplete === false
  ) {
    return {
      availability: 'incomplete-download',
      canResume: false,
      localTarget,
      magnetUrl,
    };
  }
  if (magnetUrl) {
    return {
      availability: 'download-required',
      canResume: false,
      localTarget,
      magnetUrl,
    };
  }
  return {
    availability: 'no-source',
    canResume: false,
    localTarget,
  };
}
