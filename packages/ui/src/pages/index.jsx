import Sidebar from "../components/Sidebar";
import Link from "next/link";

export default function Home({
  accessToken,
  albums,
  playlists,
  artists,
  radio,
  currentlyPlayingAlbum,
  activeSection,
  setActiveSection,
  loading,
}) {
  return (
    <div className="relative min-h-screen">
      {!loading && (
        <div className="relative z-10 pl-8 grid grid-cols-[1.5fr_3fr] fadeIn-animation">
          <Sidebar
            activeSection={activeSection}
            setActiveSection={setActiveSection}
          />

          <div className="flex overflow-x-auto scroll-container p-2">
            {activeSection === "home" && (
              <>
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
            {activeSection === "recents" && (
              <>
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
            {activeSection === "library" &&
              playlists.map((item) => (
                <Link
                  key={item.id}
                  href={`/playlist/${item.id}?accessToken=${accessToken}`}
                >
                  <div className="min-w-[280px] mr-10">
                    <img
                      src={item.images[0]?.url}
                      alt="Playlist Cover"
                      className="mt-16 w-[280px] h-[280px] aspect-square rounded-[12px] drop-shadow-xl"
                    />
                    <h4 className="mt-2 text-[24px] font-medium text-white truncate tracking-tight max-w-[280px]">
                      {item.name}
                    </h4>
                    <h4 className="text-[20px] font-base text-white truncate tracking-tight max-w-[280px]">
                      {item.tracks.total.toLocaleString()} Songs
                    </h4>
                  </div>
                </Link>
              ))}
            {activeSection === "artists" &&
              artists.map((artist) => (
                <Link
                  key={artist.id}
                  href={`/artist/${artist.id}?accessToken=${accessToken}`}
                >
                  <div className="min-w-[280px] mr-10">
                    <img
                      src={artist.images[0]?.url}
                      alt="Artist"
                      className="mt-16 w-[280px] h-[280px] aspect-square rounded-full drop-shadow-xl"
                    />
                    <h4 className="mt-2 text-[24px] font-medium text-white truncate tracking-tight max-w-[280px]">
                      {artist.name}
                    </h4>
                    <h4 className="text-[20px] font-base text-white truncate tracking-tight max-w-[280px]">
                      {artist.followers.total.toLocaleString()} Followers
                    </h4>
                  </div>
                </Link>
              ))}
            {activeSection === "radio" &&
              radio.map((playlist) => (
                <Link
                  key={playlist.id}
                  href={`/playlist/${playlist.id}?accessToken=${accessToken}`}
                >
                  <div className="min-w-[280px] mr-10">
                    <img
                      src={playlist.images[0]?.url}
                      alt="Playlist Cover"
                      className="mt-16 w-[280px] h-[280px] aspect-square rounded-[12px] drop-shadow-xl"
                    />
                    <h4 className="mt-2 text-[24px] font-medium text-white truncate tracking-tight max-w-[280px]">
                      {playlist.name}
                    </h4>
                    <h4 className="text-[20px] font-base text-white truncate tracking-tight max-w-[280px]">
                      {playlist.owner.display_name}
                    </h4>
                  </div>
                </Link>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
