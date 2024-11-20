import { encrypt } from '@/lib/cryptoUtils';
import { createClient } from '@supabase/supabase-js';
export const runtime = 'experimental-edge';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { 'Allow': ['POST'] }
    });
  }

  try {
    console.log('Environment check:', {
      hasEncryptionKey: !!process.env.ENCRYPTION_KEY,
      hasEncryptionIv: !!process.env.ENCRYPTION_IV,
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasSupabaseKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    });

    const body = await req.json();
    const { clientId, clientSecret, tempId, isPhoneAuth } = body;

    console.log('Request validation:', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      hasTempId: !!tempId,
      isPhoneAuth: !!isPhoneAuth
    });

    if (!clientId || !clientSecret) {
      console.log('Missing required credentials:', {
        missingClientId: !clientId,
        missingClientSecret: !clientSecret
      });
      return new Response(
        JSON.stringify({ error: 'Client ID and Client Secret are required' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (!isPhoneAuth && !tempId) {
      console.log('Missing tempId for non-phone auth');
      return new Response(
        JSON.stringify({ error: 'Temp ID is required for this authentication method' }), 
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

    if (isPhoneAuth) {
      return new Response(
        JSON.stringify({ success: true }), 
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Step: Initializing Supabase');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    console.log('Step: Starting encryption');
    let encryptedSecret;
    try {
      encryptedSecret = await encrypt(clientSecret);
      console.log('Encryption completed');
    } catch (encryptError) {
      console.error('Encryption failed:', {
        errorType: encryptError.constructor.name,
      });
      throw new Error('Failed to encrypt credentials');
    }

    console.log('Step: Checking for existing tempId');
    const { data: existingRecord, error: checkError } = await supabase
      .from('spotify_credentials')
      .select('id')
      .eq('temp_id', tempId)
      .single();

    if (checkError) {
      console.error('Database check error:', {
        code: checkError.code,
      });
    }

    if (existingRecord) {
      console.log('Found duplicate tempId');
      return new Response(
        JSON.stringify({ error: 'This ID is already in use' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Step: Storing credentials');
    const { error: insertError } = await supabase
      .from('spotify_credentials')
      .insert({
        client_id: clientId,
        encrypted_client_secret: encryptedSecret,
        temp_id: tempId,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      });

    if (insertError) {
      console.error('Database insert error:', {
        code: insertError.code,
      });
      throw new Error('Failed to store credentials');
    }

    console.log('Credentials stored successfully');
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