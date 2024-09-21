import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import ColorThief from "color-thief-browser";
import Link from "next/link";
import next from "next";

export default function Home() {
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [authCode, setAuthCode] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [currentlyPlayingAlbum, setCurrentlyPlayingAlbum] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [artists, setArtists] = useState([]);
  const [topSongs, setTopSongs] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [albumImage, setAlbumImage] = useState(null);
  const [colors, setColors] = useState([]);
  const [albumName, setAlbumName] = useState("");
  const [artistName, setArtistName] = useState("");
  const [activeSection, setActiveSection] = useState("home");
  const [currentColor1, setCurrentColor1] = useState("#191414");
  const [currentColor2, setCurrentColor2] = useState("#191414");
  const [currentColor3, setCurrentColor3] = useState("#191414");
  const [currentColor4, setCurrentColor4] = useState("#191414");
  const [targetColor1, setTargetColor1] = useState("#191414");
  const [targetColor2, setTargetColor2] = useState("#191414");
  const [targetColor3, setTargetColor3] = useState("#191414");
  const [targetColor4, setTargetColor4] = useState("#191414");
  const [transitionSpeed, setTransitionSpeed] = useState(30);
  const [loading, setLoading] = useState(true);

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
      setLoading(false);
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

  useEffect(() => {
    const fetchCurrentPlayback = async () => {
      if (accessToken) {
        try {
          const response = await fetch("https://api.spotify.com/v1/me/player", {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            if (data && data.item) {
              const currentAlbum = data.item.album;
              if (
                !currentlyPlayingAlbum ||
                currentlyPlayingAlbum.id !== currentAlbum.id
              ) {
                setCurrentlyPlayingAlbum(currentAlbum);
                await fetchRecentlyPlayedAlbums();

                const imageUrl = currentAlbum.images[0].url;
                localStorage.setItem("albumImage", imageUrl);
                setAlbumImage(imageUrl);
                setAlbumName(currentAlbum.name);
                setArtistName(
                  currentAlbum.artists.map((artist) => artist.name).join(", ")
                );

                const colorThief = new ColorThief();
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.src = imageUrl;

                img.onload = () => {
                  const dominantColors = colorThief.getPalette(img, 4);
                  const hexColors = dominantColors.map((color) =>
                    rgbToHex({ r: color[0], g: color[1], b: color[2] })
                  );

                  setTimeout(() => {
                    setTargetColor1(hexColors[0]);
                    setTargetColor2(hexColors[1]);
                    setTargetColor3(hexColors[2]);
                    setTargetColor4(hexColors[3]);
                  }, 250);
                };
              }
            } else {
              console.log("No album is currently playing.");
              setCurrentlyPlayingAlbum(null);
            }
          } else {
            console.error("Error fetching current playback:", response.status);
          }
        } catch (error) {
          console.error("Error fetching current playback:", error);
        }
      }
    };

    if (accessToken) {
      fetchCurrentPlayback();
      const intervalId = setInterval(fetchCurrentPlayback, 1000);

      return () => clearInterval(intervalId);
    }
  }, [accessToken, currentlyPlayingAlbum]);

  const redirectToSpotify = async () => {
    const clientId = "f944e760b5644a1ea58de852b88f1802";
    const redirectUri = "http://localhost:3000";
    const scopes =
      "user-read-recently-played user-read-private user-top-read user-read-playback-state";

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
          Authorization:
            "Basic " +
            btoa(
              "f944e760b5644a1ea58de852b88f1802:006e8d19cec240c591f21c0f7552c962"
            ),
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
          Authorization:
            "Basic " +
            btoa(
              "f944e760b5644a1ea58de852b88f1802:006e8d19cec240c591f21c0f7552c962"
            ),
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

  const hexToRgb = (hex) => {
    const bigint = parseInt(hex.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  };

  const rgbToHex = ({ r, g, b }) => {
    const toHex = (n) => n.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const getNextColor = (current, target) => {
    const step = (start, end) => {
      if (start === end) return start;
      const diff = end - start;
      return start + (diff > 0 ? Math.min(1, diff) : Math.max(-1, diff));
    };

    return {
      r: step(current.r, target.r),
      g: step(current.g, target.g),
      b: step(current.b, target.b),
    };
  };

  useEffect(() => {
    const current1 = hexToRgb(currentColor1);
    const current2 = hexToRgb(currentColor2);
    const current3 = hexToRgb(currentColor3);
    const current4 = hexToRgb(currentColor4);

    const target1 = hexToRgb(targetColor1);
    const target2 = hexToRgb(targetColor2);
    const target3 = hexToRgb(targetColor3);
    const target4 = hexToRgb(targetColor4);

    const intervalId = setInterval(() => {
      const nextColor1 = getNextColor(current1, target1);
      const nextColor2 = getNextColor(current2, target2);
      const nextColor3 = getNextColor(current3, target3);
      const nextColor4 = getNextColor(current4, target4);

      setCurrentColor1(rgbToHex(nextColor1));
      setCurrentColor2(rgbToHex(nextColor2));
      setCurrentColor3(rgbToHex(nextColor3));
      setCurrentColor4(rgbToHex(nextColor4));

      current1.r = nextColor1.r;
      current1.g = nextColor1.g;
      current1.b = nextColor1.b;

      current2.r = nextColor2.r;
      current2.g = nextColor2.g;
      current2.b = nextColor2.b;

      current3.r = nextColor3.r;
      current3.g = nextColor3.g;
      current3.b = nextColor3.b;

      current4.r = nextColor4.r;
      current4.g = nextColor4.g;
      current4.b = nextColor4.b;

      if (
        nextColor1.r === target1.r &&
        nextColor1.g === target1.g &&
        nextColor1.b === target1.b &&
        nextColor2.r === target2.r &&
        nextColor2.g === target2.g &&
        nextColor2.b === target2.b &&
        nextColor3.r === target3.r &&
        nextColor3.g === target3.g &&
        nextColor3.b === target3.b &&
        nextColor4.r === target4.r &&
        nextColor4.g === target4.g &&
        nextColor4.b === target4.b
      ) {
        clearInterval(intervalId);
      }
    }, transitionSpeed);

    return () => clearInterval(intervalId);
  }, [
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    targetColor1,
    targetColor2,
    targetColor3,
    targetColor4,
    transitionSpeed,
  ]);

  const generateMeshGradient = (colors) => {
    if (colors.length === 0) return "#191414";

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
          backgroundImage: generateMeshGradient([
            currentColor1,
            currentColor2,
            currentColor3,
            currentColor4,
          ]),
          transition: "background-image 0.5s linear",
        }}
        className="absolute inset-0"
      ></div>
      {!loading && (
        <div className="relative z-10 pl-8 grid grid-cols-[1.5fr_3fr] fadeIn-animation">
          <Sidebar
            activeSection={activeSection}
            setActiveSection={setActiveSection}
          />

          <div className="flex overflow-x-auto scroll-container p-2">
            {activeSection === "home" && (
              <>
                {/* Render currently playing album if available */}
                {currentlyPlayingAlbum && (
                  <Link
                    href={`/album/${currentlyPlayingAlbum.id}?accessToken=${accessToken}`}
                  >
                    <div className="min-w-[280px] mr-10">
                      <img
                        src={currentlyPlayingAlbum.images[0]?.url}
                        alt="Currently Playing Album Cover"
                        className="mt-16 w-[280px] h-[280px] aspect-square rounded-[12px] drop-shadow-xl"
                      />
                      <h4 className="mt-2 text-[24px] font-medium text-white truncate max-w-[280px]">
                        {currentlyPlayingAlbum.name}
                      </h4>
                      <h4 className="text-[20px] font-base text-white truncate max-w-[280px]">
                        {currentlyPlayingAlbum.artists
                          .map((artist) => artist.name)
                          .join(", ")}
                      </h4>
                    </div>
                  </Link>
                )}

                {/* Render recently played albums */}
                {albums.map((album) => (
                  <Link
                    key={album.id}
                    href={`/album/${album.id}?accessToken=${accessToken}`}
                  >
                    <div className="min-w-[280px] mr-10">
                      <img
                        src={album.images[0]?.url}
                        alt="Album Cover"
                        className="mt-16 w-[280px] h-[280px] aspect-square rounded-[12px] drop-shadow-xl"
                      />
                      <h4 className="mt-2 text-[24px] font-medium text-white truncate max-w-[280px]">
                        {album.name}
                      </h4>
                      <h4 className="text-[20px] font-base text-white truncate max-w-[280px]">
                        {album.artists.map((artist) => artist.name).join(", ")}
                      </h4>
                    </div>
                  </Link>
                ))}
              </>
            )}
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
      )}
    </div>
  );
}
