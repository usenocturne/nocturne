import "../styles/globals.css";
import { useEffect, useState } from "react";
import ColorThief from "color-thief-browser";
import { useRouter } from "next/router";
import { Inter } from "next/font/google";
import {
  fetchRecentlyPlayedAlbums,
  fetchUserPlaylists,
  fetchTopArtists,
  fetchUserRadio,
} from "../services";

const inter = Inter({ subsets: ["latin", "latin-ext"] });

const CLIENT_ID = "";
const CLIENT_SECRET = "";
const REDIRECT_URI = "";

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
  const [currentlyPlayingTrackUri, setCurrentlyPlayingTrackUri] =
    useState(null);
  const [sectionGradients, setSectionGradients] = useState({
    library: null,
    artists: null,
    radio: null,
  });
  const [currentPlayback, setCurrentPlayback] = useState(null);

  const handleEscapePress = (event) => {
    if (event.key === "Escape") {
      router.push("/");
      setActiveSection("recents");
    }
  };

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

      setLoading(false);

      fetchRecentlyPlayedAlbums(accessToken, setAlbums, setAlbumsQueue);
      fetchUserPlaylists(accessToken, setPlaylists, updateGradientColors);
      fetchTopArtists(accessToken, setArtists, updateGradientColors);
      fetchUserRadio(accessToken, setRadio, updateGradientColors);

      const playbackInterval = setInterval(() => {
        fetchCurrentPlayback();
      }, 1000);

      const recentlyPlayedInterval = setInterval(() => {
        fetchRecentlyPlayedAlbums(accessToken, setAlbums, setAlbumsQueue);
      }, 5 * 60 * 1000);

      window.addEventListener("keydown", handleEscapePress);

      return () => {
        clearInterval(tokenRefreshInterval);
        clearInterval(playbackInterval);
        clearInterval(recentlyPlayedInterval);
        window.removeEventListener("keydown", handleEscapePress);
      };
    }
  }, [accessToken]);

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
          setCurrentPlayback({
            ...data,
            device: {
              ...data.device,
              volume_percent: data.device?.volume_percent,
            },
            shuffle_state: data.shuffle_state,
            repeat_state: data.repeat_state,
          });
          if (data && data.item) {
            const currentAlbum = data.item.album;
            const currentTrackUri = data.item.uri;
            setCurrentlyPlayingTrackUri(currentTrackUri);
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

                const imageUrl = currentAlbum.images[0].url;
                if (imageUrl !== albumImage) {
                  localStorage.setItem("albumImage", imageUrl);
                  setAlbumImage(imageUrl);
                  setAlbumName(currentAlbum.name);
                  setArtistName(
                    currentAlbum.artists.map((artist) => artist.name).join(", ")
                  );

                  if (activeSection === "recents") {
                    updateGradientColors(imageUrl);
                  }
                }
              }
            }
          } else if (currentlyPlayingAlbum !== null) {
            setCurrentlyPlayingAlbum(null);
            setCurrentlyPlayingTrackUri(null);
            const imageUrl = "/not-playing.webp";
            if (imageUrl !== albumImage) {
              localStorage.setItem("albumImage", imageUrl);
              setAlbumImage(imageUrl);

              if (activeSection === "recents") {
                updateGradientColors(imageUrl);
              }
            }
          }
        } else {
          console.error("Error fetching current playback:", response.status);
          if (currentPlayback !== null) {
            setCurrentPlayback(null);
            setCurrentlyPlayingAlbum(null);
            setCurrentlyPlayingTrackUri(null);
            const imageUrl = "/not-playing.webp";
            if (imageUrl !== albumImage) {
              localStorage.setItem("albumImage", imageUrl);
              setAlbumImage(imageUrl);

              if (activeSection === "recents") {
                updateGradientColors(imageUrl);
              }
            }
          }
        }
      } catch (error) {
        console.error("Error fetching current playback:", error);
        if (currentPlayback !== null) {
          setCurrentPlayback(null);
          setCurrentlyPlayingAlbum(null);
          setCurrentlyPlayingTrackUri(null);
          const imageUrl = "/not-playing.webp";
          if (imageUrl !== albumImage) {
            localStorage.setItem("albumImage", imageUrl);
            setAlbumImage(imageUrl);

            if (activeSection === "recents") {
              updateGradientColors(imageUrl);
            }
          }
        }
      }
    }
  };

  const redirectToSpotify = () => {
    const scopes =
      "user-read-recently-played user-read-private user-top-read user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private";

    window.location.href = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=${scopes}`;
  };

  const fetchAccessToken = async (code) => {
    try {
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          redirect_uri: REDIRECT_URI,
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
          Authorization: "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
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

  const updateGradientColors = (imageUrl, section = null) => {
    const colorThief = new ColorThief();
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
      const dominantColors = colorThief.getPalette(img, 4);
      const hexColors = dominantColors.map((color) =>
        rgbToHex({ r: color[0], g: color[1], b: color[2] })
      );

      if (section) {
        setSectionGradients((prev) => ({
          ...prev,
          [section]: hexColors,
        }));
      }

      setTargetColor1(hexColors[0]);
      setTargetColor2(hexColors[1]);
      setTargetColor3(hexColors[2]);
      setTargetColor4(hexColors[3]);
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

  useEffect(() => {
    if (activeSection !== "recents" && sectionGradients[activeSection]) {
      const [color1, color2, color3, color4] = sectionGradients[activeSection];
      setTargetColor1(color1);
      setTargetColor2(color2);
      setTargetColor3(color3);
      setTargetColor4(color4);
    }
  }, [activeSection, sectionGradients]);

  return (
    <main
      className={`overflow-hidden relative min-h-screen ${inter.className}`}
    >
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
          currentlyPlayingTrackUri={currentlyPlayingTrackUri}
          currentPlayback={currentPlayback}
          fetchCurrentPlayback={fetchCurrentPlayback}
        />
      </div>
    </main>
  );
}
