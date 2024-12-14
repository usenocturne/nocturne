export const getCurrentDevice = async function(accessToken) {
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
        return null;
    }

    let currentDevice = devicesData.devices[0];

    devicesData.devices.forEach((deviceData) => {
        if (deviceData.is_active) {
            currentDevice = deviceData
        }
    });

    return currentDevice;
}