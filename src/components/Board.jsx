import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Stage,
    Layer,
    Image as KonvaImage,
    Circle,
    Text,
    Group,
    Line,
    Rect,
} from "react-konva";
import { uploadFile } from "../net.js";

function useHtmlImage(url) {
    const [img, setImg] = useState(null);
    useEffect(() => {
        if (!url) return setImg(null);
        const i = new window.Image();
        i.crossOrigin = "anonymous";
        i.onload = () => setImg(i);
        i.onerror = () => setImg(null);
        i.src = url;
    }, [url]);
    return img;
}

/**
 * Pointy-top hex math
 * size = hex radius in px (center -> corner)
 */
function hexToPixel(q, r, size) {
    const x = size * Math.sqrt(3) * (q + r / 2);
    const y = size * (3 / 2) * r;
    return { x, y };
}

function pixelToHex(x, y, size) {
    const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / size;
    const r = (2 / 3 * y) / size;
    return { q, r };
}

function hexRound(q, r) {
    let x = q;
    let z = r;
    let y = -x - z;

    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);

    const x_diff = Math.abs(rx - x);
    const y_diff = Math.abs(ry - y);
    const z_diff = Math.abs(rz - z);

    if (x_diff > y_diff && x_diff > z_diff) rx = -ry - rz;
    else if (y_diff > z_diff) ry = -rx - rz;
    else rz = -rx - ry;

    return { q: rx, r: rz };
}

function snapPixelToHex(x, y, size) {
    const frac = pixelToHex(x, y, size);
    const rounded = hexRound(frac.q, frac.r);
    return hexToPixel(rounded.q, rounded.r, size);
}

function hexCornerPoints(cx, cy, size) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i - 30);
        pts.push(cx + size * Math.cos(angle));
        pts.push(cy + size * Math.sin(angle));
    }
    pts.push(pts[0], pts[1]);
    return pts;
}

function buildHexGridLines(mapW, mapH, size) {
    const lines = [];
    const rMin = -3;
    const rMax = Math.ceil(mapH / (1.5 * size)) + 3;
    const qSpan = Math.ceil(mapW / (Math.sqrt(3) * size)) + 4;

    for (let r = rMin; r <= rMax; r++) {
        for (let q = -qSpan; q <= qSpan; q++) {
            const { x, y } = hexToPixel(q, r, size);
            if (x < -2 * size || x > mapW + 2 * size) continue;
            if (y < -2 * size || y > mapH + 2 * size) continue;
            lines.push(hexCornerPoints(x, y, size));
        }
    }
    return lines;
}

function clampToMap(x, y, mapW, mapH) {
    return {
        x: Math.max(0, Math.min(x, mapW)),
        y: Math.max(0, Math.min(y, mapH)),
    };
}

/**
 * Stable color fallback (until Lobby+Server enforce unique picks)
 */
const PLAYER_COLOR_PALETTE = [
    "#00B3FF",
    "#FF3B3B",
    "#34C759",
    "#AF52DE",
    "#FF9500",
    "#FFD60A",
    "#00C7BE",
    "#FF2D55",
    "#5E5CE6",
    "#A2845E",
];

function hashToIndex(str, mod) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h % mod;
}

function getTokenRingColor(token) {
    if (token?.kind === "enemy") return "rgba(160,0,0,0.85)";
    if (typeof token?.color === "string" && token.color.trim()) return token.color.trim();
    const idx = hashToIndex(String(token?.id || ""), PLAYER_COLOR_PALETTE.length);
    return PLAYER_COLOR_PALETTE[idx];
}

function wallStyle(element) {
    if (element === "FIRE") {
        return {
            stroke: "rgba(255,60,0,0.95)",
            glow: "rgba(255,140,0,0.85)",
            label: "🔥 Feuerwand",
        };
    }
    return {
        stroke: "rgba(60,180,255,0.95)",
        glow: "rgba(140,230,255,0.85)",
        label: "❄️ Eiswand",
    };
}

function formatEventLine(ev) {
    if (!ev) return "";
    if (ev.type === "attack") return ev.text || `${ev.attackerName ?? "?"} → ${ev.targetName ?? "?"}`;
    if (ev.type === "note") return ev.text || ev.title || "Notiz";
    if (ev.type === "loot") return ev.text || ev.title || "Schatz";
    if (ev.type === "trap") return ev.text || ev.title || "Falle";
    if (ev.type === "effect") return ev.text || ev.title || "Effekt";
    return ev.text || ev.title || ev.type || "Event";
}

