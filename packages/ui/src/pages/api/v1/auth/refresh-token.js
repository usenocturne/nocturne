import { supabase } from '@/lib/supabaseClient';
import { encrypt, decrypt } from '@/lib/cryptoUtils';
export const runtime = 'experimental-edge';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { 'Allow': ['POST'] }
    });
  }

  try {
    const { refresh_token } = await req.json();
    
    if (!refresh_token) {
      return new Response(
        JSON.stringify({ error: 'Refresh token is required' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    let clientId, clientSecret;

    const { data: credentials, error: fetchError } = await supabase
      .from('spotify_credentials')
      .select('client_id, encrypted_client_secret')
      .eq('refresh_token', refresh_token)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (credentials) {
      clientId = credentials.client_id;
      try {
        clientSecret = await decrypt(credentials.encrypted_client_secret);
      } catch (decryptError) {
        console.error('Decryption error:', decryptError);
        return new Response(
          JSON.stringify({ error: 'Failed to decrypt credentials' }), 
          { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
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

    const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${authString}`,
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify(data), { 
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (credentials && data.refresh_token) {
      const { error: updateError } = await supabase
        .from('spotify_credentials')
        .update({
          refresh_token: data.refresh_token,
          last_used: new Date().toISOString(),
        })
        .eq('refresh_token', refresh_token);

      if (updateError) {
        console.error('Error updating credentials:', updateError);
      }
    }

    return new Response(
      JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in
      }), 
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Token refresh error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to refresh access token' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}