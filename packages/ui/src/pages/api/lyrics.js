import fetch from 'node-fetch';

export default async function handler(req, res) {
  const { name, artist } = req.query;

  if (!name || !artist) {
    return res.status(400).json({ error: 'Missing name or artist parameter' });
  }

  const encodedTrack = encodeURIComponent(name);
  const encodedArtist = encodeURIComponent(artist);
  const url = `https://lrclib.net/api/get?artist_name=${encodedArtist}&track_name=${encodedTrack}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data && data.syncedLyrics) {
      res.status(200).json({ lyrics: data.syncedLyrics });
    } else {
      res.status(404).json({ error: 'Lyrics not found' });
    }
  } catch (error) {
    console.error('Error fetching lyrics:', error);
    res.status(500).json({ error: 'Failed to fetch lyrics' });
  }
}