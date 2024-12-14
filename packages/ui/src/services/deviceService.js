export const getCurrentDevice = async function(accessToken, handleError) {

    try {
        const response = await fetch(
            "https://api.spotify.com/v1/me/player/devices",
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        if (response.ok) {
            const devicesData = await response.json();

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
        } else {
            console.error("Error fetching device list:", response.status);
            return null;
        }

    } catch (error) {
        handleError("Error fetching device list", error.message);
        return null;
    }
}