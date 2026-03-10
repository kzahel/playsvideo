import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { LibraryEntryCard } from '../components/LibraryEntry.js';
import { FolderPicker } from '../components/FolderPicker.js';
import { rescanFolder } from '../scan.js';

export function Library() {
  const entries = useLiveQuery(() => db.library.orderBy('name').toArray());
  const directory = useLiveQuery(() => db.directories.toCollection().first());

  const handleRescan = async () => {
    try {
      await rescanFolder();
    } catch (err) {
      console.error('Failed to rescan:', err);
    }
  };

  if (entries === undefined || directory === undefined) {
    return <div className="empty-state">Loading...</div>;
  }

  return (
    <div>
      <div className="library-header">
        <FolderPicker />
        {directory && (
          <button type="button" className="btn btn-secondary" onClick={handleRescan}>
            Rescan
          </button>
        )}
      </div>

      {!directory && (
        <div className="empty-state">
          <p>No folder selected.</p>
          <p style={{ marginTop: '0.5rem' }}>
            Click "Select Folder" to scan a directory for video files.
          </p>
        </div>
      )}

      {directory && entries.length === 0 && (
        <div className="empty-state">No video files found in {directory.name}.</div>
      )}

      {entries.length > 0 && (
        <div className="library-grid">
          {entries.map((entry) => (
            <LibraryEntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
