import React, { useEffect, useRef, useState, useCallback } from "react";
import { get, post } from "../api";
import { useAutoRefresh } from "../hooks/useWebSocket";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Music, ExternalLink, Loader2 } from "lucide-react";

interface SpotifyAuthProps {
  onLinked?: () => void;
}

export function SpotifyAuth({ onLinked }: SpotifyAuthProps = {}) {
  const [authState, setAuthState] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await get("/api/spotify/status");
      setAuthState(data.authState);
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useAutoRefresh(["spotify.auth.status"], refresh);

  const prevStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = authState?.status;
    if (
      onLinked &&
      status === "linked" &&
      prevStatusRef.current !== undefined &&
      prevStatusRef.current !== "linked"
    ) {
      onLinked();
    }
    prevStatusRef.current = status;
  }, [authState?.status, onLinked]);

  const startAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await post("/api/spotify/authorize");
      setAuthState(data.authState);

      if (data.authState?.status === "polling" && data.authState.verificationUri) {
        const url = data.authState.verificationUri +
          (data.authState.userCode ? `?code=${data.authState.userCode}` : "");
        window.open(url, "_blank");
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  const cancel = async () => {
    await post("/api/spotify/cancel");
    refresh();
  };

  const disconnect = async () => {
    await post("/api/spotify/disconnect");
    refresh();
  };

  return (
    <div>
      <div className="mb-10">
        <h2 className="text-3xl font-semibold tracking-tight text-fg">
          Spotify
        </h2>
        <p className="mt-2 text-secondary">
          Link your Spotify account to control playback on your Car Thing.
        </p>
      </div>

      {authState?.status === "linked" && (
        <Card>
          <CardContent>
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-xl bg-success/10">
                  <Music className="size-6 text-success" />
                </div>
                <div>
                  <p className="text-lg font-medium text-fg">Connected to Spotify</p>
                  <p className="text-sm text-secondary">{authState.displayName ?? "Spotify User"}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={disconnect}>
                Disconnect
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {authState?.status === "polling" && (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center py-6 text-center">
              <h3 className="mb-4 text-lg font-medium text-fg">Waiting for Spotify Authorization</h3>
              <p className="mb-2 text-sm text-secondary">
                A browser tab should have opened automatically.
              </p>
              <p className="mb-6 text-sm text-secondary">
                If not,{" "}
                <a
                  href={`${authState.verificationUri}?code=${authState.userCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent transition hover:text-accent/80"
                >
                  open Spotify authorization
                  <ExternalLink className="size-3" />
                </a>
              </p>
              <div className="mb-6 flex items-center gap-2 text-xs text-muted">
                <div className="size-1.5 animate-pulse rounded-full bg-accent" />
                Waiting for authorization...
              </div>
              <Button variant="outline" size="sm" onClick={cancel}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {authState?.status === "loading" && (
        <Card>
          <CardContent>
            <div className="flex items-center justify-center gap-3 py-8">
              <Loader2 className="size-5 animate-spin text-muted" />
              <p className="text-secondary">Starting authorization...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {(!authState || authState.status === "idle") && (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center py-8 text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-success/10">
                <Music className="size-7 text-success" />
              </div>
              <h3 className="text-lg font-medium text-fg">Link your Spotify account</h3>
              <p className="mt-1.5 mb-6 max-w-sm text-sm text-secondary">
                Connect your Spotify account to enable playback control on your Car Thing.
              </p>
              <Button
                className="bg-success text-bg hover:bg-success/90"
                size="lg"
                onClick={startAuth}
                disabled={loading}
              >
                {loading ? "Starting..." : "Link Spotify"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </div>
  );
}
