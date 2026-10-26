import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { TokenPair } from './types';

/**
 * Access/refresh token storage.
 *
 * - iOS/Android: `expo-secure-store` (Keychain / Keystore-backed).
 * - Web: expo-secure-store has no web implementation. We fall back to AsyncStorage, which on web is
 *   `localStorage`. That is NOT secret storage (any script on the origin can read it); it is an
 *   accepted trade-off for the web preview only. Tokens are also cached in memory so reads are sync
 *   after the first load.
 */

const KEY = 'qitah.auth.tokens.v1';

export type StoredTokens = { accessToken: string; refreshToken: string; accessExpiresAt: number };

let memory: StoredTokens | null | undefined; // undefined = not loaded yet

const useSecureStore = Platform.OS === 'ios' || Platform.OS === 'android';

async function readRaw(): Promise<string | null> {
  try {
    return useSecureStore ? await SecureStore.getItemAsync(KEY) : await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

async function writeRaw(value: string | null): Promise<void> {
  try {
    if (useSecureStore) {
      if (value == null) await SecureStore.deleteItemAsync(KEY);
      else await SecureStore.setItemAsync(KEY, value);
    } else if (value == null) {
      await AsyncStorage.removeItem(KEY);
    } else {
      await AsyncStorage.setItem(KEY, value);
    }
  } catch {
    // Storage failures leave the in-memory session usable for this app run.
  }
}

export async function loadTokens(): Promise<StoredTokens | null> {
  if (memory !== undefined) return memory;
  const raw = await readRaw();
  try {
    memory = raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    memory = null;
  }
  return memory;
}

export async function saveTokens(pair: TokenPair): Promise<StoredTokens> {
  const stored: StoredTokens = {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    // Refresh a little early to avoid racing the expiry on slow networks.
    accessExpiresAt: Date.now() + Math.max(0, pair.expiresIn - 30) * 1000,
  };
  memory = stored;
  await writeRaw(JSON.stringify(stored));
  return stored;
}

export async function clearTokens(): Promise<void> {
  memory = null;
  await writeRaw(null);
}

/** Test helper: forget the in-memory cache. */
export function resetTokenCacheForTests() {
  memory = undefined;
}
