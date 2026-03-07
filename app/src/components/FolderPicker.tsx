import { addDirectory, scanDirectory } from '../scan';

export function FolderPicker() {
  const handlePick = async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      const id = await addDirectory(handle);
      await scanDirectory(id);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Failed to add directory:', err);
    }
  };

  if (!('showDirectoryPicker' in window)) {
    return (
      <div className="empty-state">
        <p>Folder picker requires a Chromium-based browser (Chrome, Edge).</p>
      </div>
    );
  }

  return (
    <button type="button" className="btn btn-primary" onClick={handlePick}>
      Add Folder
    </button>
  );
}
