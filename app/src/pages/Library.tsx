import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { LibraryEntryCard } from '../components/LibraryEntry';
import { FolderPicker } from '../components/FolderPicker';
import { scanDirectory } from '../scan';

export function Library() {
  const entries = useLiveQuery(() => db.library.orderBy('name').toArray());
  const directories = useLiveQuery(() => db.directories.toArray());

  const handleRescan = async () => {
    const dirs = await db.directories.toArray();
    for (const dir of dirs) {
      try {
        await scanDirectory(dir.id);
      } catch (err) {
        console.error(`Failed to rescan ${dir.name}:`, err);
      }
    }
  };

  if (entries === undefined || directories === undefined) {
    return <div className="empty-state">Loading...</div>;
  }

  return (
    <div>
      <div className="library-header">
        <FolderPicker />
        {directories.length > 0 && (
          <button type="button" className="btn btn-secondary" onClick={handleRescan}>
            Rescan
          </button>
        )}
      </div>

      {directories.length === 0 && (
        <div className="empty-state">
          <p>No folders added yet.</p>
          <p style={{ marginTop: '0.5rem' }}>
            Click "Add Folder" to scan a directory for video files.
          </p>
        </div>
      )}

      {directories.length > 0 && entries.length === 0 && (
        <div className="empty-state">No video files found in added folders.</div>
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
