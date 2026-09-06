export type VoiceShelfItem = {
  uri: string;
  title: string;
  subtitle: string;
  image_url: string;
  kind: "track" | "artist" | "album" | "playlist";
};
type ShelfItemBase = {
  identifier: string;
  category: string;
  title?: string;
  subtitle?: string;
  uri?: string;
  image_id?: string;
  playable?: boolean;
  isCurrentlyPlaying?: boolean;
  isPlaying?: boolean;
  isDJ?: boolean;
  voiceKind?: VoiceShelfItem["kind"];
};
export type ShelfContextItem = ShelfItemBase & {
  type: "CONTEXT_ITEM";
  uri: string;
  title: string;
};
export type ShelfItem =
  | ShelfContextItem
  | (ShelfItemBase & {
      type:
        | "MORE_ITEM"
        | "SPACER_ITEM"
        | "VOICE_TEXT_PLACEHOLDER"
        | "INLINE_TIP_ITEM"
        | "TEXT_PLACEHOLDER"
        | "VOICE_DEFAULT";
    });
