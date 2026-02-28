import React, { useMemo, useState, useEffect } from "react";
import { makeSocket } from "./net.js";
import Lobby from "./components/Lobby.jsx";
import Board from "./components/Board.jsx";

function getRoomFromUrl() {
    try {
        const url = new URL(window.location.href);
        const room = url.searchParams.get("room");
        return room ? String(room).trim().toUpperCase() : "";
    } catch {
        return "";
    }
}

function setRoomInUrl(roomId) {
    try {
        const url = new URL(window.location.href);
        if (roomId) url.searchParams.set("room", roomId);
        else url.searchParams.delete("room");
        window.history.replaceState({}, "", url.toString());
    } catch {
        // ignore
    }
}

export default function App() {
    const socket = useMemo(() => makeSocket(), []);
    const [session, setSession] = useState(null); // { roomId, selfId, state }
    const [prefillRoomId, setPrefillRoomId] = useState(() => getRoomFromUrl());

    // wenn User die URL manuell ändert (Back/Forward), RoomId neu übernehmen
    useEffect(() => {
        const onPop = () => setPrefillRoomId(getRoomFromUrl());
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);

    return (
        <div style={{ fontFamily: "system-ui, sans-serif", padding: 12 }}>
            <h2 style={{ margin: "6px 0 12px" }}>D&D Live Map (MVP)</h2>

            {!session ? (
                <Lobby
                    socket={socket}
                    prefillRoomId={prefillRoomId}
                    onJoined={(sess) => {
                        setSession(sess);
                        // ✅ URL sharebar machen
                        if (sess?.roomId) setRoomInUrl(sess.roomId);
                    }}
                />
            ) : (
                <Board
                    socket={socket}
                    session={session}
                    onLeave={() => {
                        setSession(null);
                        // ✅ optional: room in URL lassen (damit Rejoin easy ist)
                        // Wenn du es beim Leave entfernen willst, uncomment:
                        // setRoomInUrl("");
                    }}
                />
            )}

            <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12 }}>
                Tipp: Du kannst jetzt auch direkt Links teilen wie{" "}
                <span style={{ fontFamily: "monospace" }}>...?room=ABC123</span>
            </div>
        </div>
    );
}