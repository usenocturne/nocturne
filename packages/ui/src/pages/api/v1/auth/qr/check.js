import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.query;

  if (!session_id) {
    return res.status(400).json({ error: 'Missing session ID' });
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
      return res.status(500).json({ error: 'Failed to check status' });
    }

    if (!data) {
      return res.status(200).json({ 
        status: 'pending',
        authCompleted: false,
        exists: false
      });
    }

    return res.status(200).json({
      status: data.auth_completed ? 'complete' : 'pending',
      tempId: data.temp_id,
      authCompleted: !!data.auth_completed,
      exists: true
    });

  } catch (error) {
    console.error('Error checking status:', error);
    return res.status(200).json({ 
      status: 'pending',
      authCompleted: false,
      error: error.message 
    });
  }
}