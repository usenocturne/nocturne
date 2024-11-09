import { supabase } from '../../lib/supabaseClient';
export const runtime = 'edge';

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { 
        'Allow': ['GET'],
        'Content-Type': 'application/json'
      }
    });
  }

  const url = new URL(req.url);
  const temp_id = url.searchParams.get('temp_id');

  if (!temp_id) {
    return new Response(
      JSON.stringify({ error: 'temp_id is required' }), 
      { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    const { data, error } = await supabase
      .from('spotify_credentials')
      .select('created_at, last_used')
      .eq('temp_id', temp_id)
      .order('last_used', { ascending: false });

    if (error) {
      throw error;
    }

    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const validData = data.filter(d => d.last_used && d.created_at);
    
    const stats = {
      totalDevices: data.length,
      activeLastHour: data.filter(d => 
        d.last_used && new Date(d.last_used) > new Date(hourAgo)
      ).length,
      activeLastDay: data.filter(d => 
        d.last_used && new Date(d.last_used) > new Date(dayAgo)
      ).length,
      avgUptimeHours: validData.length > 0 ? 
        validData.map(d => 
          Math.max(0, (new Date(d.last_used) - new Date(d.created_at)) / (1000 * 60 * 60))
        ).reduce((a, b) => a + b, 0) / validData.length : 0,
      longestOfflineDevice: validData.length > 0 ?
        Math.max(...validData.map(d => 
          (now - new Date(d.last_used).getTime()) / (1000 * 60 * 60)
        )) : 0,
    };

    const formattedStats = {
      ...stats,
      avgUptimeHours: Math.round(stats.avgUptimeHours * 100) / 100,
      longestOfflineDevice: Math.round(stats.longestOfflineDevice * 100) / 100
    };

    return new Response(
      JSON.stringify(formattedStats), 
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Stats error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch stats' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}