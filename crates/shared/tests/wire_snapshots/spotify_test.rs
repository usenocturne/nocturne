use libnocturne::generated::spotify::*;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};

fn payload<'a>(snapshot: &'a Value, key: &str, kind: &str) -> &'a Value {
    snapshot
        .get(key)
        .and_then(|entry| entry.get(kind))
        .unwrap_or_else(|| panic!("missing {key}.{kind}"))
}

fn assert_round_trip<T>(snapshot: &Value, key: &str, kind: &str)
where
    T: DeserializeOwned + Serialize,
{
    let source = payload(snapshot, key, kind).clone();
    let typed: T = serde_json::from_value(source.clone())
        .unwrap_or_else(|error| panic!("{key}.{kind} failed to deserialize: {error}"));
    let encoded = serde_json::to_value(typed)
        .unwrap_or_else(|error| panic!("{key}.{kind} failed to serialize: {error}"));
    assert_eq!(encoded, source, "{key}.{kind} changed during round-trip");
}

fn assert_empty_payload<T>(snapshot: &Value, key: &str, kind: &str)
where
    T: DeserializeOwned + Serialize,
{
    let source = payload(snapshot, key, kind);
    assert_eq!(
        source,
        &json!(null),
        "{key}.{kind} must stay generated-unit null"
    );
    let typed: T = serde_json::from_value(source.clone())
        .unwrap_or_else(|error| panic!("{key}.{kind} failed to deserialize: {error}"));
    let encoded = serde_json::to_value(typed)
        .unwrap_or_else(|error| panic!("{key}.{kind} failed to serialize: {error}"));
    assert_eq!(encoded, *source, "{key}.{kind} changed during round-trip");
}

