import { useRouter } from "next/router";
import { useEffect, useState, useRef, useCallback } from "react";
import LongPressLink from "../../components/LongPressLink";
import Image from "next/image";
import SuccessAlert from "../../components/SuccessAlert";
import { fetchUserRadio } from "../../services";
export const runtime = "experimental-edge";

const MixPage = ({
  initialMix,
  currentlyPlayingTrackUri,
  handleError,
  error,
}) => {
  const router = useRouter();
  const accessToken = router.query.accessToken;
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [mix, setMix] = useState(initialMix);
  const [tracks, setTracks] = useState(initialMix?.tracks || []);
  const [showSuccess, setShowSuccess] = useState(false);
  const [pressedButton, setPressedButton] = useState(null);

  useEffect(() => {
    const validKeys = ["1", "2", "3", "4"];
    const holdDuration = 2000;
    const holdTimeouts = {};
    const pressStartTimes = {};

    const handleKeyDown = (event) => {
      if (!validKeys.includes(event.key) || event.repeat) return;

      pressStartTimes[event.key] = Date.now();

      holdTimeouts[event.key] = setTimeout(() => {
        const currentUrl = window.location.pathname;
        const currentImage = localStorage.getItem("mixPageImage");

        localStorage.setItem(`button${event.key}Map`, currentUrl);
        if (currentImage) {
          localStorage.setItem(`button${event.key}Image`, currentImage);
        }

        setPressedButton(event.key);
        setShowSuccess(true);
      }, holdDuration);
    };

    const handleKeyUp = (event) => {
      if (!validKeys.includes(event.key)) return;

      if (holdTimeouts[event.key]) {
        clearTimeout(holdTimeouts[event.key]);
        delete holdTimeouts[event.key];
      }

      delete pressStartTimes[event.key];
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      Object.values(holdTimeouts).forEach(
        (timeout) => timeout && clearTimeout(timeout)
      );
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const handleSuccessClose = useCallback(() => {
    setShowSuccess(false);
    setPressedButton(null);
  }, []);

  useEffect(() => {
    if (error) {
      handleError(error.type, error.message);
    }
  }, [error, handleError]);

  useEffect(() => {
    const mixImage = mix?.images?.[0]?.url || "";
    localStorage.setItem("mixPageImage", mixImage);
  }, [mix]);

  useEffect(() => {
    const fetchPlaybackState = async () => {
      try {
        const response = await fetch("https://api.spotify.com/v1/me/player", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          setIsShuffleEnabled(data.shuffle_state);
        }
      } catch (error) {
        return;
      }
    };

    fetchPlaybackState();
  }, [accessToken]);

  const playMix = async () => {
    try {
      const devicesResponse = await fetch(
        "https://api.spotify.com/v1/me/player/devices",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const devicesData = await devicesResponse.json();

      if (devicesData.devices.length === 0) {
        handleError(
          "NO_DEVICES_AVAILABLE",
          "No devices available for playback"
        );
        return;
      }

      const device = devicesData.devices[0];
      const activeDeviceId = device.id;

      if (!device.is_active) {
        await fetch("https://api.spotify.com/v1/me/player", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            device_ids: [activeDeviceId],
            play: false,
          }),
        });
      }

      await fetch(
        `https://api.spotify.com/v1/me/player/shuffle?state=${isShuffleEnabled}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const trackUris = tracks.map((track) => track.uri);
      const offset = isShuffleEnabled
        ? { position: Math.floor(Math.random() * tracks.length) }
        : { position: 0 };

      await fetch("https://api.spotify.com/v1/me/player/play", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uris: trackUris,
          offset: offset,
        }),
      });
      router.push("/now-playing");
    } catch (error) {
      handleError("PLAY_MIX_ERROR", error.message);
    }
  };

  const playTrack = async (trackUri, trackIndex) => {
    try {
      const devicesResponse = await fetch(
        "https://api.spotify.com/v1/me/player/devices",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const devicesData = await devicesResponse.json();

      if (devicesData.devices.length === 0) {
        handleError(
          "NO_DEVICES_AVAILABLE",
          "No devices available for playback"
        );
        return;
      }

      const device = devicesData.devices[0];
      const activeDeviceId = device.id;

      if (!device.is_active) {
        const transferResponse = await fetch(
          "https://api.spotify.com/v1/me/player",
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              device_ids: [activeDeviceId],
              play: false,
            }),
          }
        );

        if (!transferResponse.ok) {
          const errorData = await transferResponse.json();
          handleError("TRANSFER_PLAYBACK_ERROR", errorData.error.message);
          return;
        }
      }

      const trackUris = tracks.map((track) => track.uri);

      const playResponse = await fetch(
        "https://api.spotify.com/v1/me/player/play",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uris: trackUris,
            offset: {
              position: trackIndex,
            },
            device_id: activeDeviceId,
          }),
        }
      );

      if (!playResponse.ok) {
        const errorData = await playResponse.json();
        handleError("PLAY_TRACK_ERROR", errorData.error.message);
      }
    } catch (error) {
      handleError("PLAY_TRACK_REQUEST_ERROR", error.message);
    }
  };

  const onCloseAlert = useCallback(() => {
    setShowSuccess(false);
    setPressedButton(null);
  }, []);

  return (
    <div className="flex flex-col md:flex-row gap-8 pt-10 px-12 max-h-screen fadeIn-animation">
      <div className="md:w-1/3 h-screen sticky top-0">
        {mix?.images && mix.images.length > 0 ? (
          <div className="min-w-[280px] mr-10">
            <Image
              src={mix.images[0].url || "/images/not-playing.webp"}
              alt="Mix Cover"
              data-main-image
              width={280}
              height={280}
              className="aspect-square rounded-[12px] drop-shadow-xl"
            />
            <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
              {mix.name}
            </h4>
            <h4 className="text-[28px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
              {mix.tracks.length} Songs
            </h4>
          </div>
        ) : (
          <p>No image available</p>
        )}
      </div>

      <div className="md:w-2/3 ml-20 h-screen overflow-y-scroll scroll-container scroll-smooth pb-12">
        {tracks.map((track, index) => (
          <div key={track.id} className="flex gap-12 items-start mb-4">
            <div className="text-[32px] font-[580] text-center text-white/60 w-6 mt-3">
              {track.uri === currentlyPlayingTrackUri ? (
                <div className="w-5">
                  <section>
                    <div className="wave0"></div>
                    <div className="wave1"></div>
                    <div className="wave2"></div>
                    <div className="wave3"></div>
                  </section>
                </div>
              ) : (
                <p>{index + 1}</p>
              )}
            </div>

            <div className="flex-grow">
              <LongPressLink
                href="/now-playing"
                spotifyUrl={track.external_urls.spotify}
                accessToken={accessToken}
              >
                <div onClick={() => playTrack(track.uri, index)}>
                  <p className="text-[32px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                    {track.name}
                  </p>
                </div>
              </LongPressLink>
              <div className="flex flex-wrap">
                {track.artists.map((artist, artistIndex) => (
                  <LongPressLink
                    key={artist.id}
                    spotifyUrl={artist.external_urls.spotify}
                    accessToken={accessToken}
                  >
                    <p
                      className={`text-[28px] font-[560] text-white/60 truncate tracking-tight ${
                        artistIndex < track.artists.length - 1
                          ? 'mr-2 after:content-[","]'
                          : ""
                      }`}
                    >
                      {artist.name}
                    </p>
                  </LongPressLink>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <SuccessAlert
        show={showSuccess}
        onClose={onCloseAlert}
        message={`Mix mapped to Button ${pressedButton}`}
      />
    </div>
  );
};

export async function getServerSideProps(context) {
  const { mixId } = context.params;
  const { accessToken } = context.query;

  try {
    let storedMixes = [];
    const setRadio = (mixes) => {
      storedMixes = mixes;
    };

    const handleError = (type, message) => {
      throw new Error(message);
    };

    await fetchUserRadio(accessToken, setRadio, handleError);
    const initialMix = storedMixes.find((mix) => mix.id === mixId);

    if (!initialMix) {
      throw new Error("Mix not found");
    }

    return {
      props: {
        initialMix,
        accessToken,
        error: null,
      },
    };
  } catch (error) {
    return {
      props: {
        error: {
          type: "FETCH_MIX_ERROR",
          message: error.message,
        },
        initialMix: null,
        accessToken,
      },
    };
  }
}

export default MixPage;
