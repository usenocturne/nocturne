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
    const { code, tempId, isCustomAuth } = await req.json();

    if (!code) {
      return new Response(
        JSON.stringify({ error: 'Authorization code is required' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    let useClientId, useClientSecret;

    if (isCustomAuth && tempId) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      );

      const { data: credentials, error } = await supabase
        .from('spotify_credentials')
        .select('client_id, encrypted_client_secret')
        .eq('temp_id', tempId)
        .maybeSingle();
        
      if (error) {
        if (error.message.includes('rate limit exceeded')) {
          return new Response(
            JSON.stringify({ error: 'Too many requests. Please try again later.' }), 
            { 
              status: 429,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        console.error('Error fetching credentials:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to get custom credentials' }), 
          { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    
      if (!credentials) {
        return new Response(
          JSON.stringify({ error: 'Credentials not found or expired' }), 
          { 
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      useClientId = credentials.client_id;
      try {
        useClientSecret = await decrypt(credentials.encrypted_client_secret);
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
      useClientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
      useClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    }

    if (!useClientId || !useClientSecret) {
      console.error('Missing credentials:', { 
        hasClientId: !!useClientId, 
        hasClientSecret: !!useClientSecret 
      });
      return new Response(
        JSON.stringify({ error: 'Missing credentials' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_REDIRECT_URI;
    params.append("redirect_uri", origin);

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
      return new Response(JSON.stringify(data), { 
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (isCustomAuth && data.refresh_token) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      );
    
      const { error: cleanupError } = await supabase
        .from('spotify_credentials')
        .delete()
        .eq('temp_id', tempId)
        .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (cleanupError) {
        console.error('Error cleaning up old records:', cleanupError);
      }

      const { data: existingRecord, error: fetchError } = await supabase
        .from('spotify_credentials')
        .select('token_refresh_count, first_used_at, created_at')
        .eq('temp_id', tempId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
    
      if (fetchError && !fetchError.message.includes('No rows found')) {
        console.error('Error fetching existing record:', fetchError);
      }

      const encryptedSecret = await encrypt(useClientSecret);

      const { error: updateError } = await supabase
        .from('spotify_credentials')
        .update({
          refresh_token: data.refresh_token,
          encrypted_client_secret: encryptedSecret,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          last_used: new Date().toISOString(),
          first_used_at: existingRecord?.first_used_at || new Date().toISOString(),
          token_refresh_count: (existingRecord?.token_refresh_count || 0) + 1,
          user_agent: req.headers.get('user-agent') || null
        })
        .eq('temp_id', tempId)
        .eq('created_at', existingRecord?.created_at);
    
      if (updateError) {
        console.error('Error updating credentials:', updateError);
      }
    }

    return new Response(
      JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        isCustomAuth
      }), 
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Token exchange error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch access token' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}