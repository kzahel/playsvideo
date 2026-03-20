import { setFolder } from '../scan.js';
import { isExtension } from '../context.js';

interface FolderPickerProps {
  label?: string;
}

export function FolderPicker({ label }: FolderPickerProps) {
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
      {label ?? (isExtension() ? 'Add Folder' : 'Select Folder')}
    </button>
  );
}
