import { useCallback, useEffect, useState } from 'react';
import { api, setUnauthHandler } from './api';
import type { AppState, TvStatus } from './types';

export interface UseApp {
  state: AppState | null;
  needAuth: boolean;
  needsSetup: boolean;
  loading: boolean;
  refetch: () => Promise<void>;
  onAuthed: () => void;
}

export function useAppState(): UseApp {
  const [state, setState] = useState<AppState | null>(null);
  const [needAuth, setNeedAuth] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
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
    setUnauthHandler(async () => {
      try {
        const s = await api.session();
        if (s.needsSetup) setNeedsSetup(true);
        else setNeedAuth(true);
      } catch {
        setNeedAuth(true);
      }
      setLoading(false);
    });
    void refetch();
  }, [refetch]);

  // Live updates over WebSocket.
  useEffect(() => {
    if (needAuth || needsSetup) return;
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
  }, [needAuth, needsSetup, refetch]);

  const onAuthed = useCallback(() => {
    setNeedAuth(false);
    setNeedsSetup(false);
    setLoading(true);
    void refetch();
  }, [refetch]);

  return { state, needAuth, needsSetup, loading, refetch, onAuthed };
}
