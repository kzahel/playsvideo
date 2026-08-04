import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import type { ActivityFact } from '../activity/activity-view.js';
import {
  resolveHandoffCapabilities,
  type HandoffAvailability,
} from '../activity/handoff-actions.js';
import type { LocalPlaybackTarget } from '../playback-identity-resolver.js';
import {
  dismissPendingHandoff,
  pendingHandoffId,
  recordPendingHandoff,
} from '../handoff/pending-handoffs.js';
import { db } from '../db.js';

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function availabilityLabel(availability: HandoffAvailability): string {
  switch (availability) {
    case 'available-here':
      return 'Available here';
    case 'download-required':
      return 'Download required';
    case 'incomplete-download':
      return 'Incomplete download';
    case 'ambiguous-local-match':
      return 'Multiple local matches';
    case 'no-source':
      return 'No source on this device';
  }
}

export function PlaybackHandoffActions({
  fact,
  localTarget,
  ambiguous = false,
  compact = false,
  onOpenMagnet,
}: {
  fact: ActivityFact;
  localTarget?: LocalPlaybackTarget;
  ambiguous?: boolean;
  compact?: boolean;
  onOpenMagnet?: (magnetUrl: string) => void | Promise<void>;
}) {
  const [status, setStatus] = useState('');
  const capabilities = resolveHandoffCapabilities({ fact, localTarget, ambiguous });
  const canShare = typeof navigator.share === 'function';
  const handoffId = pendingHandoffId(fact);
  const pendingHandoff = useLiveQuery(
    () => db.pendingHandoffs.get(handoffId),
    [handoffId],
  );
  const resumeState = localTarget
    ? {
        resumePlayback: {
          playbackKey: localTarget.localPlaybackKey,
          positionSec: fact.positionSec,
          durationSec: fact.durationSec,
          watchState: fact.watchState,
          lastPlayedAt: fact.lastPlayedAt,
        },
        ...(pendingHandoff && pendingHandoff.status !== 'consumed'
          ? { pendingHandoffId: pendingHandoff.id }
          : {}),
      }
    : undefined;

  return (
    <div className={`handoff-actions${compact ? ' handoff-actions-compact' : ''}`}>
      <span className={`handoff-availability ${capabilities.availability}`}>
        {availabilityLabel(capabilities.availability)}
      </span>
      <div className="handoff-action-buttons">
        {capabilities.canResume && localTarget && (
          <Link
            to={`/play/${localTarget.catalogId}`}
            state={resumeState}
            className="btn btn-primary handoff-action"
          >
            {pendingHandoff?.status === 'ready'
              ? 'Resume downloaded video'
              : `Resume here at ${formatDuration(fact.positionSec)}`}
          </Link>
        )}
        {capabilities.magnetUrl && (
          <>
            <a
              href={capabilities.magnetUrl}
              className="btn btn-secondary handoff-action"
              onClick={async (event) => {
                event.preventDefault();
                try {
                  await recordPendingHandoff(fact, capabilities.magnetUrl!);
                  await onOpenMagnet?.(capabilities.magnetUrl!);
                  window.location.assign(capabilities.magnetUrl!);
                } catch {
                  setStatus('Could not save the resume handoff.');
                }
              }}
            >
              Open in JSTorrent
            </a>
            <button
              type="button"
              className="btn btn-secondary handoff-action"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(capabilities.magnetUrl!);
                  setStatus('Magnet link copied.');
                } catch {
                  setStatus('Could not copy the magnet link.');
                }
              }}
            >
              Copy magnet
            </button>
            {canShare && (
              <button
                type="button"
                className="btn btn-secondary handoff-action"
                onClick={async () => {
                  try {
                    await navigator.share({
                      title: fact.title ?? 'Video magnet link',
                      text: capabilities.magnetUrl,
                    });
                    setStatus('Magnet link shared.');
                  } catch (error) {
                    if (error instanceof Error && error.name === 'AbortError') return;
                    setStatus('Could not share the magnet link.');
                  }
                }}
              >
                Share
              </button>
            )}
          </>
        )}
        {pendingHandoff && pendingHandoff.status !== 'consumed' && (
          <button
            type="button"
            className="btn btn-secondary handoff-action"
            onClick={async () => {
              await dismissPendingHandoff(pendingHandoff.id);
              setStatus('Saved handoff dismissed.');
            }}
          >
            Dismiss handoff
          </button>
        )}
        <details className="handoff-details">
          <summary>Details</summary>
          <dl>
            <div>
              <dt>Source</dt>
              <dd>{fact.deviceLabel}</dd>
            </div>
            <div>
              <dt>Playback identity</dt>
              <dd>{fact.playbackKey}</dd>
            </div>
            {fact.torrentInfoHash && (
              <div>
                <dt>Info hash</dt>
                <dd>{fact.torrentInfoHash}</dd>
              </div>
            )}
            {fact.torrentFileIndex != null && (
              <div>
                <dt>File index</dt>
                <dd>{fact.torrentFileIndex}</dd>
              </div>
            )}
            {localTarget && (
              <div>
                <dt>Local match</dt>
                <dd>
                  {localTarget.matchKind} · {localTarget.confidence} confidence
                </dd>
              </div>
            )}
          </dl>
        </details>
      </div>
      {pendingHandoff?.status === 'waiting-for-media' && (
        <span className="handoff-pending-status">Resume position saved while download completes.</span>
      )}
      {pendingHandoff?.status === 'ready' && (
        <span className="handoff-pending-status">Downloaded media is ready to resume.</span>
      )}
      {status && <span className="handoff-action-status">{status}</span>}
    </div>
  );
}
