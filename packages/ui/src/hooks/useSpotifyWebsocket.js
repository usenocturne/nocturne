import { useState, useEffect, useRef } from "react";

export function useSpotifyWebSocket(accessToken) {
  const [currentPlayback, setCurrentPlayback] = useState(null);
  const webSocketRef = useRef(null);
  const connectionIdRef = useRef(null);
  const pingIntervalRef = useRef(null);

  useEffect(() => {
    if (!accessToken) return;

    if (webSocketRef.current) {
      webSocketRef.current.close();
    }

    webSocketRef.current = new WebSocket(
      `wss://dealer.spotify.com/?access_token=${accessToken}`
    );

    webSocketRef.current.onopen = () => {
      console.log("WebSocket connection established");

      pingIntervalRef.current = setInterval(() => {
        if (webSocketRef.current?.readyState === WebSocket.OPEN) {
          webSocketRef.current.send(JSON.stringify({ type: "ping" }));
        }
      }, 30000);
    };

    webSocketRef.current.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.headers && message.headers["Spotify-Connection-Id"]) {
        connectionIdRef.current = message.headers["Spotify-Connection-Id"];

        registerForPlayerStateUpdates();
      }

      if (message.type === "message" && message.payloads) {
        for (const payload of message.payloads) {
          if (payload.events) {
            for (const eventData of payload.events) {
              if (
                eventData.type === "PLAYER_STATE_CHANGED" &&
                eventData.event?.state
              ) {
                setCurrentPlayback(eventData.event.state);
              }
            }
          }
        }
      }
    };

    const registerForPlayerStateUpdates = async () => {
      if (!connectionIdRef.current) return;

      try {
        const url = `https://api.spotify.com/v1/me/notifications/player?connection_id=${encodeURIComponent(
          connectionIdRef.current
        )}`;

        await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });

        const response = await fetch("https://api.spotify.com/v1/me/player", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (response.status !== 204) {
          const data = await response.json();
          setCurrentPlayback(data);
        }
      } catch (error) {
        console.error("Error registering for player updates:", error);
      }
    };

    webSocketRef.current.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    webSocketRef.current.onclose = () => {
      console.log("WebSocket connection closed");
    };

    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }

      if (webSocketRef.current) {
        webSocketRef.current.close();
      }
    };
  }, [accessToken]);

  return { currentPlayback };
}
