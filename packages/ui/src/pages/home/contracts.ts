import type { useSpotifyData } from "../../hooks/useSpotifyData";
import type { ContentType } from "../../types";

export type LibraryData = ReturnType<typeof useSpotifyData>;
export type OpenContent = (id: string, type: ContentType) => void;

export interface SectionProps {
  isSpotifySkipped: boolean;
  isLoading: LibraryData["isLoading"];
  activeSection: string;
  onCardClick: OpenContent;
}

export interface PlayingStateMap {
  likedSongs: boolean;
  playlistId: string | null;
  artistIds: Set<string | undefined>;
  mixUri: string | undefined;
  djPlaying: boolean;
}
