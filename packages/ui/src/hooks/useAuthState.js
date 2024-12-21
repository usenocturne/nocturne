import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import ReactDOM from "react-dom";
import PhoneAuthResult from "@/components/auth/phone/PhoneAuthResult";

const initialAuthState = () => {
  if (typeof window === "undefined") {
    return {
      authSelectionMade: false,
      authType: null,
    };
  }

  try {
    const existingAuthType = localStorage.getItem("spotifyAuthType");
    const existingRefreshToken = localStorage.getItem("spotifyRefreshToken");
    const existingTempId = localStorage.getItem("spotifyTempId");

    if (existingAuthType && existingRefreshToken) {
      return {
        authSelectionMade: true,
        authType: existingAuthType,
        tempId: existingTempId,
      };
    }
  } catch (e) {
    console.error("Error accessing localStorage:", e);
  }

  return {
    authSelectionMade: false,
    authType: null,
  };
};

export function useAuthState() {
  const router = useRouter();
  const [authState, setAuthState] = useState(initialAuthState);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [authCode, setAuthCode] = useState(null);

  const handlePhoneAuth = async (code, sessionId, tempId) => {
    try {
      const tokenResponse = await fetch("/api/v1/auth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          isPhoneAuth: true,
          sessionId,
          tempId,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error("Token exchange failed");
      }

      const tokenData = await tokenResponse.json();

      const { error: updateError } = await supabase
        .from("spotify_credentials")
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expiry: new Date(
            Date.now() + tokenData.expires_in * 1000
          ).toISOString(),
          auth_completed: true,
          first_used_at: new Date().toISOString(),
          last_used: new Date().toISOString(),
        })
        .eq("session_id", sessionId);

      if (updateError) {
        throw new Error("Failed to store tokens");
      }

      setAccessToken(tokenData.access_token);
      setRefreshToken(tokenData.refresh_token);
      setAuthState({
        authSelectionMade: true,
        authType: "custom",
        tempId: tempId,
      });

      const root = document.getElementById("__next");
      if (root) {
        ReactDOM.render(<PhoneAuthResult status="success" />, root);
      }
    } catch (error) {
      const root = document.getElementById("__next");
      if (root) {
        ReactDOM.render(
          <PhoneAuthResult status="error" error={error.message} />,
          root
        );
      }
    }
  };

  const handleAuthSelection = async (selection) => {
    const newState = {
      authSelectionMade: true,
      authType: selection.type,
    };
    setAuthState(newState);

    if (selection.accessToken) {
      setAccessToken(selection.accessToken);
    }
    if (selection.refreshToken) {
      setRefreshToken(selection.refreshToken);
    }
  };

  const refreshAccessToken = async () => {
    try {
      const currentRefreshToken = localStorage.getItem("spotifyRefreshToken");
      const currentAuthType = localStorage.getItem("spotifyAuthType");
      const currentTempId = localStorage.getItem("spotifyTempId");

      const response = await fetch("/api/v1/auth/refresh-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          refresh_token: currentRefreshToken,
          isCustomAuth: currentAuthType === "custom",
          tempId: currentTempId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      setAccessToken(data.access_token);
      if (data.refresh_token) {
        setRefreshToken(data.refresh_token);
        localStorage.setItem("spotifyRefreshToken", data.refresh_token);
      }

      return data;
    } catch (error) {
      throw error;
    }
  };

  const clearSession = async () => {
    try {
      const refreshToken = localStorage.getItem("spotifyRefreshToken");
      const tempId = localStorage.getItem("spotifyTempId");
      const authType = localStorage.getItem("spotifyAuthType");

      if (authType === "custom" && refreshToken && tempId) {
        await supabase.from("spotify_credentials").delete().match({
          temp_id: tempId,
          refresh_token: refreshToken,
        });
      }

      const authItems = [
        "spotifyAccessToken",
        "spotifyRefreshToken",
        "spotifyTokenExpiry",
        "spotifyAuthType",
        "spotifyTempId",
        "spotifySessionId",
      ];
      authItems.forEach((item) => localStorage.removeItem(item));

      setAccessToken(null);
      setRefreshToken(null);
      setAuthState({
        authSelectionMade: false,
        authType: null,
      });
    } catch (error) {
      console.error("Error during session cleanup:", error);
      throw error;
    }
  };

  const redirectToSpotify = () => {
    const scopes = [
      "user-read-recently-played",
      "user-read-private",
      "user-top-read",
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-currently-playing",
      "user-library-read",
      "user-library-modify",
      "playlist-read-private",
      "playlist-read-collaborative",
      "playlist-modify-public",
      "playlist-modify-private",
    ].join(" ");

    const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
    const urlParams = new URLSearchParams(window.location.search);
    const phoneSession = urlParams.get("session");
    const isPhoneAuth = !!phoneSession;

    if (!clientId) {
      throw new Error("No client ID available");
    }

    const state = isPhoneAuth
      ? encodeURIComponent(
          JSON.stringify({
            phoneAuth: true,
            sessionId: phoneSession,
          })
        )
      : undefined;

    const authUrl = new URL("https://accounts.spotify.com/authorize");
    authUrl.searchParams.append("client_id", clientId);
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append(
      "redirect_uri",
      process.env.NEXT_PUBLIC_REDIRECT_URI
    );
    authUrl.searchParams.append("scope", scopes);
    if (state) {
      authUrl.searchParams.append("state", state);
    }

    window.location.href = authUrl.toString();
  };

  return {
    authState,
    setAuthState,
    accessToken,
    setAccessToken,
    refreshToken,
    setRefreshToken,
    authCode,
    setAuthCode,
    handleAuthSelection,
    handlePhoneAuth,
    refreshAccessToken,
    clearSession,
    redirectToSpotify,
  };
}
