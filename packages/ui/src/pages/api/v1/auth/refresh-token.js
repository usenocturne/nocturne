export const runtime = "experimental-edge";

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: ["POST"] },
    });
  }

  try {
    const { refresh_token, isCustomAuth } = await req.json();

    if (!refresh_token) {
      console.error("Missing refresh token");
      return new Response(
        JSON.stringify({ error: "Refresh token is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    let clientId;

    if (isCustomAuth) {
      clientId = localStorage.getItem("spotifyClientId");
      clientSecret = localStorage.getItem("spotifyClientSecret");

      if (!clientId || !clientSecret) {
        return new Response(
          JSON.stringify({ error: "Custom credentials not found" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    } else {
      clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
      clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    }

    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refresh_token);

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Spotify token refresh failed:", {
        status: response.status,
        error: data,
      });
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Unhandled error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to refresh access token",
        details: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
