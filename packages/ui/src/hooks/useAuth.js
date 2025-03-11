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

  const pollingIntervalRef = useRef(null);
  const refreshTimerRef = useRef(null);

  useEffect(() => {
    const checkAndRefreshToken = async () => {
      const storedAccessToken = localStorage.getItem("spotifyAccessToken");
      const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");
      const expiryTimeStr = localStorage.getItem("spotifyTokenExpiry");

      if (storedAccessToken && storedRefreshToken && expiryTimeStr) {
        const expiryTime = new Date(expiryTimeStr);
        const now = new Date();
        const timeUntilExpiry = expiryTime.getTime() - now.getTime();

        if (timeUntilExpiry < 300000) {
          try {
            const refreshData = await refreshAccessToken(storedRefreshToken);

            localStorage.setItem(
              "spotifyAccessToken",
              refreshData.access_token
            );
            if (refreshData.refresh_token) {
              localStorage.setItem(
                "spotifyRefreshToken",
                refreshData.refresh_token
              );
            }

            const newExpiryDate = new Date();
            newExpiryDate.setSeconds(
              newExpiryDate.getSeconds() + refreshData.expires_in
            );
            localStorage.setItem(
              "spotifyTokenExpiry",
              newExpiryDate.toISOString()
            );

            setAccessToken(refreshData.access_token);
            setRefreshToken(refreshData.refresh_token || storedRefreshToken);
            setIsAuthenticated(true);

            const newTimeUntilExpiry = refreshData.expires_in * 1000;
            refreshTimerRef.current = setTimeout(
              checkAndRefreshToken,
              newTimeUntilExpiry - 300000
            );
          } catch (error) {
            console.error("Token refresh failed:", error);
            logout();
          }
        } else {
          setAccessToken(storedAccessToken);
          setRefreshToken(storedRefreshToken);
          setIsAuthenticated(true);

          if (refreshTimerRef.current) {
            clearTimeout(refreshTimerRef.current);
          }
          refreshTimerRef.current = setTimeout(
            checkAndRefreshToken,
            timeUntilExpiry - 300000
          );
        }
      }

      setIsLoading(false);
    };

    checkAndRefreshToken();

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
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

  const logout = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    localStorage.removeItem("spotifyAccessToken");
    localStorage.removeItem("spotifyRefreshToken");
    localStorage.removeItem("spotifyTokenExpiry");
    localStorage.removeItem("spotifyAuthType");

    setAccessToken(null);
    setRefreshToken(null);
    setIsAuthenticated(false);
    setAuthData(null);
  }, []);

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
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
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
    logout,
  };
}
