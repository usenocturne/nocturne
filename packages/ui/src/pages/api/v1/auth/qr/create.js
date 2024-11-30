import { createClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/cryptoUtils';
export const runtime = 'experimental-edge';
import packageInfo from '../../../../../../package.json';
import { version } from 'react';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }), 
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.json();
    const { clientId, clientSecret, sessionId } = body;

    if (!clientId || !clientSecret || !sessionId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const tempId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');

    let encryptedSecret;
    try {
      encryptedSecret = await encrypt(clientSecret);
    } catch (encryptError) {
      console.error('Encryption failed:', encryptError);
      return new Response(
        JSON.stringify({ error: 'Failed to encrypt credentials' }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { error: insertError } = await supabase
      .from('spotify_credentials')
      .insert([
        {
          client_id: clientId,
          encrypted_client_secret: encryptedSecret,
          session_id: sessionId,
          temp_id: tempId,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          version: packageInfo.version
        }
      ]);

    if (insertError) {
      console.error('Error storing credentials:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to store credentials' }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ tempId, clientId }), 
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error storing credentials:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to store credentials' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}