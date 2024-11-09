import { encrypt } from '../../lib/cryptoUtils';
import { createClient } from '@supabase/supabase-js';
export const runtime = 'edge';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { 'Allow': ['POST'] }
    });
  }

  try {
    const { clientId, clientSecret, tempId } = await req.json();

    if (!clientId || !clientSecret || !tempId) {
      return new Response(
        JSON.stringify({ error: 'All fields are required' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const encryptedSecret = await encrypt(clientSecret);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { error } = await supabase
      .from('spotify_credentials')
      .insert([
        {
          client_id: clientId,
          encrypted_client_secret: encryptedSecret,
          temp_id: tempId,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        }
      ]);

    if (error) {
      if (error.message.includes('duplicate key')) {
        return new Response(
          JSON.stringify({ error: 'ID already in use' }), 
          { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
      throw error;
    }

    return new Response(
      JSON.stringify({ success: true }), 
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Validation error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to validate credentials' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}