export default function Board({ socket, session, onLeave }) {
    const { roomId } = session;

    const [state, setState] = useState(session.state);
    const [mapUrl, setMapUrl] = useState(session.state.map.url);
    const [mapW, setMapW] = useState(session.state.map.width);
    const [mapH, setMapH] = useState(session.state.map.height);

    // Hex grid settings
    const [showGrid, setShowGrid] = useState(true);
    const [hexSize, setHexSize] = useState(45);

    // Event log
    const [events, setEvents] = useState([]);

    // Effects (persistent objects) - server stores in state.effects (object map)
    const [effects, setEffects] = useState(() => Object.values(session.state.effects || {}));

    // selection
    const [selectedId, setSelectedId] = useState(null);
    const [targetId, setTargetId] = useState(null);

    // Enemy creation UI
    const [enemyName, setEnemyName] = useState("Assassine");
    const [enemyImgUrl, setEnemyImgUrl] = useState("");
    const [placingEnemy, setPlacingEnemy] = useState(false);

    // effect placement + selection
    const [selectedEffectId, setSelectedEffectId] = useState(null);

    // placement mode:
    // null
    // { mode:"MARKER", markerType:"TREASURE"|"TRAP", label:string }
    // { mode:"WALL", element:"FIRE"|"ICE", step:1|2, from:{x,y}|null }
    const [placeMode, setPlaceMode] = useState(null);

    // event/effect UI inputs
    const [eventKind, setEventKind] = useState("ATTACK"); // ATTACK | TREASURE | TRAP | NOTE | WALL_FIRE | WALL_ICE
    const [noteText, setNoteText] = useState("Eine Notiz…");
    const [treasureLabel, setTreasureLabel] = useState("Truhe");
    const [trapLabel, setTrapLabel] = useState("Falle");

    // NEW: DM login
    const [dmPasswordInput, setDmPasswordInput] = useState("");

    // stage viewport
    const stageRef = useRef(null);
    const [view, setView] = useState({ x: 0, y: 0, scale: 0.5 });
    const [isPanning, setIsPanning] = useState(false);
    const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });

    const bgImg = useHtmlImage(state.map.url);

    const selfId = socket.id;
    const isDm = !!state?.dmId && state.dmId === selfId;

    const selectedEffect = useMemo(
        () => effects.find((e) => e.id === selectedEffectId) || null,
        [effects, selectedEffectId]
    );

    const attemptDmLogin = () => {
        const pw = String(dmPasswordInput || "");
        socket.emit("dm:login", { roomId, password: pw }, (res) => {
            if (!res?.ok) {
                alert("DM Login fehlgeschlagen: " + (res?.error || "unknown"));
                return;
            }
            setDmPasswordInput("");
        });
    };

    useEffect(() => {
        const onPatch = (patch) => {
            setState((prev) => {
                const next = structuredClone(prev);

                if (patch.type === "map:set") next.map = patch.map;
                else if (patch.type === "token:upsert") next.tokens[patch.token.id] = patch.token;
                else if (patch.type === "token:move") {
                    const t = next.tokens[patch.id];
                    if (t) {
                        t.x = patch.x;
                        t.y = patch.y;
                    }
                } else if (patch.type === "token:remove") {
                    delete next.tokens[patch.id];
                } else if (patch.type === "room:dm") {
                    next.dmId = patch.dmId;
                } else if (patch.type === "effect:upsert") {
                    next.effects = next.effects || {};
                    next.effects[patch.effect.id] = patch.effect;

                    setEffects((prevEff) => {
                        const idx = prevEff.findIndex((x) => x.id === patch.effect.id);
                        if (idx >= 0) {
                            const arr = prevEff.slice();
                            arr[idx] = patch.effect;
                            return arr;
                        }
                        return [...prevEff, patch.effect];
                    });
                } else if (patch.type === "effect:remove") {
                    next.effects = next.effects || {};
                    delete next.effects[patch.id];
                    setEffects((prevEff) => prevEff.filter((x) => x.id !== patch.id));
                    setSelectedEffectId((cur) => (cur === patch.id ? null : cur));
                }

                return next;
            });
        };

        const onEvent = (ev) => {
            setEvents((prev) => {
                const next = [...prev, ev];
                return next.slice(-80);
            });
        };

        socket.on("state:patch", onPatch);
        socket.on("event:new", onEvent);

        return () => {
            socket.off("state:patch", onPatch);
            socket.off("event:new", onEvent);
        };
    }, [socket]);

    // 2.5D: Sort tokens by y so lower tokens render "in front"
    const tokensArr = useMemo(() => {
        return Object.values(state.tokens).sort((a, b) => (a.y || 0) - (b.y || 0));
    }, [state.tokens]);

    const gridLines = useMemo(() => {
        if (!showGrid) return [];
        return buildHexGridLines(state.map.width, state.map.height, hexSize);
    }, [showGrid, state.map.width, state.map.height, hexSize]);

    const setMap = () => {
        socket.emit("map:set", { roomId, url: mapUrl, width: mapW, height: mapH }, (res) => {
            if (res && res.ok === false) alert("Map set failed: " + (res.error || "unknown"));
        });
    };

    const handleMapUpload = async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
            const url = await uploadFile(f);
            setMapUrl(url);
        } catch (err) {
            alert("Map upload failed: " + (err?.message || String(err)));
        } finally {
            e.target.value = "";
        }
    };

    const handleEnemyUpload = async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
            const url = await uploadFile(f);
            setEnemyImgUrl(url);
        } catch (err) {
            alert("Enemy avatar upload failed: " + (err?.message || String(err)));
        } finally {
            e.target.value = "";
        }
    };

    const onWheel = (e) => {
        e.evt.preventDefault();
        const stage = stageRef.current;
        if (!stage) return;

        const oldScale = view.scale;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const scaleBy = 1.06;
        const direction = e.evt.deltaY > 0 ? -1 : 1;
        const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

        const mousePointTo = {
            x: (pointer.x - view.x) / oldScale,
            y: (pointer.y - view.y) / oldScale,
        };

        const newPos = {
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
        };

        setView((v) => ({
            ...v,
            x: newPos.x,
            y: newPos.y,
            scale: Math.max(0.15, Math.min(newScale, 2.5)),
        }));
    };

    const startPan = (e) => {
        const isMiddle = e.evt.button === 1;
        const isShiftLeft = e.evt.button === 0 && e.evt.shiftKey;
        if (!isMiddle && !isShiftLeft) return;

        setIsPanning(true);
        panStart.current = { x: e.evt.clientX, y: e.evt.clientY, vx: view.x, vy: view.y };
    };

    const movePan = (e) => {
        if (!isPanning) return;
        const dx = e.evt.clientX - panStart.current.x;
        const dy = e.evt.clientY - panStart.current.y;
        setView((v) => ({ ...v, x: panStart.current.vx + dx, y: panStart.current.vy + dy }));
    };

    const endPan = () => setIsPanning(false);

    const moveSelfToken = (x, y) => {
        setState((prev) => {
            const next = structuredClone(prev);
            const t = next.tokens[selfId];
            if (t) {
                t.x = x;
                t.y = y;
            }
            return next;
        });
        socket.emit("token:move", { roomId, x, y }, () => { });
    };

    // stage size
    const [stageSize, setStageSize] = useState({ w: 1100, h: 700 });
    useEffect(() => {
        const onResize = () => {
            const w = Math.max(900, Math.min(window.innerWidth - 40, 1600));
            const h = Math.max(600, Math.min(window.innerHeight - 220, 1000));
            setStageSize({ w, h });
        };
        onResize();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    const selected = selectedId ? state.tokens[selectedId] : null;
    const target = targetId ? state.tokens[targetId] : null;
    const canAttack = selected && target && selectedId !== targetId;

    const triggerAttack = () => {
        if (!canAttack) return;
        const text = `${selected.name} greift ${target.name} an!`;
        socket.emit("event:attack", { roomId, attackerId: selectedId, targetId: targetId, text }, (res) => {
            if (!res?.ok) alert("Attack event failed: " + (res?.error || "unknown"));
        });
    };

    const triggerNote = () => {
        socket.emit(
            "event:log",
            { roomId, type: "note", title: "Notiz", text: String(noteText || "").slice(0, 240) },
            (res) => {
                if (res && res.ok === false) alert("Note failed: " + (res.error || "unknown"));
            }
        );
    };

    const handleDeleteEffect = (id) => {
        if (!id) return;
        if (!isDm) return;

        socket.emit("effect:remove", { roomId, id }, (res) => {
            if (res && res.ok === false) {
                alert("Löschen fehlgeschlagen: " + (res.error || "unknown"));
            }
        });

        setEffects((prev) => prev.filter((x) => x.id !== id));
        setSelectedEffectId((cur) => (cur === id ? null : cur));
    };

    function getWorldFromEvent() {
        const stage = stageRef.current;
        if (!stage) return null;
        const pointer = stage.getPointerPosition();
        if (!pointer) return null;
        const worldX = (pointer.x - view.x) / view.scale;
        const worldY = (pointer.y - view.y) / view.scale;
        return { worldX, worldY };
    }

    function snapClampWorld(worldX, worldY) {
        const snapped = snapPixelToHex(worldX, worldY, hexSize);
        return clampToMap(snapped.x, snapped.y, state.map.width, state.map.height);
    }

    // Enemy placement + effect placement (walls/markers)
    const onStageMouseDown = (e) => {
        startPan(e);

        // don't place while panning
        const isMiddle = e.evt.button === 1;
        const isShiftLeft = e.evt.button === 0 && e.evt.shiftKey;
        if (isMiddle || isShiftLeft) return;

        // only normal left click
        if (e.evt.button !== 0) return;

        // click empty area: deselect effect
        if (!placingEnemy && !placeMode) {
            setSelectedEffectId(null);
        }

        const p = getWorldFromEvent();
        if (!p) return;
        const pos = snapClampWorld(p.worldX, p.worldY);

        // DM-only placing: enemy/effects
        if (!isDm && (placingEnemy || placeMode)) {
            setPlacingEnemy(false);
            setPlaceMode(null);
            alert("Nur der DM darf Gegner/Effekte platzieren.");
            return;
        }

        // place enemy
        if (placingEnemy) {
            socket.emit(
                "token:addEnemy",
                { roomId, name: enemyName, imgUrl: enemyImgUrl, x: pos.x, y: pos.y },
                (res) => {
                    if (!res?.ok) alert("Add enemy failed: " + (res?.error || "unknown"));
                }
            );
            setPlacingEnemy(false);
            return;
        }

        // place marker/wall
        if (placeMode) {
            if (placeMode.mode === "MARKER") {
                const markerType = placeMode.markerType; // TREASURE | TRAP
                const label = placeMode.label;

                socket.emit(
                    "effect:add",
                    {
                        roomId,
                        effect: {
                            kind: "marker",
                            markerType,
                            label,
                            x: pos.x,
                            y: pos.y,
                        },
                    },
                    (res) => {
                        if (res && res.ok === false) alert("Effect add failed: " + (res.error || "unknown"));
                    }
                );

                socket.emit(
                    "event:log",
                    {
                        roomId,
                        type: markerType === "TREASURE" ? "loot" : "trap",
                        title: markerType === "TREASURE" ? "Schatz" : "Falle",
                        text: `${markerType === "TREASURE" ? "Schatz" : "Falle"} platziert: ${label}`,
                    },
                    () => { }
                );

                setPlaceMode(null);
                return;
            }

            if (placeMode.mode === "WALL") {
                if (placeMode.step === 1) {
                    setPlaceMode({ ...placeMode, step: 2, from: { x: pos.x, y: pos.y } });
                    return;
                }

                const from = placeMode.from;
                if (!from) {
                    setPlaceMode(null);
                    return;
                }

                const element = placeMode.element; // FIRE | ICE
                const style = wallStyle(element);

                socket.emit(
                    "effect:add",
                    {
                        roomId,
                        effect: {
                            kind: "wall",
                            element,
                            label: style.label,
                            color: style.stroke,
                            glow: style.glow,
                            x1: from.x,
                            y1: from.y,
                            x2: pos.x,
                            y2: pos.y,
                            thickness: 10,
                        },
                    },
                    (res) => {
                        if (res && res.ok === false) alert("Effect add failed: " + (res.error || "unknown"));
                    }
                );

                socket.emit(
                    "event:log",
                    {
                        roomId,
                        type: "effect",
                        title: "Effekt",
                        text: `${element === "FIRE" ? "Feuerwand" : "Eiswand"} gesetzt`,
                    },
                    () => { }
                );

                setPlaceMode(null);
                return;
            }
        }
    };

    // Persistent attack line
    const persistentLine = useMemo(() => {
        if (!selectedId || !targetId) return null;
        const a = state.tokens[selectedId];
        const b = state.tokens[targetId];
        if (!a || !b) return null;

        const color = getTokenRingColor(a);
        return { ax: a.x, ay: a.y, bx: b.x, by: b.y, color };
    }, [state.tokens, selectedId, targetId]);

    const walls = useMemo(() => effects.filter((e) => e.kind === "wall"), [effects]);
    const markers = useMemo(() => effects.filter((e) => e.kind === "marker"), [effects]);

    return (
        <div>
            <div style={{ display: "flex", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
                {/* Left */}
                <div style={{ flex: 1, minWidth: 720 }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                        <div>
                            <strong>Raum:</strong> <span style={{ fontFamily: "monospace" }}>{roomId}</span>
                            <span style={{ marginLeft: 10, fontSize: 12, opacity: 0.75 }}>
                                {isDm ? "DM" : "Spieler"}
                            </span>
                        </div>

                        <button onClick={onLeave}>Verlassen</button>

                        <div style={{ flex: 1 }} />

                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <input
                                value={mapUrl}
                                onChange={(e) => setMapUrl(e.target.value)}
                                placeholder="Map URL (png/jpg)"
                                style={{ width: 260 }}
                                disabled={!isDm}
                            />
                            <input value={mapW} onChange={(e) => setMapW(e.target.value)} style={{ width: 90 }} disabled={!isDm} />
                            <input value={mapH} onChange={(e) => setMapH(e.target.value)} style={{ width: 90 }} disabled={!isDm} />
                            <button onClick={setMap} disabled={!isDm}>Karte setzen</button>
                            <input type="file" accept="image/*" onChange={handleMapUpload} disabled={!isDm} />

                            <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 10 }}>
                                <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                                Hex-Grid
                            </label>

                            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                Hex Größe
                                <input
                                    type="number"
                                    value={hexSize}
                                    min={15}
                                    max={140}
                                    onChange={(e) => setHexSize(Number(e.target.value) || 45)}
                                    style={{ width: 70 }}
                                />
                                px
                            </label>
                        </div>
                    </div>

                    <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
                        <Stage
                            ref={stageRef}
                            width={stageSize.w}
                            height={stageSize.h}
                            onWheel={onWheel}
                            onMouseDown={onStageMouseDown}
                            onMouseMove={movePan}
                            onMouseUp={endPan}
                            onMouseLeave={endPan}
                            draggable={false}
                            style={{ background: "#f6f6f6" }}
                        >
                            <Layer x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
                                {bgImg && (
                                    <KonvaImage image={bgImg} x={0} y={0} width={state.map.width} height={state.map.height} />
                                )}

                                {showGrid &&
                                    gridLines.map((pts, idx) => (
                                        <Line
                                            key={idx}
                                            points={pts}
                                            closed={false}
                                            strokeWidth={1}
                                            stroke={"rgba(0,0,0,0.25)"}
                                            listening={false}
                                        />
                                    ))}

                                {/* EFFECTS: walls */}
                                {walls.map((w) => {
                                    const element = w.element === "FIRE" ? "FIRE" : "ICE";
                                    const style = wallStyle(element);
                                    const stroke = w.color || style.stroke;
                                    const glow = w.glow || style.glow;
                                    const thick = w.thickness ?? 10;

                                    const isSel = w.id === selectedEffectId;

                                    return (
                                        <Group
                                            key={w.id}
                                            listening={true}
                                            onMouseDown={(ev) => {
                                                ev.cancelBubble = true;
                                                setSelectedEffectId(w.id);
                                            }}
                                            onContextMenu={(ev) => {
                                                if (!isDm) return;
                                                ev.evt.preventDefault();
                                                ev.cancelBubble = true;
                                                handleDeleteEffect(w.id);
                                            }}
                                        >
                                            {isSel && (
                                                <Line
                                                    points={[w.x1, w.y1, w.x2, w.y2]}
                                                    stroke={"rgba(255,255,255,0.95)"}
                                                    strokeWidth={thick + 12}
                                                    lineCap="round"
                                                    lineJoin="round"
                                                    opacity={0.95}
                                                    shadowColor={"rgba(0,0,0,0.35)"}
                                                    shadowBlur={12}
                                                    shadowOpacity={0.6}
                                                />
                                            )}

                                            <Line
                                                points={[w.x1, w.y1, w.x2, w.y2]}
                                                stroke={glow}
                                                strokeWidth={thick + 14}
                                                lineCap="round"
                                                lineJoin="round"
                                                opacity={0.55}
                                                shadowColor={glow}
                                                shadowBlur={18}
                                                shadowOpacity={0.7}
                                                listening={false}
                                            />
                                            <Line
                                                points={[w.x1, w.y1, w.x2, w.y2]}
                                                stroke={stroke}
                                                strokeWidth={thick}
                                                lineCap="round"
                                                lineJoin="round"
                                                opacity={0.95}
                                                listening={false}
                                            />

                                            <Text
                                                text={w.label || style.label}
                                                x={(w.x1 + w.x2) / 2 - 50}
                                                y={(w.y1 + w.y2) / 2 - 28}
                                                fontSize={14}
                                                fill={"rgba(0,0,0,0.85)"}
                                                listening={false}
                                            />
                                        </Group>
                                    );
                                })}

                                {/* EFFECTS: markers */}
                                {markers.map((m) => {
                                    const markerType = m.markerType === "TREASURE" ? "TREASURE" : "TRAP";
                                    const isSel = m.id === selectedEffectId;

                                    const fill =
                                        markerType === "TREASURE" ? "rgba(255,215,0,0.85)" : "rgba(150,0,200,0.8)";
                                    const stroke =
                                        markerType === "TREASURE" ? "rgba(120,80,0,0.95)" : "rgba(40,0,60,0.95)";

                                    return (
                                        <Group
                                            key={m.id}
                                            x={m.x}
                                            y={m.y}
                                            listening={true}
                                            onMouseDown={(ev) => {
                                                ev.cancelBubble = true;
                                                setSelectedEffectId(m.id);
                                            }}
                                            onContextMenu={(ev) => {
                                                if (!isDm) return;
                                                ev.evt.preventDefault();
                                                ev.cancelBubble = true;
                                                handleDeleteEffect(m.id);
                                            }}
                                        >
                                            {isSel && (
                                                <Circle
                                                    x={0}
                                                    y={0}
                                                    radius={22}
                                                    stroke={"rgba(255,255,255,0.95)"}
                                                    strokeWidth={6}
                                                    shadowColor={"rgba(0,0,0,0.35)"}
                                                    shadowBlur={10}
                                                    shadowOpacity={0.6}
                                                    listening={false}
                                                />
                                            )}

                                            <Circle x={0} y={0} radius={16} fill={fill} stroke={stroke} strokeWidth={3} />
                                            <Text
                                                text={markerType === "TREASURE" ? "💰" : "⚠️"}
                                                x={-10}
                                                y={-12}
                                                fontSize={18}
                                                fill={"black"}
                                                listening={false}
                                            />
                                            <Text
                                                text={m.label || (markerType === "TREASURE" ? "Schatz" : "Falle")}
                                                x={-90}
                                                y={22}
                                                width={180}
                                                align="center"
                                                fontSize={12}
                                                fill={"rgba(0,0,0,0.85)"}
                                                listening={false}
                                            />
                                        </Group>
                                    );
                                })}

                                {/* Persistent Attack Line */}
                                {persistentLine && (
                                    <Group listening={false}>
                                        <Line
                                            points={[persistentLine.ax, persistentLine.ay, persistentLine.bx, persistentLine.by]}
                                            stroke={persistentLine.color || "red"}
                                            strokeWidth={6}
                                            lineCap="round"
                                            lineJoin="round"
                                            opacity={0.95}
                                            shadowColor={persistentLine.color || "red"}
                                            shadowBlur={10}
                                            shadowOpacity={0.6}
                                        />
                                        <ArrowHead
                                            ax={persistentLine.ax}
                                            ay={persistentLine.ay}
                                            bx={persistentLine.bx}
                                            by={persistentLine.by}
                                            color={persistentLine.color || "red"}
                                        />
                                    </Group>
                                )}

                                {/* Tokens */}
                                {tokensArr.map((t) => (
                                    <Token
                                        key={t.id}
                                        token={t}
                                        isSelf={t.id === selfId}
                                        selected={t.id === selectedId}
                                        targeted={t.id === targetId}
                                        hexSize={hexSize}
                                        mapW={state.map.width}
                                        mapH={state.map.height}
                                        onMove={(nx, ny) => moveSelfToken(nx, ny)}
                                        onClick={() => {
                                            if (!selectedId || selectedId === t.id) {
                                                setSelectedId(t.id);
                                                setTargetId(null);
                                            } else {
                                                setTargetId(t.id);
                                            }
                                        }}
                                    />
                                ))}

                                {/* placing hint */}
                                {(placingEnemy || placeMode) && (
                                    <Group listening={false}>
                                        <Rect x={0} y={0} width={state.map.width} height={state.map.height} fill="rgba(0,0,0,0.08)" />
                                        <Text
                                            text={
                                                placingEnemy
                                                    ? "Klicke auf die Karte, um den Gegner zu platzieren…"
                                                    : placeMode?.mode === "MARKER"
                                                        ? `Klicke: ${placeMode.markerType === "TREASURE" ? "Schatz" : "Falle"} platzieren…`
                                                        : placeMode?.mode === "WALL" && placeMode.step === 1
                                                            ? `Klicke Startpunkt: ${placeMode.element === "FIRE" ? "Feuerwand" : "Eiswand"}…`
                                                            : `Klicke Endpunkt: ${placeMode?.element === "FIRE" ? "Feuerwand" : "Eiswand"}…`
                                            }
                                            x={20}
                                            y={20}
                                            fontSize={18}
                                            fill={"black"}
                                        />
                                    </Group>
                                )}
                            </Layer>
                        </Stage>
                    </div>

                    <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
                        Steuerung: Token ziehen = bewegen (nur dein Token, snapt auf Hex). Zoom: Mausrad. Pan: Shift+Linksklick ziehen oder
                        Mausrad-Klick ziehen. Auswahl: 1x klick = Angreifer, 2. klick = Ziel.
                        <br />
                        Effekte: Marker/Walls platzieren per Linksklick. Löschen: Effekt anklicken → (nur DM) löschen.
                    </div>
                </div>

                {/* Right */}
                <div style={{ width: 360 }}>
                    {/* DM LOGIN */}
                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>DM Login</div>

                        {isDm ? (
                            <div style={{ fontSize: 13, color: "green" }}>Du bist der DM 👑</div>
                        ) : (
                            <>
                                <input
                                    type="password"
                                    placeholder="DM Passwort"
                                    value={dmPasswordInput}
                                    onChange={(e) => setDmPasswordInput(e.target.value)}
                                    style={{ width: "100%", marginBottom: 6 }}
                                />
                                <button onClick={attemptDmLogin} disabled={!dmPasswordInput.trim()}>
                                    Als DM anmelden
                                </button>
                                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                                    Hinweis: Ohne DM Login sind Map/Gegner/Effekte gesperrt.
                                </div>
                            </>
                        )}
                    </div>

                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Gegner hinzufügen</div>

                        <div style={{ display: "grid", gap: 8 }}>
                            <div>
                                <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>Name</label>
                                <input value={enemyName} onChange={(e) => setEnemyName(e.target.value)} style={{ width: "100%" }} />
                            </div>

                            <div>
                                <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>Avatar URL (optional)</label>
                                <input
                                    value={enemyImgUrl}
                                    onChange={(e) => setEnemyImgUrl(e.target.value)}
                                    placeholder="https://...png"
                                    style={{ width: "100%" }}
                                />
                            </div>

                            <div>
                                <input type="file" accept="image/*" onChange={handleEnemyUpload} disabled={!isDm} />
                            </div>

                            <button
                                onClick={() => {
                                    if (!isDm) return alert("Nur der DM darf Gegner platzieren.");
                                    setPlaceMode(null);
                                    setPlacingEnemy(true);
                                }}
                                disabled={!isDm || placingEnemy}
                                style={{ background: placingEnemy ? "#ddd" : undefined }}
                            >
                                Gegner platzieren (Klick auf Karte)
                            </button>
                        </div>
                    </div>

                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Events & Effekte</div>

                        <div style={{ display: "grid", gap: 8 }}>
                            <div>
                                <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>Aktion</label>
                                <select value={eventKind} onChange={(e) => setEventKind(e.target.value)} style={{ width: "100%" }}>
                                    <option value="ATTACK">Angriff</option>
                                    <option value="TREASURE">Eventmarker: Schatz</option>
                                    <option value="TRAP">Eventmarker: Falle</option>
                                    <option value="NOTE">Notiz (nur Log)</option>
                                    <option value="WALL_FIRE">Feuerwand setzen</option>
                                    <option value="WALL_ICE">Eiswand setzen</option>
                                </select>
                            </div>

                            {eventKind === "ATTACK" && (
                                <>
                                    <div style={{ fontSize: 13 }}>
                                        <div>
                                            Angreifer: <strong>{selected ? selected.name : "—"}</strong>
                                        </div>
                                        <div>
                                            Ziel: <strong>{target ? target.name : "—"}</strong>
                                        </div>
                                    </div>

                                    <div>
                                        <button onClick={triggerAttack} disabled={!canAttack}>
                                            Attack triggern
                                        </button>

                                        <button
                                            style={{ marginLeft: 8 }}
                                            onClick={() => {
                                                setSelectedId(null);
                                                setTargetId(null);
                                            }}
                                        >
                                            Auswahl löschen
                                        </button>
                                    </div>
                                </>
                            )}

                            {eventKind === "NOTE" && (
                                <>
                                    <div>
                                        <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>Text</label>
                                        <textarea
                                            value={noteText}
                                            onChange={(e) => setNoteText(e.target.value)}
                                            rows={3}
                                            style={{ width: "100%" }}
                                        />
                                    </div>
                                    <button
                                        onClick={() => {
                                            setPlacingEnemy(false);
                                            setPlaceMode(null);
                                            triggerNote();
                                        }}
                                    >
                                        Notiz ins Log
                                    </button>
                                </>
                            )}

                            {eventKind === "TREASURE" && (
                                <>
                                    <div>
                                        <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>Label</label>
                                        <input
                                            value={treasureLabel}
                                            onChange={(e) => setTreasureLabel(e.target.value)}
                                            style={{ width: "100%" }}
                                            disabled={!isDm}
                                        />
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (!isDm) return alert("Nur der DM darf Marker platzieren.");
                                            setPlacingEnemy(false);
                                            setPlaceMode({ mode: "MARKER", markerType: "TREASURE", label: treasureLabel || "Schatz" });
                                        }}
                                        disabled={!isDm}
                                    >
                                        Schatz platzieren (Klick auf Karte)
                                    </button>
                                </>
                            )}

                            {eventKind === "TRAP" && (
                                <>
                                    <div>
                                        <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>Label</label>
                                        <input
                                            value={trapLabel}
                                            onChange={(e) => setTrapLabel(e.target.value)}
                                            style={{ width: "100%" }}
                                            disabled={!isDm}
                                        />
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (!isDm) return alert("Nur der DM darf Marker platzieren.");
                                            setPlacingEnemy(false);
                                            setPlaceMode({ mode: "MARKER", markerType: "TRAP", label: trapLabel || "Falle" });
                                        }}
                                        disabled={!isDm}
                                    >
                                        Falle platzieren (Klick auf Karte)
                                    </button>
                                </>
                            )}

                            {(eventKind === "WALL_FIRE" || eventKind === "WALL_ICE") && (
                                <>
                                    <div style={{ fontSize: 12, opacity: 0.8 }}>2 Klicks: Startpunkt → Endpunkt</div>
                                    <button
                                        onClick={() => {
                                            if (!isDm) return alert("Nur der DM darf Wände setzen.");
                                            setPlacingEnemy(false);
                                            setPlaceMode({
                                                mode: "WALL",
                                                element: eventKind === "WALL_FIRE" ? "FIRE" : "ICE",
                                                step: 1,
                                                from: null,
                                            });
                                        }}
                                        disabled={!isDm}
                                    >
                                        {eventKind === "WALL_FIRE" ? "Feuerwand setzen" : "Eiswand setzen"} (2 Klicks)
                                    </button>
                                </>
                            )}

                            {(placingEnemy || placeMode) && (
                                <button
                                    onClick={() => {
                                        setPlacingEnemy(false);
                                        setPlaceMode(null);
                                    }}
                                >
                                    Platzieren abbrechen
                                </button>
                            )}
                        </div>
                    </div>

                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Ausgewählter Effekt</div>

                        {!selectedEffect ? (
                            <div style={{ fontSize: 13, opacity: 0.7 }}>Kein Effekt ausgewählt. (Klick auf Wand/Marker)</div>
                        ) : (
                            <div style={{ display: "grid", gap: 8 }}>
                                <div style={{ fontSize: 13 }}>
                                    <div>
                                        <strong>Typ:</strong> {selectedEffect.kind}
                                    </div>
                                    {selectedEffect.kind === "wall" && (
                                        <div>
                                            <strong>Element:</strong>{" "}
                                            {selectedEffect.element ||
                                                (String(selectedEffect.label || "").includes("Feuer") ? "FIRE" : "ICE")}
                                        </div>
                                    )}
                                    {selectedEffect.kind === "marker" && (
                                        <div>
                                            <strong>Marker:</strong> {selectedEffect.markerType} ({selectedEffect.label})
                                        </div>
                                    )}
                                </div>

                                {isDm ? (
                                    <button onClick={() => handleDeleteEffect(selectedEffect.id)} style={{ background: "#ffe5e5" }}>
                                        Effekt löschen (DM)
                                    </button>
                                ) : (
                                    <div style={{ fontSize: 12, opacity: 0.7 }}>Nur der DM kann Effekte löschen.</div>
                                )}

                                <button onClick={() => setSelectedEffectId(null)}>Auswahl aufheben</button>
                            </div>
                        )}
                    </div>

                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Event Log</div>
                        <div style={{ maxHeight: 320, overflow: "auto", fontSize: 13, display: "grid", gap: 6 }}>
                            {events.length === 0 && <div style={{ opacity: 0.7 }}>Noch keine Events.</div>}
                            {events
                                .slice()
                                .reverse()
                                .map((ev) => (
                                    <div key={ev.id} style={{ borderBottom: "1px solid #eee", paddingBottom: 6 }}>
                                        <div style={{ opacity: 0.7, fontSize: 11 }}>{new Date(ev.at).toLocaleTimeString()}</div>
                                        <div>{formatEventLine(ev)}</div>
                                    </div>
                                ))}
                        </div>
                    </div>

                    <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                        Hinweis: Rechtsklick auf Effekt löscht direkt – aber nur als DM.
                    </div>
                </div>
            </div>
        </div>
    );
}

