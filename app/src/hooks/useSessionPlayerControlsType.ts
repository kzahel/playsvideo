import { useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import {
  normalizePlayerControlsType,
  PLAYER_CONTROLS_TYPE_KEY,
  type PlayerControlsType,
} from '../settings.js';

const PLAYER_CONTROLS_PENDING = Symbol('player-controls-pending');

/**
 * Resolves the preference before playback begins, then freezes it for this
 * component lifetime. A settings update therefore applies to the next player
 * session instead of swapping media/control trees during active playback.
 */
export function useSessionPlayerControlsType(): PlayerControlsType | null {
  const storedSetting = useLiveQuery(
    () => db.settings.get(PLAYER_CONTROLS_TYPE_KEY),
    [],
    PLAYER_CONTROLS_PENDING,
  );
  const sessionControlsRef = useRef<PlayerControlsType | null>(null);

  if (sessionControlsRef.current === null && storedSetting !== PLAYER_CONTROLS_PENDING) {
    sessionControlsRef.current = normalizePlayerControlsType(storedSetting?.value);
  }

  return sessionControlsRef.current;
}
