"use client";

import { useEffect, useRef, useState } from "react";
import { buildLiveWsUrl } from "@/lib/live";
import type { LiveConnectionState, LiveMessage } from "@/lib/types";

type UseLiveFeedInput = {
  enabled: boolean;
  calendarId?: string;
  projectFeed?: boolean;
  onMessage: (message: LiveMessage) => void;
  onReconnectResync: () => void;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

function reconnectDelayMs(attempt: number): number {
  const base = Math.min(20_000, 1000 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

async function tryRefreshAuthSession(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function useLiveFeed({
  enabled,
  calendarId,
  projectFeed = true,
  onMessage,
  onReconnectResync,
}: UseLiveFeedInput): { connectionState: LiveConnectionState } {
  const [connectionStateInternal, setConnectionState] = useState<LiveConnectionState>("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const keepRunningRef = useRef(false);
  const openedOnceRef = useRef(false);
  const onMessageRef = useRef(onMessage);
  const onReconnectRef = useRef(onReconnectResync);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onReconnectRef.current = onReconnectResync;
  }, [onReconnectResync]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    keepRunningRef.current = true;
    openedOnceRef.current = false;
    reconnectAttemptRef.current = 0;

    const cleanupSocket = () => {
      if (socketRef.current) {
        const current = socketRef.current;
        socketRef.current = null;
        if (current.readyState === WebSocket.OPEN) {
          current.close();
        }
      }
    };

    const clearReconnect = () => {
      if (!reconnectTimerRef.current) return;
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    };

    const clearDisconnectStateTimer = () => {
      if (!disconnectStateTimerRef.current) return;
      clearTimeout(disconnectStateTimerRef.current);
      disconnectStateTimerRef.current = null;
    };

    const setDisconnectedWithGrace = () => {
      if (!openedOnceRef.current) return;
      clearDisconnectStateTimer();
      disconnectStateTimerRef.current = setTimeout(() => {
        if (!keepRunningRef.current) return;
        setConnectionState("disconnected");
      }, 4000);
    };

    const scheduleReconnect = () => {
      if (!keepRunningRef.current) return;
      clearReconnect();
      const delay = reconnectDelayMs(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
    };

    const connect = () => {
      if (!keepRunningRef.current) return;
      const existing = socketRef.current;
      if (existing && (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN)) {
        return;
      }
      setConnectionState("connecting");

      const socket = new WebSocket(buildLiveWsUrl({ calendarId, projectFeed }));
      socketRef.current = socket;

      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        clearDisconnectStateTimer();
        const wasReconnect = openedOnceRef.current;
        openedOnceRef.current = true;
        reconnectAttemptRef.current = 0;
        setConnectionState("connected");
        if (wasReconnect) {
          onReconnectRef.current();
        }
      };

      socket.onmessage = (event) => {
        if (socketRef.current !== socket) return;
        try {
          const parsed = JSON.parse(event.data) as LiveMessage;
          onMessageRef.current(parsed);
          if (parsed.type === "system.resync_required") {
            onReconnectRef.current();
          }
        } catch {
          onReconnectRef.current();
        }
      };

      socket.onerror = () => {
        // Let onclose handle reconnect policy.
      };

      socket.onclose = (event) => {
        if (socketRef.current !== socket) return;
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        if (!keepRunningRef.current) return;
        if (event.code === 4403) {
          setDisconnectedWithGrace();
          return;
        }
        if (event.code === 4401) {
          setConnectionState("connecting");
          void (async () => {
            const refreshed = await tryRefreshAuthSession();
            if (!keepRunningRef.current) return;
            if (refreshed) {
              reconnectAttemptRef.current = 0;
              connect();
              return;
            }
            setDisconnectedWithGrace();
          })();
          return;
        }
        setDisconnectedWithGrace();
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      keepRunningRef.current = false;
      clearReconnect();
      clearDisconnectStateTimer();
      cleanupSocket();
    };
  }, [enabled, calendarId, projectFeed]);

  return { connectionState: enabled ? connectionStateInternal : "disconnected" };
}
