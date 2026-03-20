import { db } from './db.js';
import { isExtension } from './context.js';

const DEVICE_ID_KEY = 'device-id';
const DEVICE_LABEL_KEY = 'device-label';

let cachedDeviceId: string | null = null;

export function generateDeviceLabel(): string {
  const ua = navigator.userAgent;
  const parts: string[] = [];

  // Platform
  if (/Android/i.test(ua)) parts.push('Android');
  else if (/iPhone|iPad|iPod/i.test(ua)) parts.push('iOS');
  else if (/Mac/i.test(ua)) parts.push('Mac');
  else if (/Windows/i.test(ua)) parts.push('Windows');
  else if (/Linux/i.test(ua)) parts.push('Linux');
  else if (/CrOS/i.test(ua)) parts.push('ChromeOS');

  // Browser
  if (isExtension()) parts.push('Extension');
  else if (/Edg\//i.test(ua)) parts.push('Edge');
  else if (/Firefox\//i.test(ua)) parts.push('Firefox');
  else if (/Chrome\//i.test(ua)) parts.push('Chrome');
  else if (/Safari\//i.test(ua)) parts.push('Safari');

  return parts.join(' · ') || 'Unknown Device';
}

/** Ensure a device ID exists in the DB. Call once at startup (outside liveQuery). */
export async function ensureDeviceId(): Promise<void> {
  if (cachedDeviceId) return;

  const stored = await db.settings.get(DEVICE_ID_KEY);
  if (stored?.value) {
    cachedDeviceId = stored.value as string;
    return;
  }

  const id = crypto.randomUUID();
  const label = generateDeviceLabel();
  await db.settings.bulkPut([
    { key: DEVICE_ID_KEY, value: id },
    { key: DEVICE_LABEL_KEY, value: label },
  ]);
  cachedDeviceId = id;
}

/** Read-only — safe to call inside liveQuery. Requires ensureDeviceId() to have run first. */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  const stored = await db.settings.get(DEVICE_ID_KEY);
  if (stored?.value) {
    cachedDeviceId = stored.value as string;
    return cachedDeviceId;
  }

  // Fallback: should not normally reach here if ensureDeviceId ran at startup
  throw new Error('Device ID not initialized — call ensureDeviceId() first');
}

export async function getDeviceLabel(): Promise<string> {
  const stored = await db.settings.get(DEVICE_LABEL_KEY);
  return (stored?.value as string) ?? generateDeviceLabel();
}
