import { setFolder } from '../scan.js';
import { isExtension } from '../context.js';

export function FolderPicker() {
  const handlePick = async () => {
    try {
      await setFolder();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Failed to add directory:', err);
    }
  };

  return (
    <button type="button" className="btn btn-primary" onClick={handlePick}>
      {isExtension() ? 'Add Folder' : 'Select Folder'}
    </button>
  );
}
