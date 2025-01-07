import { useState, useEffect } from "react";
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
    const existingTempId = localStorage.getItem("spotifyTempId");

    if (existingAuthType && existingRefreshToken) {
      return {
        authSelectionMade: true,
        authType: existingAuthType,
        tempId: existingTempId,
      };
    }

    const clientId = localStorage.getItem("spotifyClientId");
    const clientSecret = localStorage.getItem("spotifyClientSecret");

    if (clientId && clientSecret) {
      return {
        authSelectionMade: true,
        authType: "custom",
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

  const handleAuthSelection = async (selection) => {
    const newState = {
      authSelectionMade: true,
      authType: selection.type,
      deviceId: selection.deviceId
    };
    
    setAuthState(newState);

    if (selection.authCode) {
      setAuthCode(selection.authCode);
    }
  };

  useEffect(() => {
    const handleCodeExchange = async () => {
      if (authCode && authState.deviceId) {
        try {
          await exchangeCodeForToken(authCode, authState.deviceId);
        } catch (error) {
          console.error("Token exchange failed:", error);
        }
      }
    };

    handleCodeExchange();
  }, [authCode, authState.deviceId]);

  const exchangeCodeForToken = async (code, deviceId) => {
    try {
      const clientId = localStorage.getItem("spotifyClientId");
      const clientSecret = localStorage.getItem("spotifyClientSecret");

      if (!clientId || !clientSecret) {
        throw new Error("Missing credentials");
      }

      const params = new URLSearchParams();
      params.append("grant_type", "authorization_code");
      params.append("code", code);
      params.append("redirect_uri", process.env.NEXT_PUBLIC_REDIRECT_URI);

      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Token exchange error response:", errorData);
        throw new Error(`Token exchange failed: ${errorData.error}`);
      }

      const data = await response.json();
      
      setAccessToken(data.access_token);
      setRefreshToken(data.refresh_token);
      
      localStorage.setItem("spotifyAccessToken", data.access_token);
      localStorage.setItem("spotifyRefreshToken", data.refresh_token);
      localStorage.setItem("spotifyTokenExpiry", new Date(Date.now() + data.expires_in * 1000).toISOString());
      localStorage.setItem("spotifyAuthType", "custom");

      return data;
    } catch (error) {
      console.error("Error in exchangeCodeForToken:", error);
      throw error;
    }
  };

  const clearSession = async () => {
    try {
      const authItems = [
        "spotifyAccessToken",
        "spotifyRefreshToken",
        "spotifyTokenExpiry",
        "spotifyAuthType",
        "spotifyClientId",
        "spotifyClientSecret"
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

  const refreshAccessToken = async () => {
    try {
      const clientId = localStorage.getItem("spotifyClientId");
      const clientSecret = localStorage.getItem("spotifyClientSecret");
      const currentRefreshToken = localStorage.getItem("spotifyRefreshToken");

      const params = new URLSearchParams();
      params.append("grant_type", "refresh_token");
      params.append("refresh_token", currentRefreshToken);

      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
        },
        body: params.toString(),
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
      console.error("Error refreshing token:", error);
      throw error;
    }
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
    refreshAccessToken,
    clearSession,
    exchangeCodeForToken
  };
}