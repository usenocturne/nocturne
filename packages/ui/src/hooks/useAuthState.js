import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";

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

    if (existingAuthType && existingRefreshToken) {
      return {
        authSelectionMade: true,
        authType: existingAuthType,
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
  const [authState, setAuthState] = useState(initialAuthState);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [authCode, setAuthCode] = useState(null);

  const handleAuthSelection = useCallback(async (selection) => {
    if (!selection) return;

    const batchUpdates = () => {
      setAuthState({
        authSelectionMade: true,
        authType: selection.type,
      });

      if (selection.authCode) {
        setAuthCode(selection.authCode);
      }
    };

    if (typeof window !== "undefined" && window.ReactDOM) {
      window.ReactDOM.unstable_batchedUpdates(batchUpdates);
    } else {
      batchUpdates();
    }
  }, []);

  const clearSession = useCallback(async () => {
    try {
      const authItems = [
        "spotifyAccessToken",
        "spotifyRefreshToken",
        "spotifyTokenExpiry",
        "spotifyAuthType",
      ];
      authItems.forEach((item) => localStorage.removeItem(item));

      const batchUpdates = () => {
        setAccessToken(null);
        setRefreshToken(null);
        setAuthState({
          authSelectionMade: false,
          authType: null,
        });
      };

      if (typeof window !== "undefined" && window.ReactDOM) {
        window.ReactDOM.unstable_batchedUpdates(batchUpdates);
      } else {
        batchUpdates();
      }
    } catch (error) {
      console.error("Error during session cleanup:", error);
      throw error;
    }
  }, []);

  const refreshAccessToken = useCallback(async () => {
    try {
      const currentRefreshToken = localStorage.getItem("spotifyRefreshToken");

      const params = new URLSearchParams();
      params.append("grant_type", "refresh_token");
      params.append("refresh_token", currentRefreshToken);
      params.append("client_id", "65b708073fc0480ea92a077233ca87bd");

      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      const batchUpdates = () => {
        setAccessToken(data.access_token);
        if (data.refresh_token) {
          setRefreshToken(data.refresh_token);
          localStorage.setItem("spotifyRefreshToken", data.refresh_token);
        }
      };

      if (typeof window !== "undefined" && window.ReactDOM) {
        window.ReactDOM.unstable_batchedUpdates(batchUpdates);
      } else {
        batchUpdates();
      }

      return data;
    } catch (error) {
      console.error("Error refreshing token:", error);
      throw error;
    }
  }, []);

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
    refreshAccessToken,
    clearSession,
  };
}
