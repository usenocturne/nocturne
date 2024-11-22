import { createClient } from '@supabase/supabase-js';
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
    const body = await req.json();

    const { code, tempId, isCustomAuth, isPhoneAuth, sessionId } = body;

    if (!code) {
      console.error('Missing authorization code');
      return new Response(
        JSON.stringify({ error: 'Authorization code is required' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let useClientId, useClientSecret;
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    
    const query = supabase
      .from('spotify_credentials')
      .select('client_id, encrypted_client_secret, temp_id');

    if (isPhoneAuth && sessionId) {
      query.eq('session_id', sessionId);
    } else if ((isCustomAuth || isPhoneAuth) && tempId) {
      query.eq('temp_id', tempId);
    } else {
      useClientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
      useClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    }

    if (!useClientId || !useClientSecret) {
      const { data: credentials, error: credentialsError } = await query.maybeSingle();
      
      if (credentialsError) {
        console.error('Database query error:', credentialsError);
        return new Response(
          JSON.stringify({ error: 'Failed to get credentials', details: credentialsError.message }), 
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    
      if (!credentials) {
        console.error('No credentials found in database');
        return new Response(
          JSON.stringify({ error: 'Credentials not found or expired' }), 
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      useClientId = credentials.client_id;
      try {
        useClientSecret = await decrypt(credentials.encrypted_client_secret);
      } catch (decryptError) {
        console.error('Decryption error:', decryptError);
        return new Response(
          JSON.stringify({ error: 'Failed to decrypt credentials' }), 
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!useClientId || !useClientSecret) {
      console.error('Missing credentials after retrieval');
      return new Response(
        JSON.stringify({ error: 'Invalid credentials configuration' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
        Authorization: "Basic " + btoa(`${useClientId}:${useClientSecret}`),
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Spotify token exchange failed:', data);
      return new Response(
        JSON.stringify({ 
          error: 'Token exchange failed', 
          spotifyError: data.error,
          spotifyErrorDescription: data.error_description 
        }), 
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (isPhoneAuth && sessionId) {
      const { error: updateError } = await supabase
        .from('spotify_credentials')
        .update({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
          auth_completed: true,
          first_used_at: new Date().toISOString(),
          last_used: new Date().toISOString()
        })
        .eq('session_id', sessionId);

      if (updateError) {
        console.error('Error updating tokens in database:', updateError);
        return new Response(
          JSON.stringify({ error: 'Failed to store tokens', details: updateError.message }), 
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
    }

    if ((isCustomAuth || isPhoneAuth) && data.refresh_token) {
      try {
        const { error: cleanupError } = await supabase
          .from('spotify_credentials')
          .delete()
          .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .is('auth_completed', true);

        if (cleanupError) {
          console.error('Error during cleanup:', cleanupError);
        }
      } catch (cleanupError) {
        console.error('Error cleaning up old records:', cleanupError);
      }
    }

    return new Response(
      JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        token_type: data.token_type,
        scope: data.scope,
        isCustomAuth,
        isPhoneAuth
      }), 
      { 
        status: 200, 
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, must-revalidate'
        } 
      }
    );

  } catch (error) {
    console.error('Unhandled token exchange error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process token exchange',
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