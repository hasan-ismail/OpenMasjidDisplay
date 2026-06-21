import { useCallback, useEffect, useState } from 'react';
import { api, setUnauthHandler } from './api';
import type { AppState, TvStatus } from './types';

export interface UseApp {
  state: AppState | null;
  needAuth: boolean;
  loading: boolean;
  refetch: () => Promise<void>;
  onAuthed: () => void;
}

export function useAppState(): UseApp {
  const [state, setState] = useState<AppState | null>(null);
  const [needAuth, setNeedAuth] = useState(false);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const s = await api.state();
      setState(s);
      setNeedAuth(false);
    } catch {
      /* 401 handled by the unauth handler */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthHandler(() => {
      setNeedAuth(true);
      setLoading(false);
    });
    void refetch();
  }, [refetch]);

  // Live updates over WebSocket.
  useEffect(() => {
    if (needAuth) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { type: string; data: unknown };
          if (msg.type === 'state') void refetch();
          else if (msg.type === 'status') {
            setState((s) => (s ? { ...s, statuses: msg.data as TvStatus[] } : s));
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [needAuth, refetch]);

  const onAuthed = useCallback(() => {
    setNeedAuth(false);
    setLoading(true);
    void refetch();
  }, [refetch]);

  return { state, needAuth, loading, refetch, onAuthed };
}
