import { useState, useEffect, useCallback } from "react";
import { connectWebSocket, subscribe, onConnectionChange, isConnected as wsIsConnected } from "../ws";

export function useEvent<T = any>(topic: string, handler: (data: T) => void) {
  useEffect(() => {
    connectWebSocket();
    return subscribe(topic, handler);
  }, [topic, handler]);
}

export function useWsConnection() {
  const [connected, setConnected] = useState(wsIsConnected());

  useEffect(() => {
    connectWebSocket();
    return onConnectionChange(setConnected);
  }, []);

  return connected;
}

export function useAutoRefresh(topics: string[], refreshFn: () => void) {
  useEffect(() => {
    connectWebSocket();
    const unsubs = topics.map((topic) =>
      subscribe(topic, () => refreshFn())
    );
    return () => unsubs.forEach((u) => u());
  }, [topics.join(","), refreshFn]);
}
