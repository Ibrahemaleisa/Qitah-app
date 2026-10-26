import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Calls `fn` when the screen gains focus and then every `ms` while it stays focused and the app is
 * in the foreground. Used for order tracking (plain refetch every 15s).
 */
export function usePollWhileFocused(fn: () => unknown, ms = 15_000, enabled = true) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const run = () => {
        try {
          Promise.resolve(ref.current()).catch(() => {});
        } catch {
          // ignore
        }
      };
      run();
      const t = setInterval(() => {
        if (AppState.currentState === 'active') run();
      }, ms);
      const sub = AppState.addEventListener('change', (st) => {
        if (st === 'active') run();
      });
      return () => {
        clearInterval(t);
        sub.remove();
      };
    }, [ms, enabled]),
  );
}
