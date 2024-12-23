export const setPlaybackShuffleState = async (
    accessToken,
    handleError,
    setIsShuffleEnabled
) => {
    try {
        const response = await fetch("https://api.spotify.com/v1/me/player", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        if (response.ok) {
            const data = await response.text();
            if (data.length > 0) {
                try {
                    const parsed = JSON.parse(JSON.stringify(data));
                    setIsShuffleEnabled(parsed.shuffle_state);
                } catch (error) {
                    handleError("FETCH_PLAYBACK_STATE_ERROR", error.message);
                }
            }
        }
    } catch (error) {
        handleError("FETCH_PLAYBACK_STATE_ERROR", error.message);
    }

}