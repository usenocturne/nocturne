const BASE = "";

export async function api<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: any) =>
  api<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });
