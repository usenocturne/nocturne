export async function oauthAuthorize() {
  try {
    const response = await fetch("https://accounts.spotify.com/oauth2/device/authorize", {
      method: "POST",
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'Spotify/125700463 Win32_x86_64/0 (PC desktop)',
        'accept-language': 'en-Latn-US,en-US;q=0.9,en-Latn;q=0.8,en;q=0.7',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-dest': 'empty'
      },
      body: new URLSearchParams({
        client_id: "65b708073fc0480ea92a077233ca87bd",
        creation_point: "https://login.app.spotify.com/?client_id=65b708073fc0480ea92a077233ca87bd&utm_source=spotify&utm_medium=desktop-win32&utm_campaign=organic",
        intent: "login",
        scope: "app-remote-control,playlist-modify,playlist-modify-private,playlist-modify-public,playlist-read,playlist-read-collaborative,playlist-read-private,streaming,ugc-image-upload,user-follow-modify,user-follow-read,user-library-modify,user-library-read,user-modify,user-modify-playback-state,user-modify-private,user-personalized,user-read-birthdate,user-read-currently-playing,user-read-email,user-read-play-history,user-read-playback-position,user-read-playback-state,user-read-private,user-read-recently-played,user-top-read",
      }).toString()
    });

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
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'Spotify/125700463 Win32_x86_64/0 (PC desktop)',
        'accept-language': 'en-Latn-US,en-US;q=0.9,en-Latn;q=0.8,en;q=0.7',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-dest': 'empty'
      },
      body: new URLSearchParams({
        client_id: "65b708073fc0480ea92a077233ca87bd",
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }).toString()
    });

    if (!response.ok) {
      throw new Error("Failed to check auth status");
    }

    return await response.json();
  } catch (error) {
    console.error("Error checking auth status:", error);
    throw error;
  }
}
