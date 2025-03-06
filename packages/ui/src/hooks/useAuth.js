import { useState, useEffect, useCallback, useRef } from "react";
import {
  oauthAuthorize,
  checkAuthStatus,
  refreshAccessToken,
} from "../services/authService";

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authData, setAuthData] = useState(null);
  const [error, setError] = useState(null);

  const isInitializedRef = useRef(false);
  const pollingIntervalRef = useRef(null);

  useEffect(() => {
    const storedAccessToken = localStorage.getItem("spotifyAccessToken");
    const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");
    const tokenExpiry = localStorage.getItem("spotifyTokenExpiry");

    if (storedAccessToken && storedRefreshToken) {
      setAccessToken(storedAccessToken);
      setRefreshToken(storedRefreshToken);

      const isExpired = tokenExpiry && new Date(tokenExpiry) <= new Date();

      if (isExpired) {
        handleRefreshToken(storedRefreshToken);
      } else {
        setIsAuthenticated(true);
      }
    }

    setIsLoading(false);
  }, []);

  const handleRefreshToken = async (token) => {
    try {
      setIsLoading(true);
      const data = await refreshAccessToken(token);

      setAccessToken(data.access_token);
      localStorage.setItem("spotifyAccessToken", data.access_token);

      if (data.refresh_token) {
        setRefreshToken(data.refresh_token);
        localStorage.setItem("spotifyRefreshToken", data.refresh_token);
      }

      const expiryDate = new Date();
      expiryDate.setSeconds(expiryDate.getSeconds() + data.expires_in);
      localStorage.setItem("spotifyTokenExpiry", expiryDate.toISOString());

      setIsAuthenticated(true);
    } catch (error) {
      console.error("Token refresh failed:", error);
      setError("Failed to refresh authentication token");
      logout();
    } finally {
      setIsLoading(false);
    }
  };

  const initAuth = useCallback(async () => {
    if (isInitializedRef.current || authData) return authData;

    try {
      setIsLoading(true);
      setError(null);

      const auth = await oauthAuthorize();
      setAuthData(auth);
      isInitializedRef.current = true;

      return auth;
    } catch (error) {
      setError("Failed to initialize authentication");
      console.error("Auth initialization failed:", error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [authData]);

  const pollAuthStatus = useCallback(
    (deviceCode) => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }

      if (isAuthenticated) {
        return;
      }

      const intervalTime = (authData?.interval || 5) * 1000;

      const poll = async () => {
        try {
          if (isAuthenticated) {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            return;
          }

          const data = await checkAuthStatus(deviceCode);

          if (data.access_token) {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }

            setAccessToken(data.access_token);
            setRefreshToken(data.refresh_token);

            localStorage.setItem("spotifyAccessToken", data.access_token);
            localStorage.setItem("spotifyRefreshToken", data.refresh_token);
            localStorage.setItem("spotifyAuthType", "spotify");

            const expiryDate = new Date();
            expiryDate.setSeconds(expiryDate.getSeconds() + data.expires_in);
            localStorage.setItem(
              "spotifyTokenExpiry",
              expiryDate.toISOString()
            );

            setIsAuthenticated(true);
          }
        } catch (error) {
          if (!isAuthenticated) {
            console.log("Polling status...");
          }
        }
      };

      pollingIntervalRef.current = setInterval(poll, intervalTime);

      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      };
    },
    [authData, isAuthenticated]
  );

  const logout = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    localStorage.removeItem("spotifyAccessToken");
    localStorage.removeItem("spotifyRefreshToken");
    localStorage.removeItem("spotifyTokenExpiry");
    localStorage.removeItem("spotifyAuthType");

    setAccessToken(null);
    setRefreshToken(null);
    setIsAuthenticated(false);
    setAuthData(null);
    isInitializedRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated && pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, [isAuthenticated]);

  return {
    isAuthenticated,
    accessToken,
    refreshToken,
    isLoading,
    authData,
    error,
    initAuth,
    pollAuthStatus,
    logout,
    handleRefreshToken,
  };
}
