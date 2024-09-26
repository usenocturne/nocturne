import "../styles/globals.css";
import { useEffect, useState } from "react";
import ColorThief from "color-thief-browser";
import { useRouter } from "next/router";

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [authCode, setAuthCode] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [currentlyPlayingAlbum, setCurrentlyPlayingAlbum] = useState(null);
  const [albumsQueue, setAlbumsQueue] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [artists, setArtists] = useState([]);
  const [radio, setRadio] = useState([]);
  const [albumImage, setAlbumImage] = useState(null);
  const [colors, setColors] = useState([]);
  const [albumName, setAlbumName] = useState("");
  const [artistName, setArtistName] = useState("");
  const [activeSection, setActiveSection] = useState("recents");
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

  const handleEscapePress = (event) => {
    if (event.key === "Escape") {
      router.push("/");
      setActiveSection("recents");
    }
  };

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
    const storedAccessToken = localStorage.getItem("accessToken");
    const storedRefreshToken = localStorage.getItem("refreshToken");

    if (storedAccessToken && storedRefreshToken) {
      setAccessToken(storedAccessToken);
      setRefreshToken(storedRefreshToken);
      setLoading(false);
      scheduleTokenRefresh();
    } else if (authCode) {
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
        localStorage.setItem("accessToken", accessToken);
      }, 3000 * 1000);

      return () => clearInterval(tokenRefreshInterval);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) {
      fetchRecentlyPlayedAlbums();
      fetchUserPlaylists();
      fetchTopArtists();
      fetchUserRadio();
      window.addEventListener("keydown", handleEscapePress);
      return () => window.removeEventListener("keydown", handleEscapePress);
    }
  }, [accessToken]);

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
                if (!router.pathname.includes("album")) {
                  setCurrentlyPlayingAlbum(currentAlbum);
                  setAlbumsQueue((prevQueue) => {
                    const updatedQueue = prevQueue.filter(
                      (album) => album.id !== currentAlbum.id
                    );
                    return [currentAlbum, ...updatedQueue];
                  });
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
              }
            } else {
              console.log("No album is currently playing.");
              setCurrentlyPlayingAlbum(null);
            }
          } else {
            console.error("Error fetching current playback:", response.status);
            const imageUrl = "/not-playing.webp";
            localStorage.setItem("albumImage", imageUrl);
            setAlbumImage(imageUrl);

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
        } catch (error) {
          console.error("Error fetching current playback:", error);
          const imageUrl = "/not-playing.webp";
          localStorage.setItem("albumImage", imageUrl);
          setAlbumImage(imageUrl);

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
      }
    };

    if (accessToken) {
      fetchCurrentPlayback();
      const intervalId = setInterval(fetchCurrentPlayback, 1000);

      return () => clearInterval(intervalId);
    }
  }, [router.pathname, accessToken, currentlyPlayingAlbum]);

  useEffect(() => {
    const colorThief = new ColorThief();
    const img = new Image();
    img.crossOrigin = "anonymous";

    let imageKey;

    switch (true) {
      case router.pathname.includes("album"):
        imageKey = "albumPageImage";
        break;
      case router.pathname.includes("playlist"):
        imageKey = "playlistPageImage";
        break;
      case router.pathname.includes("artist"):
        imageKey = "artistPageImage";
        break;
      case activeSection === "recents":
        imageKey = "albumImage";
        break;
      case activeSection === "library":
        imageKey = "libraryImage";
        break;
      case activeSection === "artists":
        imageKey = "artistsImage";
        break;
      case activeSection === "radio":
        fetchUserRadio().then(() => {
          setTargetColor1("#21305e");
          setTargetColor2("#1d2238");
          setTargetColor3("#e468b9");
          setTargetColor4("#933e8e");
        });
        break;
      default:
        break;
    }

    const imageSrc = localStorage.getItem(imageKey);
    img.src = imageSrc;

    img.onload = () => {
      const dominantColors = colorThief.getPalette(img, 4);
      const hexColors = dominantColors.map((color) =>
        rgbToHex({ r: color[0], g: color[1], b: color[2] })
      );

      setTargetColor1(hexColors[0]);
      setTargetColor2(hexColors[1]);
      setTargetColor3(hexColors[2]);
      setTargetColor4(hexColors[3]);
    };
  }, [router.pathname, activeSection]);

  const redirectToSpotify = async () => {
    const clientId = "";
    const redirectUri = "http://localhost:3000";
    const scopes =
      "user-read-recently-played user-read-private user-top-read user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read user-library-modify playlist-read-private playlist-read-collaborative";

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    localStorage.setItem("code_verifier", codeVerifier);

    window.location.href = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scopes}&code_challenge_method=S256&code_challenge=${codeChallenge}`;
  };

  function scheduleTokenRefresh() {
    if (refreshToken) {
      const refreshInterval = (60 * 60 - 5 * 60) * 1000;
      setTimeout(refreshAccessToken, refreshInterval);
    }
  }

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
      localStorage.setItem("accessToken", data.access_token);
      localStorage.setItem("refreshToken", data.refresh_token);
      scheduleTokenRefresh();
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

      if (response.ok) {
        const data = await response.json();
        setAccessToken(data.access_token);
        localStorage.setItem("accessToken", data.access_token);
        scheduleTokenRefresh();
      } else {
        console.error("Error refreshing access token:", response.status);
      }
    } catch (error) {
      console.error("Error refreshing access token:", error);
    }
  };

  const fetchRecentlyPlayedAlbums = async () => {
    if (accessToken) {
      try {
        const response = await fetch(
          "https://api.spotify.com/v1/me/player/recently-played",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          const albums = data.items.map((item) => item.track.album);

          setAlbums(albums);

          setAlbumsQueue((prevQueue) => {
            const uniqueAlbums = [...prevQueue, ...albums].filter(
              (album, index, self) =>
                index === self.findIndex((a) => a.id === album.id)
            );
            return uniqueAlbums;
          });
        } else {
          console.error(
            "Error fetching recently played albums:",
            response.status
          );
        }
      } catch (error) {
        console.error("Error fetching recently played albums:", error);
      }
    }
  };

  const fetchUserPlaylists = async () => {
    try {
      const response = await fetch("https://api.spotify.com/v1/me/playlists", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await response.json();
      if (response.ok) {
        const imageUrl = data.items[0].images[0].url;
        localStorage.setItem("libraryImage", imageUrl);
      }
      setPlaylists(data.items);
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
      if (response.ok) {
        const imageUrl = data.items[0].images[0].url;
        localStorage.setItem("artistsImage", imageUrl);
      }
      setArtists(data.items);
    } catch (error) {
      console.error("Error fetching top artists:", error);
    }
  };

  const fetchUserRadio = async () => {
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
      const playlists = data.playlists.items;

      const filteredPlaylists = playlists.filter(
        (playlist) => playlist.id !== "37i9dQZF1EYkqdzj48dyYq"
      );

      const priorityOrder = ["On Repeat", "Repeat Rewind"];

      const sortedPlaylists = filteredPlaylists.sort((a, b) => {
        const indexA = priorityOrder.indexOf(a.name);
        const indexB = priorityOrder.indexOf(b.name);

        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB;
        }
        if (indexA !== -1) {
          return -1;
        }
        if (indexB !== -1) {
          return 1;
        }
        return 0;
      });

      setRadio(sortedPlaylists);

      return sortedPlaylists.length > 0 ? sortedPlaylists[0].name : null;
    } catch (error) {
      console.error("Error fetching user playlists:", error);
      return null;
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
    <main className="overflow-hidden relative min-h-screen">
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
      <div className="relative z-10">
        <Component
          {...pageProps}
          accessToken={accessToken}
          albums={albums}
          playlists={playlists}
          artists={artists}
          radio={radio}
          currentlyPlayingAlbum={currentlyPlayingAlbum}
          setCurrentlyPlayingAlbum={setCurrentlyPlayingAlbum}
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          loading={loading}
          albumsQueue={albumsQueue}
        />
      </div>
    </main>
  );
}
