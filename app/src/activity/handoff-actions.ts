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
  requiresConfirmation?: boolean;
}

export interface HandoffResumePoint {
  positionSec: number;
  durationSec: number;
  translated: boolean;
}

export function resolveHandoffResumePoint(
  fact: Pick<ActivityFact, 'positionSec' | 'durationSec'>,
  localTarget: LocalPlaybackTarget,
): HandoffResumePoint {
  const localDuration = localTarget.localDurationSec;
  if (!localDuration || localDuration <= 0 || fact.durationSec <= 0) {
    return {
      positionSec: fact.positionSec,
      durationSec: fact.durationSec,
      translated: false,
    };
  }

  const durationDifference = Math.abs(localDuration - fact.durationSec);
  const materiallyDifferent = durationDifference > Math.max(30, fact.durationSec * 0.05);
  if (localTarget.confidence === 'medium' && materiallyDifferent) {
    const watchedFraction = Math.min(1, Math.max(0, fact.positionSec / fact.durationSec));
    return {
      positionSec: watchedFraction * localDuration,
      durationSec: localDuration,
      translated: true,
    };
  }

  return {
    positionSec: Math.min(fact.positionSec, localDuration),
    durationSec: localDuration,
    translated: false,
  };
}

export function resolveHandoffCapabilities(input: {
  fact: ActivityFact;
  localTarget?: LocalPlaybackTarget;
  ambiguous?: boolean;
  lowConfidenceConfirmed?: boolean;
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
    const requiresConfirmation =
      localTarget.confidence === 'low' && !input.lowConfidenceConfirmed;
    return {
      availability: 'available-here',
      canResume: !requiresConfirmation,
      localTarget,
      magnetUrl,
      requiresConfirmation,
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
