import { createClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/cryptoUtils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { clientId, clientSecret, sessionId } = req.body;

    if (!clientId || !clientSecret || !sessionId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const tempId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');

    let encryptedSecret;
    try {
      encryptedSecret = await encrypt(clientSecret);
    } catch (encryptError) {
      console.error('Encryption failed:', encryptError);
      return res.status(500).json({ error: 'Failed to encrypt credentials' });
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
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        }
      ]);

    if (insertError) {
      console.error('Error storing credentials:', insertError);
      return res.status(500).json({ error: 'Failed to store credentials' });
    }

    return res.status(200).json({ tempId, clientId });

  } catch (error) {
    console.error('Error storing credentials:', error);
    return res.status(500).json({ error: 'Failed to store credentials' });
  }
}