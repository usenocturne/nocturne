import { URLSearchParams } from "url";
import { supabase } from '../../lib/supabaseClient';
export const runtime = 'nodejs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(Method `${req.method} Not Allowed`);
  }

  const { code, tempId, isCustomAuth } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Authorization code is required' });
  }

  let useClientId, useClientSecret;

  try {
    if (isCustomAuth && tempId) {
      const { data: credentials, error } = await supabase
        .from('spotify_credentials')
        .select('client_id, client_secret')
        .eq('temp_id', tempId)
        .maybeSingle();
        
      if (error) {
        if (error.message.includes('rate limit exceeded')) {
          return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }
        console.error('Error fetching credentials:', error);
        return res.status(400).json({ error: 'Failed to get custom credentials' });
      }
    
      if (!credentials) {
        return res.status(404).json({ error: 'Credentials not found or expired' });
      }

      useClientId = credentials.client_id;
      useClientSecret = credentials.client_secret;

    } else {
      useClientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
      useClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    }

    if (!useClientId || !useClientSecret) {
      console.error('Missing credentials:', { 
        hasClientId: !!useClientId, 
        hasClientSecret: !!useClientSecret 
      });
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", process.env.NEXT_PUBLIC_REDIRECT_URI);

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${useClientId}:${useClientSecret}`).toString('base64'),
      },
      body: params,
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    if (isCustomAuth) {
      const { error: updateError } = await supabase
        .from('spotify_credentials')
        .update({
          refresh_token: data.refresh_token,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          last_used: new Date().toISOString(),
          first_used_at: new Date().toISOString(),
          user_agent: req.headers['user-agent'] || null
        })
        .eq('temp_id', tempId);

      if (updateError) {
        console.error('Error updating credentials:', updateError);
      }
    }

    return res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      isCustomAuth
    });

  } catch (error) {
    console.error('Token exchange error:', error);
    return res.status(500).json({ error: 'Failed to fetch access token' });
  }
}