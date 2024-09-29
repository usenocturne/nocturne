import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/router";
import classNames from "classnames";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import Link from "next/link";
import { Drawer } from "vaul";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";

const NowPlaying = ({ accessToken, playlists }) => {
  const router = useRouter();
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastBackwardPress, setLastBackwardPress] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [volume, setVolume] = useState(100);
  const [isVolumeVisible, setIsVolumeVisible] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const volumeTimeoutRef = useRef(null);
  const requestRef = useRef();
  const [open, setOpen] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);

  const changeVolume = async (newVolume) => {
    if (!accessToken) return;
    try {
      await fetch(
        `https://api.spotify.com/v1/me/player/volume?volume_percent=${newVolume}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      setVolume(newVolume);
      setIsVolumeVisible(true);

      if (volumeTimeoutRef.current) {
        clearTimeout(volumeTimeoutRef.current);
      }
      volumeTimeoutRef.current = setTimeout(() => {
        setIsVolumeVisible(false);
      }, 2000);
    } catch (error) {
      console.error("Error changing volume:", error);
    }
  };

  const handleWheelScroll = (event) => {
    if (event.deltaX > 0) {
      const newVolume = Math.min(volume + 7, 100);
      changeVolume(newVolume);
    } else if (event.deltaX < 0) {
      const newVolume = Math.max(volume - 7, 0);
      changeVolume(newVolume);
    }
  };

  useEffect(() => {
    window.addEventListener("wheel", handleWheelScroll);
    return () => {
      window.removeEventListener("wheel", handleWheelScroll);
    };
  }, [volume, accessToken]);

  useEffect(() => {
    const fetchCurrentTrack = async () => {
      if (!accessToken) return;

      try {
        const response = await fetch(
          "https://api.spotify.com/v1/me/player/currently-playing",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          setCurrentTrack(data.item);
          setIsPlaying(data.is_playing);

          const initialProgress =
            (data.progress_ms / data.item.duration_ms) * 100;
          setProgress(initialProgress);
        } else {
          setCurrentTrack({
            name: "Not Playing",
            artists: [],
            album: { images: [{ url: "/not-playing.webp" }] },
          });
          setIsPlaying(false);
          setProgress(0);
        }
      } catch (error) {
        console.error("Error with fetchCurrentTrack:", error);
      }
    };

    fetchCurrentTrack();

    const interval = setInterval(fetchCurrentTrack, 1000);
    return () => clearInterval(interval);
  }, [accessToken]);

  const checkIfTrackIsLiked = async (trackId) => {
    if (!accessToken) return;

    try {
      const response = await fetch(
        `https://api.spotify.com/v1/me/tracks/contains?ids=${trackId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.ok) {
        const likedArray = await response.json();
        setIsLiked(likedArray[0]);
      } else {
        console.error("Error checking liked tracks:", await response.json());
      }
    } catch (error) {
      console.error("Error with checkIfTrackIsLiked:", error);
    }
  };

  const toggleLikeTrack = async (trackId) => {
    if (!accessToken) return;

    const endpoint = isLiked
      ? `https://api.spotify.com/v1/me/tracks?ids=${trackId}`
      : `https://api.spotify.com/v1/me/tracks?ids=${trackId}`;

    const method = isLiked ? "DELETE" : "PUT";

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        setIsLiked(!isLiked);
      } else {
        console.error("Error toggling liked track:", await response.json());
      }
    } catch (error) {
      console.error("Error with toggleLikeTrack:", error);
    }
  };

  useEffect(() => {
    if (currentTrack) {
      checkIfTrackIsLiked(currentTrack.id);
    }
  }, [currentTrack]);

  const animateProgress = (start, end, duration) => {
    const startTime = performance.now();

    const step = (currentTime) => {
      const elapsed = currentTime - startTime;
      const percentage = Math.min(elapsed / duration, 1);
      const newProgress = start + (end - start) * percentage;

      setProgress(newProgress);
      requestRef.current = requestAnimationFrame(step);
    };

    requestRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    if (currentTrack && isPlaying) {
      const durationMs = currentTrack.duration_ms;
      const initialProgressMs = currentTrack.progress_ms;
      const remainingMs = durationMs - initialProgressMs;

      animateProgress(remainingMs, progress);

      return () => cancelAnimationFrame(requestRef.current);
    }
  }, [currentTrack, progress, isPlaying]);

  const trackName = currentTrack ? currentTrack.name : "Not Playing";
  const artistName = currentTrack
    ? currentTrack.artists.map((artist) => artist.name).join(", ")
    : "";
  const albumArt = currentTrack ? currentTrack.album.images[0]?.url : "";

  const togglePlayPause = async () => {
    try {
      const response = await fetch("https://api.spotify.com/v1/me/player", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.status === 204 || response.status === 404) {
        const devicesResponse = await fetch(
          "https://api.spotify.com/v1/me/player/devices",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        const devicesData = await devicesResponse.json();
        const availableDevices = devicesData.devices;

        if (availableDevices.length > 0) {
          await fetch("https://api.spotify.com/v1/me/player", {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              device_ids: [availableDevices[0].id],
              play: true,
            }),
          });
        } else {
          setCurrentTrack({
            name: "Not Playing",
            artists: [],
            album: { images: [{ url: "/not-playing.webp" }] },
          });
          setIsPlaying(false);
          setProgress(0);
          return;
        }
      } else {
        const endpoint = isPlaying
          ? "https://api.spotify.com/v1/me/player/pause"
          : "https://api.spotify.com/v1/me/player/play";

        await fetch(endpoint, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        setIsPlaying(!isPlaying);
      }
    } catch (error) {
      console.error("Error toggling play/pause:", error);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Enter") {
        togglePlayPause();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [togglePlayPause]);

  const skipToNext = async () => {
    try {
      await fetch("https://api.spotify.com/v1/me/player/next", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch (error) {
      console.error("Error skipping to next track:", error);
    }
  };

  const skipToPrevious = async () => {
    const currentTime = Date.now();
    const timeSinceLastPress = currentTime - lastBackwardPress;

    if (timeSinceLastPress < 2000) {
      try {
        await fetch("https://api.spotify.com/v1/me/player/previous", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
      } catch (error) {
        console.error("Error skipping to previous track:", error);
      }
    } else {
      try {
        await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=0`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
      } catch (error) {
        console.error("Error restarting the current track:", error);
      }
    }

    setLastBackwardPress(currentTime);
  };

  const StarIcon = ({ className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgba(256, 256, 256, 0.6)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );

  const StarIconFilled = ({ className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="rgba(256, 256, 256)"
      stroke="rgba(256, 256, 256)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polygon
        points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
        opacity="0.6"
      />
    </svg>
  );

  const BackIcon = ({ className }) => (
    <svg
      viewBox="0 0 200 114"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M77.8852 111.18C89.9686 117.963 105 109.385 105 95.7045V73.4745L172.135 111.171C184.219 117.963 199.25 109.385 199.25 95.7045V18.555C199.25 4.87502 184.219 -3.70348 172.135 3.08902L105 40.7755V18.5455C105 4.86552 89.9686 -3.71298 77.8852 3.07952L9.17455 41.659C-3.00545 48.499 -3.00545 65.751 9.17455 72.591L77.8852 111.171V111.18Z"
        fill="white"
        fillOpacity="1.0"
      />
    </svg>
  );

  const PauseIcon = ({ className }) => (
    <svg
      viewBox="0 0 150 204"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M134.5 0H103.5C94.9396 0 88 5.70837 88 12.75V191.25C88 198.292 94.9396 204 103.5 204H134.5C143.06 204 150 198.292 150 191.25V12.75C150 5.70837 143.06 0 134.5 0Z"
        fill="white"
        fillOpacity="1.0"
      />
      <path
        d="M46.5 0H15.5C6.93959 0 0 5.70837 0 12.75V191.25C0 198.292 6.93959 204 15.5 204H46.5C55.0604 204 62 198.292 62 191.25V12.75C62 5.70837 55.0604 0 46.5 0Z"
        fill="white"
        fillOpacity="1.0"
      />
    </svg>
  );

  const PlayIcon = ({ className }) => (
    <svg
      width="171"
      height="184"
      viewBox="0 0 171 184"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0.875 21.6541C0.875 5.83819 17.8214 -4.17006 31.6756 3.44419L159.577 73.7901C173.93 81.6814 173.93 102.308 159.577 110.21L31.6867 180.556C17.8325 188.17 0.886083 178.151 0.886083 162.346L0.875 21.6541Z"
        fill="white"
      />
    </svg>
  );

  const ForwardIcon = ({ className }) => (
    <svg
      viewBox="0 0 200 114"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M27.865 3.07002C15.7817 -3.70348 0.75 4.87502 0.75 18.555V95.714C0.75 109.394 15.7817 117.973 27.865 111.18L95 73.4745V95.7045C95 109.385 110.032 117.963 122.115 111.171L190.826 72.591C203.006 65.751 203.006 48.499 190.826 41.659L122.115 3.07952C110.032 -3.71298 95 4.86552 95 18.5455V40.7755L27.865 3.07002Z"
        fill="white"
        fillOpacity="1.0"
      />
    </svg>
  );

  const MenuIcon = ({ className }) => (
    <svg
      viewBox="0 0 202 202"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M101 202C156.781 202 202 156.781 202 101C202 45.2192 156.781 0 101 0C45.2192 0 0 45.2192 0 101C0 156.781 45.2192 202 101 202ZM47.2509 92.5009C45.1293 94.6224 43.9375 97.4997 43.9375 100.5C43.9375 103.5 45.1293 106.378 47.2509 108.499C49.3724 110.621 52.2497 111.812 55.25 111.812C58.2503 111.812 61.1276 110.621 63.2491 108.499C65.3707 106.378 66.5625 103.5 66.5625 100.5C66.5625 97.4997 65.3707 94.6224 63.2491 92.5009C61.1276 90.3793 58.2503 89.1875 55.25 89.1875C52.2497 89.1875 49.3724 90.3793 47.2509 92.5009ZM92.5009 92.5009C90.3793 94.6224 89.1875 97.4997 89.1875 100.5C89.1875 103.5 90.3793 106.378 92.5009 108.499C94.6224 110.621 97.4997 111.812 100.5 111.812C103.5 111.812 106.378 110.621 108.499 108.499C110.621 106.378 111.812 103.5 111.812 100.5C111.812 97.4997 110.621 94.6224 108.499 92.5009C106.378 90.3793 103.5 89.1875 100.5 89.1875C97.4997 89.1875 94.6224 90.3793 92.5009 92.5009ZM137.751 92.5009C135.629 94.6224 134.438 97.4997 134.438 100.5C134.438 103.5 135.629 106.378 137.751 108.499C139.872 110.621 142.75 111.812 145.75 111.812C148.75 111.812 151.628 110.621 153.749 108.499C155.871 106.378 157.062 103.5 157.062 100.5C157.062 97.4997 155.871 94.6224 153.749 92.5009C151.628 90.3793 148.75 89.1875 145.75 89.1875C142.75 89.1875 139.872 90.3793 137.751 92.5009Z"
      />
    </svg>
  );

  const VolumeOffIcon = ({ className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      stroke="rgba(0, 0, 0)"
      fill="rgba(0, 0, 0)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      opacity="0.5"
    >
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      <line x1="22" x2="16" y1="9" y2="15" opacity="0.6" />
      <line x1="16" x2="22" y1="9" y2="15" opacity="0.6" />
    </svg>
  );

  const VolumeLowIcon = ({ className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      stroke="rgba(0, 0, 0)"
      fill="rgba(0, 0, 0)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      opacity="0.5"
    >
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      <path d="M16 9a5 5 0 0 1 0 6" opacity="0.6" />
    </svg>
  );

  const VolumeLoudIcon = ({ className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      opacity="0.5"
    >
      <path
        d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"
        stroke="rgba(0, 0, 0)"
        fill="rgba(0, 0, 0)"
      />
      <path
        d="M16 9a5 5 0 0 1 0 6"
        stroke="rgba(0, 0, 0)"
        fill="rgba(0, 0, 0)"
        opacity="0.6"
      />
      <path
        d="M19.364 18.364a9 9 0 0 0 0-12.728"
        stroke="rgba(0, 0, 0)"
        opacity="0.6"
      />
    </svg>
  );

  const PlaylistAddIcon = ({ className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M11 12H3" />
      <path d="M16 6H3" />
      <path d="M16 18H3" />
      <path d="M18 9v6" />
      <path d="M21 12h-6" />
    </svg>
  );

  const GoToAlbumIcon = ({ className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12h.01" />
    </svg>
  );

  const PlayPauseButton = () => {
    if (isPlaying) {
      return <PauseIcon className="w-10 h-10" />;
    } else {
      return <PlayIcon className="w-10 h-10" />;
    }
  };

  const addTrackToPlaylist = async (playlistId) => {
    if (!accessToken || !currentTrack) return;

    setSelectedPlaylistId(playlistId);

    try {
      let allTracks = [];
      let nextURL = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

      while (nextURL) {
        const response = await fetch(nextURL, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          throw new Error(
            "Error fetching tracks in playlist: " + (await response.json())
          );
        }

        const data = await response.json();
        allTracks = allTracks.concat(data.items);
        nextURL = data.next;
      }

      const currentTrackIds = allTracks.map((item) => item.track.id);

      if (currentTrackIds.includes(currentTrack.id)) {
        setDrawerOpen(false);
        setOpen(true);
        return;
      }

      await addTrackToPlaylistAPI(playlistId);
      setDrawerOpen(false);
    } catch (error) {
      console.error("Error checking playlist contents:", error);
    }
  };

  const addTrackToPlaylistAPI = async (playlistId) => {
    try {
      const response = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uris: [`spotify:track:${currentTrack.id}`],
          }),
        }
      );

      if (response.ok) {
        console.log("Track added to playlist");
      } else {
        console.error("Error adding track to playlist:", await response.json());
      }
    } catch (error) {
      console.error("Error adding track to playlist:", error);
    }
  };

  const handleAddAnyway = () => {
    setOpen(false);
    if (selectedPlaylistId) {
      addTrackToPlaylistAPI(selectedPlaylistId);
    }
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-transparent z-30"
          onClick={() => setOpen(false)}
        />
      )}
      <Drawer.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <div className="flex flex-col gap-6 min-h-screen w-full z-10">
          <div className="md:w-1/3 flex flex-row items-center px-12 pt-10">
            <div className="min-w-[280px] mr-8">
              <img
                src={albumArt || "/not-playing.webp"}
                alt="/not-playing.webp"
                className="w-[280px] h-[280px] aspect-square rounded-[12px] drop-shadow-xl"
              />
            </div>
            <div className="flex-1 text-center md:text-left">
              <h4 className="text-[32px] font-medium text-white truncate tracking-tight max-w-[400px]">
                {trackName}
              </h4>
              <h4 className="text-[24px] font-normal text-white/60 truncate tracking-tight max-w-[400px]">
                {artistName}
              </h4>
            </div>
          </div>

          <div className="w-full px-12 overflow-hidden">
            <div className="w-full bg-white/20 h-2 rounded-full mt-4 overflow-hidden">
              <div
                className="progress-bar bg-white h-2"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>

          <div className="flex justify-between items-center w-full px-12 mt-4">
            <div
              className="flex-shrink-0"
              onClick={() => toggleLikeTrack(currentTrack.id)}
            >
              {isLiked ? (
                <StarIconFilled className="w-10 h-10" />
              ) : (
                <StarIcon className="w-10 h-10" />
              )}
            </div>

            <div className="flex justify-center gap-12 flex-1">
              <div onClick={skipToPrevious}>
                <BackIcon className="w-10 h-10" />
              </div>
              <div>
                <div onClick={togglePlayPause}>
                  <PlayPauseButton />
                </div>
              </div>
              <div onClick={skipToNext}>
                <ForwardIcon className="w-10 h-10" />
              </div>
            </div>

            <div className="flex-shrink-0">
              <Menu as="div" className="relative inline-block text-left">
                <div>
                  <MenuButton>
                    <MenuIcon className="w-10 h-10 fill-white/60" />
                  </MenuButton>
                </div>

                <MenuItems
                  transition
                  className="absolute right-0 bottom-full z-10 mb-2 w-56 origin-bottom-right divide-y divide-slate-100/25 bg-black/35 backdrop-blur-md rounded-[13px] drop-shadow-xl shadow-xl transition focus:outline-none data-[closed]:scale-95 data-[closed]:transform data-[closed]:opacity-0 data-[enter]:duration-100 data-[leave]:duration-75 data-[enter]:ease-out data-[leave]:ease-in"
                >
                  <div className="py-1">
                    <Drawer.Trigger asChild>
                      <MenuItem>
                        <div className="group flex items-center justify-between px-4 py-2 text-sm text-white font-normal">
                          <span>Add to a Playlist</span>
                          <PlaylistAddIcon
                            aria-hidden="true"
                            className="h-5 w-5 text-white"
                          />
                        </div>
                      </MenuItem>
                    </Drawer.Trigger>
                  </div>
                  <div className="py-1">
                    <Link
                      href={`/album/${currentTrack?.album?.id}?accessToken=${accessToken}`}
                    >
                      <MenuItem>
                        <div className="group flex items-center justify-between px-4 py-2 text-sm text-white">
                          <span>Go to Album</span>
                          <GoToAlbumIcon
                            aria-hidden="true"
                            className="h-5 w-5 text-white"
                          />
                        </div>
                      </MenuItem>
                    </Link>
                  </div>
                </MenuItems>
              </Menu>
            </div>
          </div>
          <div
            className={classNames(
              "fixed right-0 top-[70px] transform transition-opacity duration-300 backdrop-blur-md",
              {
                "opacity-0 volumeOutScale": !isVolumeVisible,
                "opacity-100 volumeInScale": isVolumeVisible,
              }
            )}
          >
            <div className="w-14 h-44 bg-black/20 rounded-[17px] flex flex-col-reverse drop-shadow-xl overflow-hidden">
              <div
                className={classNames(
                  "bg-white w-full transition-height duration-300",
                  {
                    "rounded-b-[13px]": volume < 100,
                    "rounded-[13px]": volume === 100,
                  }
                )}
                style={{ height: `${volume}%` }}
              >
                <div className="absolute bottom-0 left-0 right-0 flex justify-center items-center h-6 pb-7">
                  {volume === 0 && <VolumeOffIcon className="w-7 h-7" />}
                  {volume > 0 && volume <= 60 && (
                    <VolumeLowIcon className="w-7 h-7 ml-1.5" />
                  )}
                  {volume > 60 && <VolumeLoudIcon className="w-7 h-7" />}
                </div>
              </div>
            </div>
          </div>
        </div>

        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/10 z-20" />
          <Drawer.Content className="flex flex-col rounded-t-[17px] h-auto mt-24 fixed bottom-0 left-0 right-0 z-30">
            <div className="pt-4 pb-4 bg-black/40 backdrop-blur-2xl rounded-t-[17px] flex-1">
              <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-zinc-300" />
              <div className="mx-auto flex pl-8 pr-4 overflow-x-scroll scroll-container">
                {Array.isArray(playlists) &&
                  playlists.map((item) => (
                    <div
                      className="min-w-[280px] mr-10 mb-4"
                      onClick={() => addTrackToPlaylist(item.id)}
                    >
                      <img
                        src={item.images[0]?.url}
                        alt="Playlist Cover"
                        className="mt-8 w-[280px] h-[280px] aspect-square rounded-[12px] drop-shadow-xl"
                      />
                      <h4 className="mt-2 text-[24px] font-medium text-white truncate tracking-tight max-w-[280px]">
                        {item.name}
                      </h4>
                      <h4 className="text-[20px] font-normal text-white truncate tracking-tight max-w-[280px]">
                        {item.tracks.total.toLocaleString()} Songs
                      </h4>
                    </div>
                  ))}
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>

        <Dialog open={open} onClose={setOpen} className="relative z-50">
          <DialogBackdrop
            transition
            className="fixed inset-0 bg-black/40 transition-opacity data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200 data-[enter]:ease-out data-[leave]:ease-in"
          />

          <div className="fixed inset-0 z-50 w-screen overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
              <DialogPanel
                transition
                className="relative transform overflow-hidden rounded-[17px] bg-black/40 backdrop-blur-2xl px-0 pb-0 pt-5 text-left shadow-xl transition-all data-[closed]:translate-y-4 data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200 data-[enter]:ease-out data-[leave]:ease-in sm:my-8 sm:w-full sm:max-w-sm data-[closed]:sm:translate-y-0 data-[closed]:sm:scale-95"
              >
                <div>
                  <div className="text-center">
                    <DialogTitle
                      as="h3"
                      className="text-base font-normal leading-6 text-white"
                    >
                      Already Added
                    </DialogTitle>
                    <div className="mt-2">
                      <p className="text-sm text-white/60">
                        This track is already in the playlist.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-0 border-t border-slate-100/25">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex w-full justify-center px-3 py-3 text-sm font-normal text-[#6c8bd5] shadow-sm sm:col-start-2"
                  >
                    Don't Add
                  </button>
                  <button
                    type="button"
                    data-autofocus
                    onClick={handleAddAnyway}
                    className="mt-3 inline-flex w-full justify-center px-3 py-3 text-sm font-normal text-[#6c8bd5] shadow-sm sm:col-start-1 sm:mt-0 border-r border-slate-100/25"
                  >
                    Add Anyway
                  </button>
                </div>
              </DialogPanel>
            </div>
          </div>
        </Dialog>
      </Drawer.Root>
    </>
  );
};

export default NowPlaying;
