import type { RemotePlaybackEntry, WatchState } from './db.js';

export interface LocalResumeState {
  deviceId: string;
  playbackKey: string;
  positionSec: number;
  durationSec: number;
  watchState: WatchState;
  lastPlayedAt: number;
}

export interface RemoteResumeState extends Pick<
  RemotePlaybackEntry,
  'deviceId' | 'deviceLabel' | 'playbackKey' | 'positionSec' | 'durationSec' | 'watchState' | 'lastPlayedAt' | 'title'
> {}

export interface ResumeOption {
  source: 'local' | 'remote';
  deviceId: string;
  deviceLabel?: string;
  playbackKey: string;
  positionSec: number;
  durationSec: number;
  watchState: WatchState;
  lastPlayedAt: number;
  title?: string;
}

export interface ResumeEvaluation {
  recommended: ResumeOption | null;
  suggestions: ResumeOption[];
  shouldStartOver: boolean;
}

function toResumeOption(
  source: 'local' | 'remote',
  state: LocalResumeState | RemoteResumeState,
): ResumeOption {
  return {
    source,
    deviceId: state.deviceId,
    deviceLabel: 'deviceLabel' in state ? state.deviceLabel : undefined,
    playbackKey: state.playbackKey,
    positionSec: state.positionSec,
    durationSec: state.durationSec,
    watchState: state.watchState,
    lastPlayedAt: state.lastPlayedAt,
    title: 'title' in state ? state.title : undefined,
  };
}

function isResumable(option: ResumeOption): boolean {
  return option.positionSec > 0 && option.watchState !== 'watched';
}

export function evaluateResumePolicy(input: {
  local?: LocalResumeState | null;
  remote?: RemoteResumeState[];
}): ResumeEvaluation {
  const localOption = input.local ? toResumeOption('local', input.local) : null;
  const remoteOptions = (input.remote ?? [])
    .map((entry) => toResumeOption('remote', entry))
    .sort((left, right) => right.lastPlayedAt - left.lastPlayedAt);

  const suggestions = [
    ...(localOption ? [localOption] : []),
    ...remoteOptions,
  ].sort((left, right) => right.lastPlayedAt - left.lastPlayedAt);

  if (localOption && isResumable(localOption)) {
    return {
      recommended: localOption,
      suggestions,
      shouldStartOver: false,
    };
  }

  const bestRemote = remoteOptions.find(isResumable) ?? null;
  if (!localOption && bestRemote) {
    return {
      recommended: bestRemote,
      suggestions,
      shouldStartOver: false,
    };
  }

  return {
    recommended: null,
    suggestions,
    shouldStartOver: true,
  };
}
