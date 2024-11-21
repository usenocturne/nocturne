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
    const { refresh_token, isCustomAuth } = await req.json();
    
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

    if (isCustomAuth) {
      const { error: cleanupError } = await supabase
        .from('spotify_credentials')
        .delete()
        .eq('refresh_token', refresh_token)
        .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (cleanupError) {
        console.error('Error cleaning up old records:', cleanupError);
      }

      const { data: credentials, error: fetchError } = await supabase
        .from('spotify_credentials')
        .select('client_id, encrypted_client_secret, temp_id')
        .eq('refresh_token', refresh_token)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (fetchError || !credentials) {
        console.error('Error fetching custom credentials:', fetchError);
        return new Response(
          JSON.stringify({ error: 'Custom credentials not found' }), 
          { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

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
      
      const tempId = credentials.temp_id;
      req.tempId = tempId;
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
      return new Response(JSON.stringify(data), { 
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (isCustomAuth && data.refresh_token) {
      const { data: oldRecord } = await supabase
        .from('spotify_credentials')
        .select('token_refresh_count, first_used_at')
        .eq('refresh_token', refresh_token)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      const encryptedSecret = await encrypt(clientSecret);

      const { error: updateError } = await supabase
        .from('spotify_credentials')
        .update({
          refresh_token: data.refresh_token,
          encrypted_client_secret: encryptedSecret,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          last_used: new Date().toISOString(),
          first_used_at: oldRecord?.first_used_at || new Date().toISOString(),
          token_refresh_count: (oldRecord?.token_refresh_count || 0) + 1,
          user_agent: req.headers.get('user-agent') || null
        })
        .eq('temp_id', req.tempId)
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