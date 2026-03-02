import React, { useEffect, useMemo, useState } from "react";
import { uploadFile } from "../net.js";

const COLOR_OPTIONS = [
    { id: "cyan", label: "Cyan", value: "#00B3FF" },
    { id: "red", label: "Rot", value: "#FF3B3B" },
    { id: "green", label: "Grün", value: "#34C759" },
    { id: "purple", label: "Lila", value: "#AF52DE" },
    { id: "orange", label: "Orange", value: "#FF9500" },
    { id: "yellow", label: "Gelb", value: "#FFD60A" },
    { id: "teal", label: "Türkis", value: "#00C7BE" },
    { id: "pink", label: "Pink", value: "#FF2D55" },
    { id: "indigo", label: "Indigo", value: "#5E5CE6" },
    { id: "brown", label: "Braun", value: "#A2845E" },
];

function makeShareUrl(roomId) {
    try {
        const url = new URL(window.location.href);
        if (roomId) url.searchParams.set("room", roomId);
        return url.toString();
    } catch {
        return roomId ? `?room=${roomId}` : window.location.href;
    }
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            return ok;
        } catch {
            return false;
        }
    }
}

export default function Lobby({ socket, onJoined, prefillRoomId = "" }) {
    const [roomId, setRoomId] = useState(prefillRoomId || "");
    const [name, setName] = useState("Player");
    const [imgUrl, setImgUrl] = useState("");
    const [status, setStatus] = useState("");

    // share link UI
    const [shareUrl, setShareUrl] = useState("");

    // color picking
    const [pickedColor, setPickedColor] = useState(COLOR_OPTIONS[0].value);
    const [reservedColors, setReservedColors] = useState([]); // array of hex strings

    const ridNormalized = useMemo(() => roomId.trim().toUpperCase(), [roomId]);

    // ✅ prefill changes (when App reads URL / browser back-forward)
    useEffect(() => {
        if (typeof prefillRoomId === "string" && prefillRoomId.trim()) {
            setRoomId(prefillRoomId.trim().toUpperCase());
        }
    }, [prefillRoomId]);

    // Live updates from server when someone joins/leaves (best-effort)
    useEffect(() => {
        if (!socket) return;

        const onUpdate = (payload) => {
            const colors = Array.isArray(payload?.colors) ? payload.colors : [];
            setReservedColors(colors);

            // If our current pick became taken, auto switch to first free
            if (colors.includes(pickedColor)) {
                const firstFree = COLOR_OPTIONS.find((c) => !colors.includes(c.value));
                if (firstFree) setPickedColor(firstFree.value);
            }
        };

        socket.on("room:colors:update", onUpdate);
        return () => socket.off("room:colors:update", onUpdate);
    }, [socket, pickedColor]);

    // Ask server which colors are currently used in this room (best-effort)
    useEffect(() => {
        if (!socket) return;

        if (!ridNormalized) {
            setReservedColors([]);
            return;
        }

        let alive = true;
        socket.emit("room:colors", { roomId: ridNormalized }, (res) => {
            if (!alive) return;

            if (res?.ok && Array.isArray(res.colors)) {
                const colors = res.colors;
                setReservedColors(colors);

                if (colors.includes(pickedColor)) {
                    const firstFree = COLOR_OPTIONS.find((c) => !colors.includes(c.value));
                    if (firstFree) setPickedColor(firstFree.value);
                }
            } else {
                // Server may not implement color reservation -> don't block anything
                setReservedColors([]);
            }
        });

        return () => {
            alive = false;
        };
    }, [socket, ridNormalized, pickedColor]);

    const createRoom = () => {
        if (!socket) return;
        setStatus("Creating room...");
        setShareUrl("");

        socket.emit("room:create", {}, (res) => {
            if (!res?.ok || !res?.roomId) {
                setStatus(`Error creating room: ${res?.error || "unknown"}`);
                return;
            }

            const newRid = String(res.roomId).toUpperCase();
            setRoomId(newRid);
            setStatus(`Room created: ${newRid}`);

            // ✅ share link (online + local)
            const url = makeShareUrl(newRid);
            setShareUrl(url);

            // best-effort colors (server might not support)
            socket.emit("room:colors", { roomId: newRid }, (r2) => {
                if (r2?.ok && Array.isArray(r2.colors)) setReservedColors(r2.colors);
                else setReservedColors([]);
            });
        });
    };

    const joinRoom = () => {
        if (!socket) return;
        const rid = ridNormalized;
        if (!rid) return setStatus("Enter a room code.");
        setStatus("Joining...");

        socket.emit("room:join", { roomId: rid, name, imgUrl, color: pickedColor }, (res) => {
            if (!res?.ok) {
                if (res?.error === "COLOR_TAKEN") return setStatus("Join failed: Farbe ist bereits vergeben.");
                if (res?.error === "ROOM_NOT_FOUND") return setStatus("Join failed: Raum nicht gefunden.");
                return setStatus(`Join failed: ${res?.error || "unknown"}`);
            }

            setStatus("Joined ✅");

            // ✅ WICHTIG: Board erwartet diese Felder (name/imgUrl/color)
            onJoined({
                roomId: rid,
                selfId: socket.id,
                name,
                imgUrl,
                color: pickedColor,
                state: res.state,
            });
        });
    };

    const handleAvatarUpload = async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;

        setStatus("Uploading avatar...");

        try {
            const url = await uploadFile(f);
            setImgUrl(url);
            setStatus("Avatar uploaded ✅");
        } catch (err) {
            setStatus("Upload failed: " + (err?.message || String(err)));
        } finally {
            e.target.value = "";
        }
    };

    const isColorTaken = (hex) => reservedColors.includes(hex);

    return (
        <div style={{ maxWidth: 720 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={createRoom}>Raum erstellen</button>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <label>Raumcode</label>
                    <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="z.B. ABCD12" />
                    <button onClick={joinRoom}>Beitreten</button>
                </div>
            </div>

            {/* ✅ Share link after create */}
            {shareUrl && (
                <div
                    style={{
                        marginTop: 10,
                        padding: 10,
                        border: "1px solid #ddd",
                        borderRadius: 10,
                        background: "rgba(0,0,0,0.03)",
                    }}
                >
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Link zum Teilen</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input value={shareUrl} readOnly style={{ width: "min(560px, 100%)" }} />
                        <button
                            onClick={async () => {
                                const ok = await copyToClipboard(shareUrl);
                                setStatus(ok ? "Link kopiert ✅" : "Kopieren nicht möglich – bitte manuell markieren.");
                            }}
                        >
                            Copy
                        </button>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                        Tipp: Teile diesen Link. Er enthält automatisch <span style={{ fontFamily: "monospace" }}>?room=XXXXXX</span>.
                    </div>
                </div>
            )}

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <div>
                    <label style={{ display: "block", marginBottom: 4 }}>Dein Name</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
                </div>

                <div>
                    <label style={{ display: "block", marginBottom: 6 }}>Deine Farbe (Ring um Avatar)</label>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        {COLOR_OPTIONS.map((c) => {
                            const taken = isColorTaken(c.value);
                            const active = pickedColor === c.value;

                            return (
                                <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => !taken && setPickedColor(c.value)}
                                    disabled={taken}
                                    title={taken ? "Bereits vergeben" : c.label}
                                    style={{
                                        width: 34,
                                        height: 34,
                                        borderRadius: 999,
                                        border: active ? "3px solid black" : "2px solid rgba(0,0,0,0.35)",
                                        background: c.value,
                                        opacity: taken ? 0.25 : 1,
                                        cursor: taken ? "not-allowed" : "pointer",
                                    }}
                                />
                            );
                        })}

                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div
                                style={{
                                    width: 26,
                                    height: 26,
                                    borderRadius: 999,
                                    border: `5px solid ${pickedColor}`,
                                    background: "white",
                                }}
                                title="Vorschau"
                            />
                            <span style={{ fontSize: 12, opacity: 0.7 }}>
                                Vergebene Farben werden deaktiviert (wenn Server es unterstützt).
                            </span>
                        </div>
                    </div>
                </div>

                <div>
                    <label style={{ display: "block", marginBottom: 4 }}>Avatar-URL (optional)</label>

                    <input
                        value={imgUrl}
                        onChange={(e) => setImgUrl(e.target.value)}
                        placeholder="https://...png"
                        style={{ width: "100%" }}
                    />

                    <div style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <input type="file" accept="image/*" onChange={handleAvatarUpload} />
                        <span style={{ fontSize: 12, opacity: 0.7 }}>Oder lade ein Bild hoch (Handy/PC).</span>
                    </div>
                </div>

                <div style={{ marginTop: 4, fontSize: 13 }}>{status}</div>
            </div>
        </div>
    );
}