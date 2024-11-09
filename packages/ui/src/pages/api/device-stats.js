import { supabase } from '../../lib/supabaseClient';
export const runtime = 'experimental-edge';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { temp_id } = req.query;

  if (!temp_id) {
    return res.status(400).json({ error: 'temp_id is required' });
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

    return res.status(200).json({
      ...stats,
      avgUptimeHours: Math.round(stats.avgUptimeHours * 100) / 100,
      longestOfflineDevice: Math.round(stats.longestOfflineDevice * 100) / 100
    });

  } catch (error) {
    console.error('Stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
}