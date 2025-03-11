const SPOTIFY_CLIENT_ID = "65b708073fc0480ea92a077233ca87bd";

export async function oauthAuthorize() {
  try {
    const response = await fetch(
      "https://accounts.spotify.com/oauth2/device/authorize",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Spotify/125700463 Win32_x86_64/0 (PC desktop)",
          "accept-language": "en-Latn-US,en-US;q=0.9,en-Latn;q=0.8,en;q=0.7",
        },
        body: new URLSearchParams({
          client_id: SPOTIFY_CLIENT_ID,
          creation_point:
            "https://login.app.spotify.com/?client_id=65b708073fc0480ea92a077233ca87bd&utm_source=spotify&utm_medium=desktop-win32&utm_campaign=organic",
          intent: "login",
          scope:
            "app-remote-control,playlist-modify,playlist-modify-private,playlist-modify-public,playlist-read,playlist-read-collaborative,playlist-read-private,streaming,ugc-image-upload,user-follow-modify,user-follow-read,user-library-modify,user-library-read,user-modify,user-modify-playback-state,user-modify-private,user-personalized,user-read-birthdate,user-read-currently-playing,user-read-email,user-read-play-history,user-read-playback-position,user-read-playback-state,user-read-private,user-read-recently-played,user-top-read",
        }).toString(),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to authorize oauth2 device");
    }

    return await response.json();
  } catch (error) {
    console.error("Error authorizing oauth2 device:", error);
    throw error;
  }
}

export async function checkAuthStatus(deviceCode) {
  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }).toString(),
    });

    if (response.status === 400) {
      const errorData = await response.json();
      if (errorData.error === "authorization_pending") {
        return {};
      }

      throw new Error(errorData.error_description || "Authorization failed");
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (!error.message.includes("authorization_pending")) {
      throw error;
    }

    return {};
  }
}

export async function refreshAccessToken(refreshToken) {
  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: SPOTIFY_CLIENT_ID,
      }).toString(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error_description || `HTTP error! status: ${response.status}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error("Error refreshing token:", error);
    throw error;
  }
}
