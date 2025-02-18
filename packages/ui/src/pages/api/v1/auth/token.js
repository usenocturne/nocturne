export const runtime = "experimental-edge";

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: ["POST"] },
    });
  }

  try {
    const body = await req.json();
    const { code } = body;

    if (!code) {
      console.error("Missing authorization code");
      return new Response(
        JSON.stringify({ error: "Authorization code is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error("Missing credentials");
      return new Response(
        JSON.stringify({ error: "Invalid credentials configuration" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
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

    const data = await response.json();

    if (!response.ok) {
      console.error("Spotify token exchange failed:", data);
      return new Response(
        JSON.stringify({
          error: "Token exchange failed",
          spotifyError: data.error,
          spotifyErrorDescription: data.error_description,
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        token_type: data.token_type,
        scope: data.scope,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("Unhandled token exchange error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to process token exchange",
        details: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
