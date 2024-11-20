import { createClient } from '@supabase/supabase-js';
export const runtime = 'experimental-edge';

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }), 
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(req.url);
  const session_id = url.searchParams.get('session_id');

  if (!session_id) {
    return new Response(
      JSON.stringify({ error: 'Missing session ID' }), 
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase
      .from('spotify_credentials')
      .select('temp_id, auth_completed')
      .eq('session_id', session_id)
      .maybeSingle();

    if (error) {
      console.error('Database query error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to check status' }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!data) {
      return new Response(
        JSON.stringify({ 
          status: 'pending',
          authCompleted: false,
          exists: false
        }), 
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        status: data.auth_completed ? 'complete' : 'pending',
        tempId: data.temp_id,
        authCompleted: !!data.auth_completed,
        exists: true
      }), 
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error checking status:', error);
    return new Response(
      JSON.stringify({ 
        status: 'pending',
        authCompleted: false,
        error: error.message 
      }), 
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}