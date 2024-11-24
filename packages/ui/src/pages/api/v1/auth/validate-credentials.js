export const runtime = 'experimental-edge';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { 'Allow': ['POST'] }
    });
  }

  try {
    const { clientId, clientSecret, isPhoneAuth } = await req.json();

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ error: 'Client ID and Client Secret are required' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (!isPhoneAuth) {
      return new Response(
        JSON.stringify({ error: 'Only phone authentication is supported' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    try {
      const spotifyResponse = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(clientId + ':' + clientSecret)
        },
        body: 'grant_type=client_credentials'
      });

      if (!spotifyResponse.ok) {
        return new Response(
          JSON.stringify({ error: 'Invalid Spotify credentials' }), 
          { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    } catch (spotifyError) {
      console.error('Spotify validation error:', spotifyError);
      return new Response(
        JSON.stringify({ error: 'Failed to validate with Spotify' }), 
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true }), 
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Operation failed:', {
      step: error.step || 'unknown',
      type: error.constructor.name,
    });
    return new Response(
      JSON.stringify({ error: 'Failed to validate credentials' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}