#[test]
fn spotify_wire_snapshots_round_trip() {
    let raw = include_str!("spotify.json").trim_end();
    let snapshot: Value = serde_json::from_str(raw).expect("spotify snapshot JSON must parse");
    let canonical =
        serde_json::to_string(&snapshot).expect("spotify snapshot must serialize canonically");
    assert_eq!(
        canonical, raw,
        "spotify snapshot must stay byte-stable canonical JSON"
    );

    assert_round_trip::<SpotifyAlbumGetRequest>(&snapshot, "spotify.album.get", "request");
    assert_empty_payload::<SpotifyAlbumGetResponse>(&snapshot, "spotify.album.get", "response");
    assert_round_trip::<SpotifyAlbumTracksRequest>(&snapshot, "spotify.album.tracks", "request");
    assert_empty_payload::<SpotifyAlbumTracksResponse>(
        &snapshot,
        "spotify.album.tracks",
        "response",
    );
    assert_round_trip::<SpotifyArtistGetRequest>(&snapshot, "spotify.artist.get", "request");
    assert_empty_payload::<SpotifyArtistGetResponse>(&snapshot, "spotify.artist.get", "response");
    assert_round_trip::<SpotifyArtistTopTracksRequest>(
        &snapshot,
        "spotify.artist.top_tracks",
        "request",
    );
    assert_empty_payload::<SpotifyArtistTopTracksResponse>(
        &snapshot,
        "spotify.artist.top_tracks",
        "response",
    );
    assert_round_trip::<SpotifyAuthCompletedEvent>(&snapshot, "spotify.auth.completed", "event");
    assert_empty_payload::<SpotifyAuthGetStatusRequest>(
        &snapshot,
        "spotify.auth.get_status",
        "request",
    );
    assert_round_trip::<SpotifyAuthGetStatusResponse>(
        &snapshot,
        "spotify.auth.get_status",
        "response",
    );
    assert_round_trip::<SpotifyAuthStatusEvent>(&snapshot, "spotify.auth.status", "event");
    assert_empty_payload::<SpotifyDevicesRequest>(&snapshot, "spotify.devices", "request");
    assert_empty_payload::<SpotifyDevicesResponse>(&snapshot, "spotify.devices", "response");
    assert_round_trip::<SpotifyDjSignalRequest>(&snapshot, "spotify.dj.signal", "request");
    assert_empty_payload::<SpotifyDjSignalResponse>(&snapshot, "spotify.dj.signal", "response");
    assert_empty_payload::<SpotifyDjStartRequest>(&snapshot, "spotify.dj.start", "request");
    assert_empty_payload::<SpotifyDjStartResponse>(&snapshot, "spotify.dj.start", "response");
    assert_round_trip::<SpotifyImageFetchRequest>(&snapshot, "spotify.image.fetch", "request");
    assert_round_trip::<SpotifyImageFetchResponse>(&snapshot, "spotify.image.fetch", "response");
    assert_round_trip::<SpotifyMePlaylistsRequest>(&snapshot, "spotify.me.playlists", "request");
    assert_empty_payload::<SpotifyMePlaylistsResponse>(
        &snapshot,
        "spotify.me.playlists",
        "response",
    );
    assert_empty_payload::<SpotifyMeProfileRequest>(&snapshot, "spotify.me.profile", "request");
    assert_empty_payload::<SpotifyMeProfileResponse>(&snapshot, "spotify.me.profile", "response");
    assert_round_trip::<SpotifyMeRecentlyPlayedRequest>(
        &snapshot,
        "spotify.me.recently_played",
        "request",
    );
    assert_empty_payload::<SpotifyMeRecentlyPlayedResponse>(
        &snapshot,
        "spotify.me.recently_played",
        "response",
    );
    assert_round_trip::<SpotifyMeShowsRequest>(&snapshot, "spotify.me.shows", "request");
    assert_empty_payload::<SpotifyMeShowsResponse>(&snapshot, "spotify.me.shows", "response");
    assert_round_trip::<SpotifyMeShowsContainsRequest>(
        &snapshot,
        "spotify.me.shows.contains",
        "request",
    );
    assert_empty_payload::<SpotifyMeShowsContainsResponse>(
        &snapshot,
        "spotify.me.shows.contains",
        "response",
    );
    assert_round_trip::<SpotifyMeShowsRemoveRequest>(
        &snapshot,
        "spotify.me.shows.remove",
        "request",
    );
    assert_empty_payload::<SpotifyMeShowsRemoveResponse>(
        &snapshot,
        "spotify.me.shows.remove",
        "response",
    );
    assert_round_trip::<SpotifyMeShowsSaveRequest>(&snapshot, "spotify.me.shows.save", "request");
    assert_empty_payload::<SpotifyMeShowsSaveResponse>(
        &snapshot,
        "spotify.me.shows.save",
        "response",
    );
    assert_round_trip::<SpotifyMeTopArtistsRequest>(&snapshot, "spotify.me.top_artists", "request");
    assert_empty_payload::<SpotifyMeTopArtistsResponse>(
        &snapshot,
        "spotify.me.top_artists",
        "response",
    );
    assert_round_trip::<SpotifyMeTopTracksRequest>(&snapshot, "spotify.me.top_tracks", "request");
    assert_empty_payload::<SpotifyMeTopTracksResponse>(
        &snapshot,
        "spotify.me.top_tracks",
        "response",
    );
    assert_round_trip::<SpotifyMeTracksRequest>(&snapshot, "spotify.me.tracks", "request");
    assert_empty_payload::<SpotifyMeTracksResponse>(&snapshot, "spotify.me.tracks", "response");
    assert_round_trip::<SpotifyMeTracksContainsRequest>(
        &snapshot,
        "spotify.me.tracks.contains",
        "request",
    );
    assert_empty_payload::<SpotifyMeTracksContainsResponse>(
        &snapshot,
        "spotify.me.tracks.contains",
        "response",
    );
    assert_round_trip::<SpotifyMeTracksRemoveRequest>(
        &snapshot,
        "spotify.me.tracks.remove",
        "request",
    );
    assert_empty_payload::<SpotifyMeTracksRemoveResponse>(
        &snapshot,
        "spotify.me.tracks.remove",
        "response",
    );
    assert_round_trip::<SpotifyMeTracksSaveRequest>(&snapshot, "spotify.me.tracks.save", "request");
    assert_empty_payload::<SpotifyMeTracksSaveResponse>(
        &snapshot,
        "spotify.me.tracks.save",
        "response",
    );
    assert_empty_payload::<SpotifyPlayerNextRequest>(&snapshot, "spotify.player.next", "request");
    assert_empty_payload::<SpotifyPlayerNextResponse>(&snapshot, "spotify.player.next", "response");
    assert_empty_payload::<SpotifyPlayerPauseRequest>(&snapshot, "spotify.player.pause", "request");
    assert_empty_payload::<SpotifyPlayerPauseResponse>(
        &snapshot,
        "spotify.player.pause",
        "response",
    );
    assert_round_trip::<SpotifyPlayerPlayRequest>(&snapshot, "spotify.player.play", "request");
    assert_empty_payload::<SpotifyPlayerPlayResponse>(&snapshot, "spotify.player.play", "response");
    assert_empty_payload::<SpotifyPlayerPreviousRequest>(
        &snapshot,
        "spotify.player.previous",
        "request",
    );
    assert_empty_payload::<SpotifyPlayerPreviousResponse>(
        &snapshot,
        "spotify.player.previous",
        "response",
    );
    assert_empty_payload::<SpotifyPlayerQueueRequest>(&snapshot, "spotify.player.queue", "request");
    assert_empty_payload::<SpotifyPlayerQueueResponse>(
        &snapshot,
        "spotify.player.queue",
        "response",
    );
    assert_round_trip::<SpotifyPlayerQueueAddRequest>(
        &snapshot,
        "spotify.player.queue.add",
        "request",
    );
    assert_empty_payload::<SpotifyPlayerQueueAddResponse>(
        &snapshot,
        "spotify.player.queue.add",
        "response",
    );
    assert_round_trip::<SpotifyPlayerRepeatRequest>(&snapshot, "spotify.player.repeat", "request");
    assert_empty_payload::<SpotifyPlayerRepeatResponse>(
        &snapshot,
        "spotify.player.repeat",
        "response",
    );
    assert_round_trip::<SpotifyPlayerSeekRequest>(&snapshot, "spotify.player.seek", "request");
    assert_empty_payload::<SpotifyPlayerSeekResponse>(&snapshot, "spotify.player.seek", "response");
    assert_round_trip::<SpotifyPlayerShuffleRequest>(
        &snapshot,
        "spotify.player.shuffle",
        "request",
    );
    assert_empty_payload::<SpotifyPlayerShuffleResponse>(
        &snapshot,
        "spotify.player.shuffle",
        "response",
    );
    assert_round_trip::<SpotifyPlayerSpeedRequest>(&snapshot, "spotify.player.speed", "request");
    assert_empty_payload::<SpotifyPlayerSpeedResponse>(
        &snapshot,
        "spotify.player.speed",
        "response",
    );
    assert_empty_payload::<SpotifyPlayerStateRequest>(&snapshot, "spotify.player.state", "request");
    assert_empty_payload::<SpotifyPlayerStateResponse>(
        &snapshot,
        "spotify.player.state",
        "response",
    );
    assert_round_trip::<SpotifyPlayerTransferRequest>(
        &snapshot,
        "spotify.player.transfer",
        "request",
    );
    assert_empty_payload::<SpotifyPlayerTransferResponse>(
        &snapshot,
        "spotify.player.transfer",
        "response",
    );
    assert_round_trip::<SpotifyPlayerVolumeRequest>(&snapshot, "spotify.player.volume", "request");
    assert_empty_payload::<SpotifyPlayerVolumeResponse>(
        &snapshot,
        "spotify.player.volume",
        "response",
    );
    assert_round_trip::<SpotifyPlaylistGetRequest>(&snapshot, "spotify.playlist.get", "request");
    assert_empty_payload::<SpotifyPlaylistGetResponse>(
        &snapshot,
        "spotify.playlist.get",
        "response",
    );
    assert_round_trip::<SpotifyPlaylistTracksRequest>(
        &snapshot,
        "spotify.playlist.tracks",
        "request",
    );
    assert_empty_payload::<SpotifyPlaylistTracksResponse>(
        &snapshot,
        "spotify.playlist.tracks",
        "response",
    );
    assert_empty_payload::<SpotifyRadioDiscoveriesRequest>(
        &snapshot,
        "spotify.radio.discoveries",
        "request",
    );
    assert_empty_payload::<SpotifyRadioDiscoveriesResponse>(
        &snapshot,
        "spotify.radio.discoveries",
        "response",
    );
    assert_empty_payload::<SpotifyRadioMixesRequest>(&snapshot, "spotify.radio.mixes", "request");
    assert_empty_payload::<SpotifyRadioMixesResponse>(&snapshot, "spotify.radio.mixes", "response");
    assert_round_trip::<SpotifyRadioPlaylistRequest>(
        &snapshot,
        "spotify.radio.playlist",
        "request",
    );
    assert_empty_payload::<SpotifyRadioPlaylistResponse>(
        &snapshot,
        "spotify.radio.playlist",
        "response",
    );
    assert_empty_payload::<SpotifyRadioTopMixRequest>(
        &snapshot,
        "spotify.radio.top_mix",
        "request",
    );
    assert_empty_payload::<SpotifyRadioTopMixResponse>(
        &snapshot,
        "spotify.radio.top_mix",
        "response",
    );
    assert_round_trip::<SpotifyShowEpisodesRequest>(&snapshot, "spotify.show.episodes", "request");
    assert_empty_payload::<SpotifyShowEpisodesResponse>(
        &snapshot,
        "spotify.show.episodes",
        "response",
    );
    assert_round_trip::<SpotifyShowGetRequest>(&snapshot, "spotify.show.get", "request");
    assert_empty_payload::<SpotifyShowGetResponse>(&snapshot, "spotify.show.get", "response");
    assert_round_trip::<SpotifyTrackLyricsRequest>(&snapshot, "spotify.track.lyrics", "request");
    assert_empty_payload::<SpotifyTrackLyricsResponse>(
        &snapshot,
        "spotify.track.lyrics",
        "response",
    );
}
