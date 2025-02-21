import { generateRandomString } from "../lib/utils";

export const getCurrentDevice = async function (accessToken, handleError) {
  try {
    const response = await fetch(
      `https://gue1-spclient.spotify.com/connect-state/v1/devices/hobs_${generateRandomString(40)}`, {
      method: 'PUT',
      headers: {
        'accept': 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'authorization': `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'x-spotify-connection-id': generateRandomString(148).toString("base64")
      },
      body: JSON.stringify({
        'member_type': 'CONNECT_STATE',
        'device': {
          'device_info': {
            'capabilities': {
              'can_be_player': false,
              'hidden': true,
              'needs_full_player_state': true
            }
          }
        }
      })
    });

    if (response.ok) {
      const devicesData = await response.json();

      if (devicesData.devices.length === 0) {
        handleError(
          "NO_DEVICES_AVAILABLE",
          "No devices available for playback"
        );
        return null;
      }

      const d = Object.values(devicesData.devices)
      let currentDevice = d[0];

      d.forEach((device) => {
        if (devicesData.active_device_id === device.device_id) {
          currentDevice = device;
        }
      });

      return {
        id: devicesData.active_device_id || currentDevice?.device_id,
        ...currentDevice
      };
    } else {
      console.error("Error fetching device list:", response.status);
      return null;
    }

  } catch (error) {
    handleError("Error fetching device list", error.message);
    return null;
  }
}