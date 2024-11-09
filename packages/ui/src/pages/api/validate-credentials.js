import { URLSearchParams } from "url";
export const runtime = 'experimental-edge';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { clientId, clientSecret } = req.body;

  try {
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: params,
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ 
        error: data.error_description || data.error || 'Invalid credentials'
      });
    }

    return res.status(200).json({ valid: true });

  } catch (error) {
    return res.status(500).json({ error: 'Failed to validate credentials' });
  }
}