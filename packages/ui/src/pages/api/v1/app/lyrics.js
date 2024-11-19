export const runtime = 'experimental-edge';

export default async function handler(req) {
  const url = new URL(req.url);
  const name = url.searchParams.get('name');
  const artist = url.searchParams.get('artist');

  if (!name || !artist) {
    return new Response(
      JSON.stringify({ error: 'Missing name or artist parameter' }), 
      { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  const encodedTrack = encodeURIComponent(name);
  const encodedArtist = encodeURIComponent(artist);
  const apiUrl = `https://lrclib.net/api/get?artist_name=${encodedArtist}&track_name=${encodedTrack}`;

  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    
    if (data && data.syncedLyrics) {
      return new Response(
        JSON.stringify({ lyrics: data.syncedLyrics }), 
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      return new Response(
        JSON.stringify({ error: 'Lyrics not found' }), 
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  } catch (error) {
    console.error("FETCH_LYRICS_ERROR:", error.message);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch lyrics' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}