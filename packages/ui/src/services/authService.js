const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

async function decryptData(encryptedData, deviceId, salt) {
  const encryptedBytes = Uint8Array.from(atob(encryptedData), (c) =>
    c.charCodeAt(0)
  );
  const iv = encryptedBytes.slice(0, 12);
  const ciphertext = encryptedBytes.slice(12);

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(deviceId),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  const decryptedText = decoder.decode(decrypted);
  return JSON.parse(decryptedText);
}

export async function registerDevice() {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/auth/register-device`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Failed to register device");
    }

    const { deviceId, salt } = await response.json();
    return { deviceId, salt };
  } catch (error) {
    console.error("Error registering device:", error);
    throw error;
  }
}

export async function checkAuthStatus(deviceId) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/v1/auth/check-status/${deviceId}`
    );

    if (!response.ok) {
      throw new Error("Failed to check auth status");
    }

    const data = await response.json();

    if (data.status === "authorized" && data.encryptedData) {
      try {
        const decryptedCredentials = await decryptData(
          data.encryptedData,
          deviceId,
          data.salt
        );
        return {
          ...data,
          encryptedData: decryptedCredentials,
        };
      } catch (decryptError) {
        console.error("Error decrypting credentials:", decryptError);
        throw new Error("Failed to decrypt credentials");
      }
    }

    return data;
  } catch (error) {
    console.error("Error checking auth status:", error);
    throw error;
  }
}

export async function getAuthUrl(deviceId) {
  return `${API_BASE_URL}/v1/auth/ui/${deviceId}`;
}
