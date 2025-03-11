import { useState, useEffect, useCallback, useRef } from "react";
import {
  oauthAuthorize,
  checkAuthStatus,
  refreshAccessToken as refreshToken,
} from "../services/authService";

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authData, setAuthData] = useState(null);
  const [error, setError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const pollingIntervalRef = useRef(null);
  const refreshIntervalRef = useRef(null);
  const retryTimeoutRef = useRef(null);

  useEffect(() => {
    const storedAccessToken = localStorage.getItem("spotifyAccessToken");
    const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");

    if (storedAccessToken && storedRefreshToken) {
      setAccessToken(storedAccessToken);
      setRefreshToken(storedRefreshToken);
      setIsAuthenticated(true);
    }

    setIsLoading(false);
  }, []);

  const refreshAccessToken = useCallback(async () => {
    if (!refreshToken || isRefreshing) return null;

    try {
      setIsRefreshing(true);
      const data = await refreshToken(refreshToken);

      if (data?.access_token) {
        localStorage.setItem("spotifyAccessToken", data.access_token);

        const expiryDate = new Date();
        expiryDate.setSeconds(expiryDate.getSeconds() + data.expires_in);
        localStorage.setItem("spotifyTokenExpiry", expiryDate.toISOString());

        setAccessToken(data.access_token);

        if (data.refresh_token) {
          localStorage.setItem("spotifyRefreshToken", data.refresh_token);
          setRefreshToken(data.refresh_token);
        }

        return data;
      }
      return null;
    } catch (error) {
      console.error("Error refreshing token:", error);

      if (error.message && error.message.includes("invalid_grant")) {
        clearSession();
      } else {
        retryTimeoutRef.current = setTimeout(() => {
          refreshAccessToken();
        }, 3000);
      }

      return null;
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshToken]);

  useEffect(() => {
    if (!accessToken || !refreshToken) return;

    const scheduleTokenRefresh = async () => {
      if (isRefreshing) return;

      try {
        const tokenExpiry = localStorage.getItem("spotifyTokenExpiry");

        if (!tokenExpiry) {
          await refreshAccessToken();
          return;
        }

        const expiryTime = new Date(tokenExpiry);
        const currentTime = new Date();
        const fiveMinutesFromNow = new Date(currentTime.getTime() + 5 * 60000);

        if (expiryTime <= fiveMinutesFromNow) {
          await refreshAccessToken();
        }
      } catch (error) {
        console.error("Error scheduling token refresh:", error);
      }
    };

    scheduleTokenRefresh();

    refreshIntervalRef.current = setInterval(
      scheduleTokenRefresh,
      5 * 60 * 1000
    );

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [accessToken, refreshToken, refreshAccessToken, isRefreshing]);

  const clearSession = useCallback(() => {
    const authItems = [
      "spotifyAccessToken",
      "spotifyRefreshToken",
      "spotifyTokenExpiry",
      "spotifyAuthType",
    ];

    authItems.forEach((item) => localStorage.removeItem(item));

    setAccessToken(null);
    setRefreshToken(null);
    setIsAuthenticated(false);
    setAuthData(null);

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const initAuth = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const auth = await oauthAuthorize();
      setAuthData(auth);

      return auth;
    } catch (error) {
      setError("Failed to initialize authentication");
      console.error("Auth initialization failed:", error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const pollAuthStatus = useCallback(
    (deviceCode) => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }

      const intervalTime = (authData?.interval || 5) * 1000;

      const poll = async () => {
        try {
          const data = await checkAuthStatus(deviceCode);

          if (data.access_token) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;

            localStorage.setItem("spotifyAccessToken", data.access_token);
            localStorage.setItem("spotifyRefreshToken", data.refresh_token);
            localStorage.setItem("spotifyAuthType", "spotify");

            const expiryDate = new Date();
            expiryDate.setSeconds(expiryDate.getSeconds() + data.expires_in);
            localStorage.setItem(
              "spotifyTokenExpiry",
              expiryDate.toISOString()
            );

            setAccessToken(data.access_token);
            setRefreshToken(data.refresh_token);
            setIsAuthenticated(true);

            window.dispatchEvent(new Event("storage"));
          }
        } catch (error) {}
      };

      pollingIntervalRef.current = setInterval(poll, intervalTime);

      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      };
    },
    [authData]
  );

  useEffect(() => {
    const handleStorageChange = () => {
      const storedAccessToken = localStorage.getItem("spotifyAccessToken");
      const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");

      if (storedAccessToken && storedRefreshToken) {
        setAccessToken(storedAccessToken);
        setRefreshToken(storedRefreshToken);
        setIsAuthenticated(true);
      } else {
        setAccessToken(null);
        setRefreshToken(null);
        setIsAuthenticated(false);
      }
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (accessToken && refreshToken) {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
    }
  }, [accessToken, refreshToken]);

  return {
    isAuthenticated,
    accessToken,
    refreshToken,
    isLoading,
    authData,
    error,
    initAuth,
    pollAuthStatus,
    refreshAccessToken,
    clearSession,
    logout: clearSession,
  };
}
