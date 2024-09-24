import { useRouter } from "next/router";
import { useEffect } from "react";
import Link from "next/link";

const ArtistPage = ({ artist }) => {
  const router = useRouter();

  useEffect(() => {
    const artistImage =
      artist.images && artist.images.length > 0 ? artist.images[0].url : "";
    localStorage.setItem("artistPageImage", artistImage);
  }, [artist]);

  const playTrack = async (trackUri) => {
    const accessToken = router.query.accessToken;

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
        console.error("No devices available for playback");
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
          console.error("Error transferring playback:", errorData);
          return;
        }
      }

      const playResponse = await fetch(
        "https://api.spotify.com/v1/me/player/play",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uris: [trackUri],
            device_id: activeDeviceId,
          }),
        }
      );

      if (!playResponse.ok) {
        const errorData = await playResponse.json();
        console.error("Error playing track:", errorData);
      }
    } catch (error) {
      console.error("Error with playTrack request:", error);
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-8 pt-8 px-8 max-h-screen">
      <div className="md:w-1/3 h-screen sticky top-0">
        <div
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-2 text-white"
        >
          <p className="text-[20px] font-medium">{"<"}</p>
          <p className="text-[20px] font-medium">Back</p>
        </div>
        {artist.images && artist.images.length > 0 ? (
          <>
            <div className="min-w-[280px] mr-10">
              <img
                src={artist.images[0].url}
                alt="Artist"
                className="w-[280px] h-[280px] aspect-square rounded-full drop-shadow-xl"
              />
              <h4 className="mt-2 text-[24px] font-medium text-white truncate max-w-[280px]">
                {artist.name}
              </h4>
              <h4 className="text-[20px] font-base text-white">
                {artist.followers.total.toLocaleString()} Followers
              </h4>
            </div>
          </>
        ) : (
          <p>No image available</p>
        )}
      </div>

      <div className="md:w-2/3 ml-12 h-screen overflow-y-scroll scroll-container pb-12">
        {artist.topTracks && artist.topTracks.length > 0 ? (
          artist.topTracks.map((track, index) => (
            <Link
              key={track.id}
              href={`/now-playing?accessToken=${router.query.accessToken}`}
            >
              <div
                onClick={() => playTrack(track.uri)}
                className="flex gap-4 items-start mb-4"
              >
                <p className="text-[20px] font-medium text-white w-6 mt-3">
                  {index + 1}
                </p>

                <div>
                  <p className="text-[20px] font-medium text-white truncate max-w-[280px]">
                    {track.name}
                  </p>
                  <p className="text-[16px] font-light text-white truncate max-w-[280px]">
                    {track.artists.map((artist) => artist.name).join(", ")}
                  </p>
                </div>
              </div>
            </Link>
          ))
        ) : (
          <p>No tracks available</p>
        )}
      </div>
    </div>
  );
};

export async function getServerSideProps(context) {
  const { artistId } = context.params;
  const accessToken = context.query.accessToken;

  const res = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errorData = await res.json();
    console.error("Error fetching artist:", errorData);
    return {
      notFound: true,
    };
  }

  const artistData = await res.json();

  const topTracksRes = await fetch(
    `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const topTracksData = await topTracksRes.json();

  return {
    props: {
      artist: { ...artistData, topTracks: topTracksData.tracks },
    },
  };
}

export default ArtistPage;
