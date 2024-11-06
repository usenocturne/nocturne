import { URLSearchParams } from "url";
import { supabase } from '../../lib/supabaseClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(Method `${req.method} Not Allowed`);
  }

  const { refresh_token, isCustomAuth } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  try {
    let clientId, clientSecret;

    if (isCustomAuth) {
      const { data: credentials, error: fetchError } = await supabase
        .from('spotify_credentials')
        .select('client_id, client_secret')
        .eq('refresh_token', refresh_token)
        .single();

      if (fetchError || !credentials) {
        console.error('Error fetching custom credentials:', fetchError);
        return res.status(400).json({ error: 'Custom credentials not found' });
      }

      clientId = credentials.client_id;
      clientSecret = credentials.client_secret;
    } else {
      clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
      clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    }

    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refresh_token);
    params.append("client_id", clientId);

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    if (isCustomAuth && data.refresh_token) {
      const { data: oldRecord } = await supabase
        .from('spotify_credentials')
        .select('token_refresh_count, first_used_at')
        .eq('refresh_token', refresh_token)
        .single();
    
      const { error: insertError } = await supabase
        .from('spotify_credentials')
        .insert({
          refresh_token: data.refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          last_used: new Date().toISOString(),
          first_used_at: oldRecord?.first_used_at || new Date().toISOString(),
          token_refresh_count: (oldRecord?.token_refresh_count || 0) + 1,
          user_agent: req.headers['user-agent'] || null
        });

      if (insertError) {
        console.error('Error storing new credentials:', insertError);
      }
    }

    return res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({ error: 'Failed to refresh access token' });
  }
}
