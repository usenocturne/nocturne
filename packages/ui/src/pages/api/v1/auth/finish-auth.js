export const runtime = "experimental-edge";

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { deviceId } = await req.json();

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL}/v1/auth/check-status/${deviceId}`
    );

    if (!response.ok) {
      throw new Error("Failed to check auth status");
    }

    const status = await response.json();

    if (status.status !== "authorized") {
      return new Response(
        JSON.stringify({ error: "Authorization not complete" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        status: "complete",
        encryptedData: status.encryptedData,
        encryptionKey: status.encryptionKey,
        salt: status.salt,
        code: status.code,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error finishing auth:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to complete authentication",
        details: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