function ArrowHead({ ax, ay, bx, by, color }) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    const ux = dx / len;
    const uy = dy / len;

    const headWidth = 10;

    const px = bx - ux * 28;
    const py = by - uy * 28;

    const nx = -uy;
    const ny = ux;

    const leftX = px + nx * headWidth;
    const leftY = py + ny * headWidth;
    const rightX = px - nx * headWidth;
    const rightY = py - ny * headWidth;

    return (
        <Line
            points={[leftX, leftY, bx, by, rightX, rightY]}
            closed={true}
            fill={color}
            stroke={color}
            strokeWidth={1}
            opacity={0.95}
            listening={false}
        />
    );
}

function Token({ token, isSelf, onMove, hexSize, mapW, mapH, onClick, selected, targeted }) {
    const avatar = useHtmlImage(token.imgUrl);
    const isEnemy = token.kind === "enemy";
    const ringColor = getTokenRingColor(token);

    // stronger 2.5D perspective
    const depthScale = 0.8 + (token.y / (mapH || 1)) * 0.35;

    return (
        <Group
            x={token.x}
            y={token.y}
            scaleX={depthScale}
            scaleY={depthScale}
            draggable={isSelf}
            onClick={(e) => {
                e.cancelBubble = true;
                onClick?.();
            }}
            onDragMove={(e) => {
                if (!isSelf) return;

                const rawX = e.target.x();
                const rawY = e.target.y();

                const snapped = snapPixelToHex(rawX, rawY, hexSize);
                const clamped = clampToMap(snapped.x, snapped.y, mapW, mapH);

                e.target.x(clamped.x);
                e.target.y(clamped.y);

                onMove(clamped.x, clamped.y);
            }}
        >
            <Circle
                x={0}
                y={16}
                radius={22}
                fill={"rgba(0,0,0,0.45)"}
                scaleX={1.6}
                scaleY={0.55}
                listening={false}
            />

            {avatar ? (
                <KonvaImage
                    image={avatar}
                    x={-28}
                    y={-64}
                    width={56}
                    height={56}
                    cornerRadius={14}
                    shadowColor="black"
                    shadowBlur={14}
                    shadowOpacity={0.7}
                />
            ) : (
                <Circle x={0} y={-40} radius={24} fill={isEnemy ? "rgba(200,0,0,0.6)" : "rgba(0,0,0,0.3)"} />
            )}

            <Circle
                x={0}
                y={16}
                radius={26}
                strokeWidth={isSelf ? 7 : selected ? 6 : 5}
                stroke={targeted ? "gold" : ringColor}
                shadowColor={targeted ? "gold" : ringColor}
                shadowBlur={14}
                shadowOpacity={0.6}
            />

            <Circle x={0} y={16} radius={29} strokeWidth={2} stroke="rgba(0,0,0,0.65)" listening={false} />

            <Text text={token.name} x={-100} y={46} width={200} align="center" fontSize={14} fill="black" />
        </Group>
    );
}