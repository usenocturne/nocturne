import { supabase } from '@/lib/supabaseClient';
import { encrypt, decrypt } from '@/lib/cryptoUtils';
export const runtime = 'experimental-edge';
import packageInfo from '../../../../../package.json';

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
      console.error('Missing refresh token');
      return new Response(
        JSON.stringify({ error: 'Refresh token is required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    let clientId, clientSecret, tempId;

    if (isCustomAuth) {
      if (!supabase) {
        console.error('Supabase client not initialized');
        return new Response(
          JSON.stringify({ error: 'Database connection error' }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      try {
        const { data: credentials, error: fetchError } = await supabase
          .from('spotify_credentials')
          .select('*')
          .eq('refresh_token', refresh_token)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (fetchError || !credentials) {
          console.error('Error fetching credentials:', {
            error: fetchError,
            hasCredentials: !!credentials,
            refreshToken: refresh_token.substring(0, 10) + '...'
          });
          return new Response(
            JSON.stringify({ error: 'Custom credentials not found' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        clientId = credentials.client_id;
        tempId = credentials.temp_id;

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
      } catch (dbError) {
        console.error('Database operation error:', dbError);
        return new Response(
          JSON.stringify({ error: 'Database operation failed' }),
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
      console.error('Spotify token refresh failed:', {
        status: response.status,
        error: data,
        clientIdPrefix: clientId.substring(0, 10) + '...'
      });
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (isCustomAuth) {
      const { data: oldRecord } = await supabase
        .from('spotify_credentials')
        .select('token_refresh_count, first_used_at')
        .eq('refresh_token', refresh_token)
        .single();

      const encryptedSecret = await encrypt(clientSecret);
      const now = new Date();
      const tokenExpiry = new Date(now.getTime() + (data.expires_in * 1000));
      const expiresAt = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

      const updatePayload = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || refresh_token,
        encrypted_client_secret: encryptedSecret,
        expires_at: expiresAt.toISOString(),
        token_expiry: tokenExpiry.toISOString(),
        last_used: now.toISOString(),
        first_used_at: oldRecord?.first_used_at || now.toISOString(),
        token_refresh_count: (oldRecord?.token_refresh_count || 0) + 1,
        user_agent: req.headers.get('user-agent') || null,
        version: packageInfo.version
      };

      const { data: updatedRecord, error: updateError } = await supabase
        .from('spotify_credentials')
        .update(updatePayload)
        .eq('temp_id', tempId)
        .eq('refresh_token', refresh_token)
        .select()
        .single();

      if (updateError) {
        console.error('Failed to update Supabase:', {
          error: updateError,
          tempId,
          refreshToken: refresh_token.substring(0, 10) + '...'
        });
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
    console.error('Unhandled error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to refresh access token',
        details: error.message,
        stack: error.stack
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}