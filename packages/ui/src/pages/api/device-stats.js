import { supabase } from '../../lib/supabaseClient';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { data, error } = await supabase
      .from('spotify_credentials')
      .select('*')
      .order('last_used', { ascending: false });

    if (error) {
      throw error;
    }

    const stats = {
      totalDevices: data.length,
      activeLastHour: data.filter(d => 
        new Date(d.last_used) > new Date(Date.now() - 60 * 60 * 1000)
      ).length,
      activeLastDay: data.filter(d => 
        new Date(d.last_used) > new Date(Date.now() - 24 * 60 * 60 * 1000)
      ).length,
      avgUptimeHours: data.map(d => 
        (new Date(d.last_used) - new Date(d.created_at)) / (1000 * 60 * 60)
      ).reduce((a, b) => a + b, 0) / data.length,
      longestOfflineDevice: Math.max(...data.map(d => 
        Date.now() - new Date(d.last_used).getTime()
      )) / (1000 * 60 * 60),
    };

    return res.status(200).json(stats);

  } catch (error) {
    console.error('Stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
}