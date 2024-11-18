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
    const body = await req.json();
    const { clientId, clientSecret, tempId, method = 'manual' } = body;

    if (!clientId || !clientSecret || !tempId) {
      return new Response(
        JSON.stringify({ error: 'All fields are required' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    let encryptedSecret;
    try {
      encryptedSecret = await encrypt(clientSecret);
    } catch (encryptError) {
      throw new Error('Failed to encrypt credentials');
    }

    const { data: existingRecord, error: checkError } = await supabase
      .from('spotify_credentials')
      .select('id')
      .eq('temp_id', tempId)
      .single();

    if (existingRecord) {
      return new Response(
        JSON.stringify({ error: 'This ID is already in use' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const { error: insertError } = await supabase
      .from('spotify_credentials')
      .insert({
        client_id: clientId,
        encrypted_client_secret: encryptedSecret,
        temp_id: tempId,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        method: method
      });

    if (insertError) {
      throw new Error('Failed to store credentials');
    }

    return new Response(
      JSON.stringify({ success: true }), 
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to validate credentials' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}