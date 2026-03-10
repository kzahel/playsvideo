import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';

export function useSetting<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const entry = useLiveQuery(() => db.settings.get(key), [key]);
  const value = entry ? (entry.value as T) : defaultValue;

  const setValue = (newValue: T) => {
    db.settings.put({ key, value: newValue });
  };

  return [value, setValue];
}
