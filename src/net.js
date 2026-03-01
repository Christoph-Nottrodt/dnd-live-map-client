import { io } from "socket.io-client";

// ✅ Online-ready: per ENV steuerbar
// Lokal: keine .env nötig -> Fallback auf localhost:3001
export const SERVER_URL =
  (import.meta.env?.VITE_SERVER_URL && String(import.meta.env.VITE_SERVER_URL).trim()) ||
  "http://localhost:3001";

export function makeSocket() {
  return io(SERVER_URL, {
    transports: ["websocket"],
    withCredentials: true,
  });
}

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(`${SERVER_URL}/upload`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  if (!res.ok) throw new Error(`Upload failed (${res.status})`);

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Upload failed");

  return json.url;
}