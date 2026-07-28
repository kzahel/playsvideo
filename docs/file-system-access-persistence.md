# File System Access API — Permission Persistence by Platform

The app uses the File System Access API (`showDirectoryPicker`) to access local video folders. The `FileSystemDirectoryHandle` is stored in IndexedDB and survives page reloads, but **permission** behavior varies by platform.

## How It Works

1. User picks a folder via `showDirectoryPicker()` → returns a `FileSystemDirectoryHandle`
2. Handle is stored in IndexedDB (`directories` table, `handle` field)
3. On next visit, the handle is still in IDB — no need to re-pick the folder
4. But the browser may require the user to re-grant read permission via `handle.requestPermission()`

## Platform Behavior

| Platform | Handle persists | Permission persists | User experience |
|---|---|---|---|
| ChromeOS MV3 extension | Yes (IDB) | Yes, after choosing "Allow on every visit" | Pick once, then grant persistent access once |
| Desktop Chrome (installed PWA) | Yes (IDB) | Yes — "allow all the time" option | Best: silent access after initial grant |
| Desktop Chrome (website) | Yes (IDB) | Per-session — must click "allow" | Must re-grant each session |
| Mobile Chrome (installed PWA) | Yes (IDB) | Per-session — must tap "allow" | No "allow all the time" option available |
| Mobile Chrome (website) | Yes (IDB) | Per-session — must tap "allow" | Same as mobile PWA |
| Firefox / Safari | N/A — falls back to `<input webkitdirectory>` | None — files are in-memory only | Must re-pick folder every session |

### Validated ChromeOS extension flow

Tested with an unpacked MV3 extension on ChromeOS 150:

1. Choose the media folder and accept the initial "view and copy files" confirmation.
2. The directory handle is stored in IndexedDB, but reopening the extension initially reports
   `queryPermission({ mode: 'read' }) === 'prompt'`.
3. Click **Grant File Access** and choose **Allow on every visit** in Chrome's permission dialog.
4. Permission then remains `granted` across extension-page close/reopen and
   `chrome.runtime.reload()`.

The extension can keep using the standard File System Access API. Legacy Chrome App filesystem
or media-gallery APIs are not required for this flow.

## Key Takeaways

- On ChromeOS, the MV3 extension supports persistent access after the explicit
  **Allow on every visit** grant.
- On mobile Chrome, PWA vs regular website makes **no difference** for folder persistence. Both require tapping "allow" every session.
- On desktop Chrome, installing as a PWA unlocks the "allow all the time" persistent permission.
- The `FileSystemDirectoryHandle` always persists in IndexedDB (on Chromium). The bottleneck is the permission grant, not the handle.
- Eliminating the mobile permission prompt entirely would require a native app wrapper (Capacitor, Tauri) using native filesystem APIs (e.g., Android's `takePersistableUriPermission()`).

## Code References

- `app/src/folder-provider.ts` — `FsAccessProvider` (Chromium) vs `WebkitDirectoryProvider` (fallback)
- `app/src/folder-provider.ts:102` — `ensurePermission()` checks and requests permission on the stored handle
- `app/src/db.ts:70` — `DirectoryEntry.handle` stores the `FileSystemDirectoryHandle` in IDB
