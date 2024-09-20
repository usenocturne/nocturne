import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import ColorThief from "color-thief-browser";

export default function Home() {
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [authCode, setAuthCode] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [artists, setArtists] = useState([]);
  const [topSongs, setTopSongs] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [albumImage, setAlbumImage] = useState(null);
  const [colors, setColors] = useState([]);
  const [albumName, setAlbumName] = useState("");
  const [artistName, setArtistName] = useState("");
  const [activeSection, setActiveSection] = useState("home");

  function generateCodeVerifier() {
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  async function generateCodeChallenge(codeVerifier) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(codeVerifier)
    );
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      const code = new URLSearchParams(window.location.search).get("code");
      setAuthCode(code);
    }
  }, []);

  useEffect(() => {
    if (authCode) {
      fetchAccessToken(authCode);
    } else if (
      typeof window !== "undefined" &&
      !window.location.search.includes("code")
    ) {
      redirectToSpotify();
    }
  }, [authCode]);

  useEffect(() => {
    if (accessToken) {
      const tokenRefreshInterval = setInterval(() => {
        refreshAccessToken();
      }, 3000 * 1000);

      return () => clearInterval(tokenRefreshInterval);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) {
      fetchRecentlyPlayedAlbums();
      fetchUserPlaylists();
      fetchTopArtists();
      fetchTopSongs();
      fetchRecommendations();
    }
  }, [accessToken]);

  useEffect(() => {
    if (albums.length > 0 && albums[0].images.length > 0) {
      const imageUrl = albums[0].images[0].url;
      localStorage.setItem("albumImage", imageUrl);
      setAlbumImage(imageUrl);
      setAlbumName(albums[0].name);
      setArtistName(albums[0].artists.map((artist) => artist.name).join(", "));
    }
  }, [albums]);

  const redirectToSpotify = async () => {
    const clientId = "";
    const redirectUri = "http://localhost:3000";
    const scopes = "user-read-recently-played user-read-private user-top-read";

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    localStorage.setItem("code_verifier", codeVerifier);

    window.location.href = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scopes}&code_challenge_method=S256&code_challenge=${codeChallenge}`;
  };

  const fetchAccessToken = async (code) => {
    const codeVerifier = localStorage.getItem("code_verifier");

    try {
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + btoa(":"),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          redirect_uri: "http://localhost:3000",
          code_verifier: codeVerifier,
        }),
      });

      const data = await response.json();
      setAccessToken(data.access_token);
      setRefreshToken(data.refresh_token);
    } catch (error) {
      console.error("Error fetching access token:", error);
    }
  };

  const refreshAccessToken = async () => {
    try {
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + btoa(":"),
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      const data = await response.json();
      setAccessToken(data.access_token);
    } catch (error) {
      console.error("Error refreshing access token:", error);
    }
  };

  const fetchRecentlyPlayedAlbums = async () => {
    try {
      const response = await fetch(
        "https://api.spotify.com/v1/me/player/recently-played",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      const data = await response.json();

      const uniqueAlbums = data.items.reduce((acc, item) => {
        const album = item.track.album;
        if (!acc.some((a) => a.id === album.id)) {
          acc.push(album);
        }
        return acc;
      }, []);

      setAlbums(uniqueAlbums);
    } catch (error) {
      console.error("Error fetching recently played albums:", error);
    }
  };

  const fetchUserPlaylists = async () => {
    try {
      const response = await fetch(
        "https://api.spotify.com/v1/browse/categories/0JQ5DAt0tbjZptfcdMSKl3/playlists",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      const data = await response.json();
      setPlaylists(data.playlists.items);
    } catch (error) {
      console.error("Error fetching user playlists:", error);
    }
  };

  const fetchTopArtists = async () => {
    try {
      const response = await fetch(
        "https://api.spotify.com/v1/me/top/artists",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      const data = await response.json();
      setArtists(data.items);
    } catch (error) {
      console.error("Error fetching top artists:", error);
    }
  };

  const fetchTopSongs = async () => {
    try {
      const response = await fetch("https://api.spotify.com/v1/me/top/tracks", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await response.json();
      setTopSongs(data.items);
    } catch (error) {
      console.error("Error fetching top songs:", error);
    }
  };

  const fetchRecommendations = async () => {
    try {
      const seedArtistId = artists.length > 0 ? artists[0].id : null;
      const seedTrackId = topSongs.length > 0 ? topSongs[0].id : null;

      const queryParams = new URLSearchParams({
        limit: 20,
        ...(seedArtistId && { seed_artists: seedArtistId }),
        ...(seedTrackId && { seed_tracks: seedTrackId }),
      });

      const response = await fetch(
        `https://api.spotify.com/v1/recommendations?${queryParams.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setRecommendations(data.tracks);
    } catch (error) {
      console.error("Error fetching recommendations:", error);
    }
  };

  const calculateBrightness = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };

  const calculateHue = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h;

    if (max === min) {
      h = 0;
    } else {
      const d = max - min;
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }
    return h * 360;
  };

  const extractColors = (imageUrl) => {
    const colorThief = new ColorThief();
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
      const palette = colorThief.getPalette(img, 8);
      const filteredColors = palette
        .map(
          (color) =>
            `#${color.map((c) => c.toString(16).padStart(2, "0")).join("")}`
        )
        .filter((color) => {
          const brightness = calculateBrightness(color);
          return brightness > 120 || brightness < 10;
        })
        .sort((a, b) => calculateHue(a) - calculateHue(b));

      setColors(filteredColors);
    };
  };

  const generateMeshGradient = (colors) => {
    if (colors.length === 0) return "#FFFFFF";

    const positions = ["at 0% 25%", "at 25% 0%", "at 100% 75%", "at 75% 100%"];

    const radialGradients = positions.map((position, index) => {
      const color = colors[index % colors.length];
      return `radial-gradient(${position}, ${color} 0%, transparent 80%)`;
    });

    return `${radialGradients.join(", ")}`;
  };

  useEffect(() => {
    if (albumImage) {
      extractColors(albumImage);
    }
  }, [albumImage]);

  return (
    <div className="relative min-h-screen">
      <div
        style={{
          backgroundColor: "#ff99ec",
          backgroundImage: generateMeshGradient(colors),
        }}
        className="absolute inset-0"
      ></div>
      <div className="relative z-10 pl-8 grid grid-cols-[1.5fr_3fr]">
        <Sidebar
          activeSection={activeSection}
          setActiveSection={setActiveSection}
        />

        <div className="flex overflow-x-auto scroll-container p-2">
          {activeSection === "home" &&
            albums.map((album) => (
              <div key={album.id} className="min-w-[280px] mr-10">
                <img
                  src={album.images[0]?.url}
                  alt="Album Cover"
                  className="mt-16 w-[280px] h-[280px] aspect-square rounded-[12px] drop-shadow-xl"
                />
                <h4 className="mt-2 text-[24px] font-medium text-white truncate max-w-[280px]">
                  {album.name}
                </h4>
                <h4 className="text-[20px] font-base text-white">
                  {album.artists.map((artist) => artist.name).join(", ")}
                </h4>
              </div>
            ))}
          {activeSection === "radio" &&
            playlists.map((playlist) => (
              <div key={playlist.id} className="min-w-[280px] mr-10">
                <img
                  src={playlist.images[0]?.url}
                  alt="Playlist Cover"
                  className="mt-16 w-[280px] h-[280px] aspect-square rounded-[12px] drop-shadow-xl"
                />
                <h4 className="mt-2 text-[24px] font-medium text-white truncate max-w-[280px]">
                  {playlist.name}
                </h4>
                <h4 className="text-[20px] font-base text-white">
                  {playlist.owner.display_name}
                </h4>
              </div>
            ))}
          {activeSection === "browse" &&
            recommendations.map((item) => (
              <div key={item.id} className="min-w-[280px] mr-10">
                <img
                  src={item.album.images[0]?.url}
                  alt="Playlist Cover"
                  className="mt-16 w-[280px] h-[280px] aspect-square rounded-[12px] drop-shadow-xl"
                />
                <h4 className="mt-2 text-[24px] font-medium text-white truncate max-w-[280px]">
                  {item.name}
                </h4>
                <h4 className="text-[20px] font-base text-white">
                  {item.artists.map((artist) => artist.name).join(", ")}
                </h4>
              </div>
            ))}
          {activeSection === "artists" &&
            artists.map((artist) => (
              <div key={artist.id} className="min-w-[280px] mr-10">
                <img
                  src={artist.images[0]?.url}
                  alt="Artist"
                  className="mt-16 w-[280px] h-[280px] aspect-square rounded-full drop-shadow-xl"
                />
                <h4 className="mt-2 text-[24px] font-medium text-white truncate max-w-[280px]">
                  {artist.name}
                </h4>
                <h4 className="text-[20px] font-base text-white">
                  {artist.followers.total.toLocaleString()} Followers
                </h4>
              </div>
            ))}
          {activeSection === "songs" &&
            topSongs.map((track) => (
              <div key={track.id} className="min-w-[280px] mr-10">
                <img
                  src={track.album.images[0]?.url}
                  alt="Artist"
                  className="mt-16 w-[280px] h-[280px] aspect-square rounded-[12px] drop-shadow-xl"
                />
                <h4 className="mt-2 text-[24px] font-medium text-white truncate max-w-[280px]">
                  {track.name}
                </h4>
                <h4 className="text-[20px] font-base text-white">
                  {track.artists.map((artist) => artist.name).join(", ")}
                </h4>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
