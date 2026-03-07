import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useEngine } from '../hooks/useEngine';

export function Player() {
  const { id } = useParams<{ id: string }>();
  const entryId = Number(id);

  const entry = useLiveQuery(() => db.library.get(entryId), [entryId]);
  const { videoRef, status } = useEngine(entry ?? null);

  if (entry === undefined) {
    return <div className="player-page">Loading...</div>;
  }

  if (!entry) {
    return (
      <div className="player-page">
        <Link to="/" className="player-back">
          &larr; Back to Library
        </Link>
        <p>Video not found.</p>
      </div>
    );
  }

  return (
    <div className="player-page">
      <Link to="/" className="player-back">
        &larr; Back to Library
      </Link>
      <video ref={videoRef} controls autoPlay />
      <div className="player-status">{status}</div>
    </div>
  );
}
