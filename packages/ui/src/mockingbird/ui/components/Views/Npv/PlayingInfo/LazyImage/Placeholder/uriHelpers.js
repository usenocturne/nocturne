export const URITypeMap = {
  TRACK: "track",
  ALBUM: "album",
  ARTIST: "artist",
  PLAYLIST: "playlist",
  SHOW: "show",
  EPISODE: "episode",
  STATION: "station",
  COLLECTION: "collection",
};

export const parseURI = (uri) => {
  if (!uri || typeof uri !== "string") return null;

  const parts = uri.split(":");
  if (parts.length < 3 || parts[0] !== "spotify") return null;

  return {
    type: parts[1],
    id: parts[2],
  };
};

export const isLikedSongsURI = (uri) => {
  return uri && uri.includes("collection:your-music");
};
