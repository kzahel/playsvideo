import type { CatalogEntry } from '../db.js';

export const FOCUSED_DISCOVERY_MAX_ENTRIES = 2_000;
export const FOCUSED_DISCOVERY_COOLDOWN_MS = 15_000;
export const FOCUSED_DISCOVERY_INTERVAL_MS = 3 * 60_000;
export const FOCUSED_DISCOVERY_NEAR_END_SEC = 15 * 60;

export type FocusedDiscoveryTrigger =
  | 'mount'
  | 'window-focus'
  | 'page-visible'
  | 'periodic-playback'
  | 'near-end'
  | 'fullscreen-exit';

export interface FocusedDiscoveryTriggerState {
  hasNextEpisode: boolean;
  pageVisible: boolean;
  fullscreen: boolean;
  playbackActive: boolean;
  currentTimeSec?: number;
  durationSec?: number;
}

export function shouldRunFocusedDiscovery(
  trigger: FocusedDiscoveryTrigger,
  state: FocusedDiscoveryTriggerState,
): boolean {
  if (state.hasNextEpisode || !state.pageVisible || state.fullscreen) return false;

  if (trigger === 'periodic-playback' && !state.playbackActive) return false;
  if (trigger !== 'near-end') return true;
  if (!state.playbackActive) return false;

  const currentTimeSec = state.currentTimeSec;
  const durationSec = state.durationSec;
  return (
    currentTimeSec != null &&
    durationSec != null &&
    Number.isFinite(currentTimeSec) &&
    Number.isFinite(durationSec) &&
    durationSec > 0 &&
    currentTimeSec >= 0 &&
    durationSec - currentTimeSec <= FOCUSED_DISCOVERY_NEAR_END_SEC
  );
}

export interface FocusedDiscoveryPlan {
  directoryId: number;
  scopePath: string;
  seriesIdentity: string;
  maxEntries: number;
}

export type FocusedDiscoveryStatus =
  | 'updated'
  | 'unchanged'
  | 'permission-required'
  | 'unsupported'
  | 'throttled'
  | 'failed';

export interface FocusedDiscoveryResult {
  status: FocusedDiscoveryStatus;
  scopePath?: string;
  inspectedEntryCount: number;
  relevantFileCount: number;
  updatedEntryCount: number;
  truncated: boolean;
}

type SeriesIdentitySource = Pick<
  CatalogEntry,
  'detectedMediaType' | 'parsedTitle' | 'parsedYear' | 'seriesMetadataKey'
>;

export function catalogSeriesIdentity(entry: SeriesIdentitySource): string | null {
  if (entry.detectedMediaType !== 'tv' || !entry.parsedTitle) return null;
  return entry.seriesMetadataKey ?? `tv-local:${entry.parsedTitle}:${entry.parsedYear ?? ''}`;
}

export function parentDirectoryPath(path: string): string {
  const normalized = path.replace(/^\/+|\/+$/g, '');
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? '' : normalized.slice(0, slash);
}

function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

export function commonDirectoryPath(paths: string[]): string {
  if (paths.length === 0) return '';
  const segments = paths.map(pathSegments);
  const common: string[] = [];
  const shortestLength = Math.min(...segments.map((parts) => parts.length));
  for (let index = 0; index < shortestLength; index += 1) {
    const segment = segments[0][index];
    if (!segments.every((parts) => parts[index] === segment)) break;
    common.push(segment);
  }
  return common.join('/');
}

const SEASON_DIRECTORY_PATTERN = /^(?:(?:season|series)[ ._-]*\d+|s\d{1,2}|specials?)$/i;

function isSeasonDirectory(path: string): boolean {
  const name = pathSegments(path).at(-1);
  return name != null && SEASON_DIRECTORY_PATTERN.test(name);
}

export function buildFocusedDiscoveryPlan(
  currentEntry: CatalogEntry,
  catalogEntries: CatalogEntry[],
): FocusedDiscoveryPlan | null {
  const seriesIdentity = catalogSeriesIdentity(currentEntry);
  if (!seriesIdentity || currentEntry.directoryId == null) return null;

  const knownDirectories = [
    ...new Set(
      catalogEntries
        .filter((entry) => entry.directoryId === currentEntry.directoryId)
        .filter((entry) => catalogSeriesIdentity(entry) === seriesIdentity)
        .map((entry) => parentDirectoryPath(entry.path)),
    ),
  ];
  if (knownDirectories.length === 0) {
    knownDirectories.push(parentDirectoryPath(currentEntry.path));
  }

  let scopePath =
    knownDirectories.length === 1
      ? knownDirectories[0]
      : commonDirectoryPath(knownDirectories);
  if (isSeasonDirectory(scopePath)) {
    scopePath = parentDirectoryPath(scopePath);
  }

  return {
    directoryId: currentEntry.directoryId,
    scopePath,
    seriesIdentity,
    maxEntries: FOCUSED_DISCOVERY_MAX_ENTRIES,
  };
}

export function focusedDiscoveryPlanKey(plan: FocusedDiscoveryPlan): string {
  return `${plan.directoryId}:${plan.scopePath}:${plan.seriesIdentity}:${plan.maxEntries}`;
}

export function emptyFocusedDiscoveryResult(
  status: FocusedDiscoveryStatus,
  plan?: FocusedDiscoveryPlan,
): FocusedDiscoveryResult {
  return {
    status,
    ...(plan ? { scopePath: plan.scopePath } : {}),
    inspectedEntryCount: 0,
    relevantFileCount: 0,
    updatedEntryCount: 0,
    truncated: false,
  };
}

export class FocusedDiscoveryCoordinator {
  private readonly active = new Map<string, Promise<FocusedDiscoveryResult>>();
  private readonly completedAt = new Map<string, number>();

  constructor(
    private readonly cooldownMs = FOCUSED_DISCOVERY_COOLDOWN_MS,
    private readonly now: () => number = Date.now,
  ) {}

  run(
    key: string,
    work: () => Promise<FocusedDiscoveryResult>,
  ): Promise<FocusedDiscoveryResult> {
    const active = this.active.get(key);
    if (active) return active;

    const completedAt = this.completedAt.get(key);
    if (completedAt != null && this.now() - completedAt < this.cooldownMs) {
      return Promise.resolve(emptyFocusedDiscoveryResult('throttled'));
    }

    const run = work()
      .then((result) => {
        this.completedAt.set(key, this.now());
        return result;
      })
      .finally(() => {
        if (this.active.get(key) === run) this.active.delete(key);
      });
    this.active.set(key, run);
    return run;
  }
}
