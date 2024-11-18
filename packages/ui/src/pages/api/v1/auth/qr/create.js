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
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const sessionId = crypto.randomUUID();
    
    const { error } = await supabase
      .from('qr_sessions')
      .insert({
        session_id: sessionId,
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      });

    if (error) {
      throw new Error('Failed to create QR session');
    }

    return new Response(
      JSON.stringify({ sessionId }), 
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}