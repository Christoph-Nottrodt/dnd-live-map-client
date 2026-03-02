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

function hexClipPolygonPoints(size) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i - 30);
        pts.push({ x: size * Math.cos(angle), y: size * Math.sin(angle) });
    }
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
 * Stable color fallback
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
    if (ev.type === "lever") return ev.text || ev.title || "Hebel";
    if (ev.type === "plate") return ev.text || ev.title || "Trittplatte";
    if (ev.type === "key") return ev.text || ev.title || "Schlüssel";
    if (ev.type === "object") return ev.text || ev.title || "Objekt";
    return ev.text || ev.title || ev.type || "Event";
}

function markerPresentation(markerType) {
    switch (markerType) {
        case "TREASURE":
            return {
                emoji: "💰",
                fill: "rgba(255,215,0,0.85)",
                stroke: "rgba(120,80,0,0.95)",
                title: "Schatz",
                logType: "loot",
            };
        case "TRAP":
            return {
                emoji: "⚠️",
                fill: "rgba(150,0,200,0.8)",
                stroke: "rgba(40,0,60,0.95)",
                title: "Falle",
                logType: "trap",
            };
        case "LEVER":
            return {
                emoji: "🕹️",
                fill: "rgba(70,170,255,0.85)",
                stroke: "rgba(10,60,120,0.95)",
                title: "Hebel",
                logType: "lever",
            };
        case "PLATE":
            return {
                emoji: "🧱",
                fill: "rgba(180,180,180,0.85)",
                stroke: "rgba(60,60,60,0.95)",
                title: "Trittplatte",
                logType: "plate",
            };
        case "KEY":
            return {
                emoji: "🗝️",
                fill: "rgba(255,200,0,0.75)",
                stroke: "rgba(120,70,0,0.95)",
                title: "Schlüssel",
                logType: "key",
            };
        case "OBJECT":
            return {
                emoji: "📦",
                fill: "rgba(0,0,0,0.20)",
                stroke: "rgba(0,0,0,0.85)",
                title: "Objekt",
                logType: "object",
            };
        default:
            return {
                emoji: "❓",
                fill: "rgba(0,0,0,0.15)",
                stroke: "rgba(0,0,0,0.6)",
                title: "Marker",
                logType: "object",
            };
    }
}

function toIntSafe(v, fallback) {
    const n = Number(String(v ?? "").trim());
    if (!Number.isFinite(n)) return fallback;
    return Math.trunc(n);
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

    // Effects
    const [effects, setEffects] = useState(() => Object.values(session.state.effects || {}));

    // selection (frei – NICHT der fixierte Angriff)
    const [selectedId, setSelectedId] = useState(null);
    const [targetId, setTargetId] = useState(null);

    // Angriff Lock (fixiert)
    const [attackLock, setAttackLock] = useState(false);
    const [attackPick, setAttackPick] = useState({ attackerId: null, targetId: null });

    // Enemy creation UI
    const [enemyName, setEnemyName] = useState("Assassine");
    const [enemyImgUrl, setEnemyImgUrl] = useState("");
    const [enemyHpInput, setEnemyHpInput] = useState("30");
    const [placingEnemy, setPlacingEnemy] = useState(false);

    // effect placement + selection
    const [selectedEffectId, setSelectedEffectId] = useState(null);

    // placement mode:
    // null
    // { mode:"MARKER", markerType, label, visibility }
    // { mode:"WALL", element, visibility, step, from }
    const [placeMode, setPlaceMode] = useState(null);

    // event/effect UI inputs
    const [eventKind, setEventKind] = useState("ATTACK");
    const [noteText, setNoteText] = useState("Eine Notiz…");

    const [treasureLabel, setTreasureLabel] = useState("Truhe");
    const [trapLabel, setTrapLabel] = useState("Falle");
    const [leverLabel, setLeverLabel] = useState("Hebel");
    const [plateLabel, setPlateLabel] = useState("Trittplatte");
    const [keyLabel, setKeyLabel] = useState("Schlüssel");
    const [objectLabel, setObjectLabel] = useState("Beschriftung…");

    // Sichtbarkeit pro Aktion
    const [treasureDmOnly, setTreasureDmOnly] = useState(false);
    const [trapDmOnly, setTrapDmOnly] = useState(false);
    const [leverDmOnly, setLeverDmOnly] = useState(false);
    const [plateDmOnly, setPlateDmOnly] = useState(false);
    const [keyDmOnly, setKeyDmOnly] = useState(false);
    const [objectDmOnly, setObjectDmOnly] = useState(false);
    const [wallFireDmOnly, setWallFireDmOnly] = useState(false);
    const [wallIceDmOnly, setWallIceDmOnly] = useState(false);

    // DM login
    const [dmPasswordInput, setDmPasswordInput] = useState("");

    // stage viewport
    const stageRef = useRef(null);
    const boardContainerRef = useRef(null);

    const [view, setView] = useState({ x: 0, y: 0, scale: 0.5 });
    const [isPanning, setIsPanning] = useState(false);
    const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });

    const bgImg = useHtmlImage(state.map.url);

    const selfId = socket.id;
    const isDm = !!state?.dmId && state.dmId === selfId;

    // FULLSCREEN state
    const [isFullscreen, setIsFullscreen] = useState(false);
    useEffect(() => {
        const onFs = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onFs);
        onFs();
        return () => document.removeEventListener("fullscreenchange", onFs);
    }, []);

    const toggleFullscreen = async () => {
        try {
            const el = boardContainerRef.current || document.documentElement;
            if (!document.fullscreenElement) await el.requestFullscreen?.();
            else await document.exitFullscreen?.();
        } catch (e) {
            alert("Fullscreen nicht möglich: " + (e?.message || String(e)));
        }
    };

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
                return next.slice(-120);
            });
        };

        socket.on("state:patch", onPatch);
        socket.on("event:new", onEvent);

        return () => {
            socket.off("state:patch", onPatch);
            socket.off("event:new", onEvent);
        };
    }, [socket]);

    // Event log (für alle sichtbar; DM-only wird beim Client trotzdem ausgefiltert)
    const visibleEventsForLog = useMemo(() => {
        if (isDm) return events;
        return events.filter((ev) => (ev?.visibility || "ALL") !== "DM");
    }, [events, isDm]);

    const attackEvents = useMemo(() => {
        // für alle sichtbar (du wolltest nachvollziehbar)
        return visibleEventsForLog.filter((e) => e?.type === "attack").slice(-40);
    }, [visibleEventsForLog]);

    // Sort tokens by y
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
        panStart.current = {
            x: e.evt.clientX,
            y: e.evt.clientY,
            vx: view.x,
            vy: view.y,
        };
    };

    const movePan = (e) => {
        if (!isPanning) return;
        const dx = e.evt.clientX - panStart.current.x;
        const dy = e.evt.clientY - panStart.current.y;
        setView((v) => ({
            ...v,
            x: panStart.current.vx + dx,
            y: panStart.current.vy + dy,
        }));
    };

    const endPan = () => setIsPanning(false);

    // Move token (self or DM enemy)
    const moveToken = (id, x, y) => {
        setState((prev) => {
            const next = structuredClone(prev);
            const t = next.tokens[id];
            if (t) {
                t.x = x;
                t.y = y;
            }
            return next;
        });

        if (id === selfId) socket.emit("token:move", { roomId, x, y }, () => { });
        else socket.emit("token:move", { roomId, id, x, y }, () => { });
    };

    // HP update (DM only)
    const setEnemyHp = (tokenId, newHp) => {
        const hp = Math.max(0, toIntSafe(newHp, 0));

        // optimistic
        setState((prev) => {
            const next = structuredClone(prev);
            if (next.tokens?.[tokenId]) {
                next.tokens[tokenId].hp = hp;
            }
            return next;
        });

        // server sync (needs server support)
        socket.emit("token:setHp", { roomId, id: tokenId, hp }, () => { });
    };

    // stage size
    const [stageSize, setStageSize] = useState({ w: 1100, h: 700 });
    useEffect(() => {
        const onResize = () => {
            const w = Math.max(900, Math.min(window.innerWidth - 40, 2000));
            const h = Math.max(600, Math.min(window.innerHeight - 220, 1200));
            setStageSize({ w, h });
        };
        onResize();
        window.addEventListener("resize", onResize);

        const onFsResize = () => onResize();
        document.addEventListener("fullscreenchange", onFsResize);

        return () => {
            window.removeEventListener("resize", onResize);
            document.removeEventListener("fullscreenchange", onFsResize);
        };
    }, []);

    // Für UI (Angriff)
    const uiSelected = selectedId ? state.tokens[selectedId] : null;
    const uiTarget = targetId ? state.tokens[targetId] : null;

    const lockedAttacker = attackPick.attackerId ? state.tokens[attackPick.attackerId] : null;
    const lockedTarget = attackPick.targetId ? state.tokens[attackPick.targetId] : null;

    const canAttack = lockedAttacker && lockedTarget && attackPick.attackerId !== attackPick.targetId;

    const triggerAttack = () => {
        if (!canAttack) return;
        const text = `${lockedAttacker.name} greift ${lockedTarget.name} an!`;

        socket.emit(
            "event:attack",
            {
                roomId,
                attackerId: attackPick.attackerId,
                targetId: attackPick.targetId,
                text,
                visibility: "ALL",
            },
            (res) => {
                if (!res?.ok) alert("Attack event failed: " + (res?.error || "unknown"));
            }
        );
    };

    const triggerNote = () => {
        socket.emit(
            "event:log",
            {
                roomId,
                type: "note",
                title: "Notiz",
                text: String(noteText || "").slice(0, 240),
                visibility: "ALL",
            },
            (res) => {
                if (res && res.ok === false) alert("Note failed: " + (res.error || "unknown"));
            }
        );
    };

    const handleDeleteEffect = (id) => {
        if (!id) return;
        if (!isDm) return;

        socket.emit("effect:remove", { roomId, id }, (res) => {
            if (res && res.ok === false) alert("Löschen fehlgeschlagen: " + (res.error || "unknown"));
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

    const onStageMouseDown = (e) => {
        startPan(e);

        const isMiddle = e.evt.button === 1;
        const isShiftLeft = e.evt.button === 0 && e.evt.shiftKey;
        if (isMiddle || isShiftLeft) return;

        if (e.evt.button !== 0) return;

        if (!placingEnemy && !placeMode) setSelectedEffectId(null);

        const p = getWorldFromEvent();
        if (!p) return;
        const pos = snapClampWorld(p.worldX, p.worldY);

        if (!isDm && (placingEnemy || placeMode)) {
            setPlacingEnemy(false);
            setPlaceMode(null);
            alert("Nur der DM darf Gegner/Effekte platzieren.");
            return;
        }

        if (placingEnemy) {
            const hp = Math.max(0, toIntSafe(enemyHpInput, 0));
            socket.emit(
                "token:addEnemy",
                { roomId, name: enemyName, imgUrl: enemyImgUrl, x: pos.x, y: pos.y, hp },
                (res) => {
                    if (!res?.ok) alert("Add enemy failed: " + (res?.error || "unknown"));
                }
            );
            setPlacingEnemy(false);
            return;
        }

        if (placeMode) {
            if (placeMode.mode === "MARKER") {
                const markerType = placeMode.markerType;
                const label = placeMode.label;
                const vis = placeMode.visibility === "DM" ? "DM" : "ALL";

                socket.emit(
                    "effect:add",
                    {
                        roomId,
                        effect: { kind: "marker", markerType, label, visibility: vis, x: pos.x, y: pos.y },
                    },
                    (res) => {
                        if (res && res.ok === false) alert("Effect add failed: " + (res.error || "unknown"));
                    }
                );

                const pres = markerPresentation(markerType);
                socket.emit(
                    "event:log",
                    { roomId, type: pres.logType, title: "Marker", text: `${pres.title} platziert: ${label}`, visibility: vis },
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

                const element = placeMode.element;
                const style = wallStyle(element);
                const vis = placeMode.visibility === "DM" ? "DM" : "ALL";

                socket.emit(
                    "effect:add",
                    {
                        roomId,
                        effect: {
                            kind: "wall",
                            element,
                            visibility: vis,
                            label: style.label,
                            color: style.stroke,
                            glow: style.glow,
                            x1: from.x,
                            y1: from.y,
                            x2: pos.x,
                            y2: pos.y,
                            thickness: Math.max(6, Math.round(hexSize * 0.22)),
                        },
                    },
                    (res) => {
                        if (res && res.ok === false) alert("Effect add failed: " + (res.error || "unknown"));
                    }
                );

                socket.emit(
                    "event:log",
                    { roomId, type: "effect", title: "Effekt", text: `${element === "FIRE" ? "Feuerwand" : "Eiswand"} gesetzt`, visibility: vis },
                    () => { }
                );

                setPlaceMode(null);
                return;
            }
        }
    };

    // Pfeil: IMMER aus attackPick (fixiert)
    const persistentLine = useMemo(() => {
        if (!attackPick.attackerId || !attackPick.targetId) return null;
        const a = state.tokens[attackPick.attackerId];
        const b = state.tokens[attackPick.targetId];
        if (!a || !b) return null;

        const color = getTokenRingColor(a);
        return { ax: a.x, ay: a.y, bx: b.x, by: b.y, color };
    }, [state.tokens, attackPick.attackerId, attackPick.targetId]);

    const wallsAll = useMemo(() => effects.filter((e) => e.kind === "wall"), [effects]);
    const markersAll = useMemo(() => effects.filter((e) => e.kind === "marker"), [effects]);

    const walls = useMemo(() => {
        if (isDm) return wallsAll;
        return wallsAll.filter((w) => (w?.visibility || "ALL") !== "DM");
    }, [wallsAll, isDm]);

    const markers = useMemo(() => {
        if (isDm) return markersAll;
        return markersAll.filter((m) => (m?.visibility || "ALL") !== "DM");
    }, [markersAll, isDm]);

    // Token click behaviour:
    // - Wenn Angriff Lock aktiv: Klicks wählen Angreifer/Ziel in attackPick und ändern NICHT den Pfeil später
    // - Wenn Lock aus: normal (selectedId/targetId) zum „rumklicken“
    const onTokenClick = (t) => {
        if (attackLock) {
            setAttackPick((cur) => {
                // 1) wenn kein Angreifer -> set
                if (!cur.attackerId) return { attackerId: t.id, targetId: null };
                // 2) wenn Angreifer gesetzt aber kein Ziel -> set Ziel (wenn anders)
                if (!cur.targetId) return { attackerId: cur.attackerId, targetId: t.id === cur.attackerId ? null : t.id };
                // 3) wenn beides gesetzt -> NICHT automatisch umschalten (fix!)
                return cur;
            });
            return;
        }

        // frei klicken
        if (!selectedId || selectedId === t.id) {
            setSelectedId(t.id);
            setTargetId(null);
        } else {
            setTargetId(t.id);
        }
    };

    return (
        <div ref={boardContainerRef}>
            <div style={{ display: "flex", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
                {/* Left */}
                <div style={{ flex: 1, minWidth: 720 }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                        <div>
                            <strong>Raum:</strong> <span style={{ fontFamily: "monospace" }}>{roomId}</span>
                            <span style={{ marginLeft: 10, fontSize: 12, opacity: 0.75 }}>{isDm ? "DM" : "Spieler"}</span>
                        </div>

                        <button onClick={onLeave}>Verlassen</button>
                        <button onClick={toggleFullscreen}>{isFullscreen ? "Fullscreen verlassen" : "Fullscreen"}</button>

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
                            <button onClick={setMap} disabled={!isDm}>
                                Karte setzen
                            </button>
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
                                {bgImg && <KonvaImage image={bgImg} x={0} y={0} width={state.map.width} height={state.map.height} />}

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
                                    const thick = w.thickness ?? Math.max(6, Math.round(hexSize * 0.22));

                                    const isSel = w.id === selectedEffectId;
                                    const vis = w?.visibility || "ALL";
                                    const dmOnlyOverlay = isDm && vis === "DM";

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

                                            {dmOnlyOverlay && (
                                                <Line
                                                    points={[w.x1, w.y1, w.x2, w.y2]}
                                                    stroke={"rgba(0,0,0,0.35)"}
                                                    strokeWidth={Math.max(1, Math.round(thick * 0.25))}
                                                    dash={[8, 8]}
                                                    lineCap="round"
                                                    lineJoin="round"
                                                    opacity={0.8}
                                                    listening={false}
                                                />
                                            )}

                                            <Text
                                                text={(vis === "DM" ? "🔒 " : "") + (w.label || style.label)}
                                                x={(w.x1 + w.x2) / 2 - 70}
                                                y={(w.y1 + w.y2) / 2 - 28}
                                                fontSize={14}
                                                fill={"rgba(0,0,0,0.85)"}
                                                listening={false}
                                            />
                                        </Group>
                                    );
                                })}

                                {/* EFFECTS: markers (2.5D wieder drin) */}
                                {markers.map((m) => {
                                    const markerType = String(m.markerType || "OBJECT").toUpperCase();
                                    const isSel = m.id === selectedEffectId;
                                    const vis = m?.visibility || "ALL";
                                    const pres = markerPresentation(markerType);

                                    const outerR = Math.max(12, Math.round(hexSize * 0.42));
                                    const innerR = Math.max(10, Math.round(hexSize * 0.30));
                                    const iconSize = Math.max(14, Math.round(hexSize * 0.38));
                                    const labelSize = Math.max(10, Math.round(hexSize * 0.22));
                                    const dmOnlyOverlay = isDm && vis === "DM";

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
                                            {/* Bodenschatten (2.5D) */}
                                            <Circle
                                                x={0}
                                                y={outerR * 0.32}
                                                radius={outerR * 0.92}
                                                fill={"rgba(0,0,0,0.22)"}
                                                blurRadius={8}
                                                listening={false}
                                            />

                                            {isSel && (
                                                <Circle
                                                    x={0}
                                                    y={0}
                                                    radius={outerR + Math.max(6, Math.round(hexSize * 0.12))}
                                                    stroke={"rgba(255,255,255,0.95)"}
                                                    strokeWidth={Math.max(4, Math.round(hexSize * 0.12))}
                                                    shadowColor={"rgba(0,0,0,0.35)"}
                                                    shadowBlur={10}
                                                    shadowOpacity={0.6}
                                                    listening={false}
                                                />
                                            )}

                                            {/* Base */}
                                            <Circle
                                                x={0}
                                                y={0}
                                                radius={outerR}
                                                fill={pres.fill}
                                                stroke={pres.stroke}
                                                strokeWidth={Math.max(2, Math.round(hexSize * 0.07))}
                                                shadowColor={"rgba(0,0,0,0.35)"}
                                                shadowBlur={10}
                                                shadowOpacity={0.5}
                                                shadowOffsetX={0}
                                                shadowOffsetY={3}
                                            />

                                            {/* Highlight (2.5D) */}
                                            <Circle
                                                x={-outerR * 0.28}
                                                y={-outerR * 0.28}
                                                radius={outerR * 0.42}
                                                fill={"rgba(255,255,255,0.25)"}
                                                listening={false}
                                            />

                                            {dmOnlyOverlay && (
                                                <Circle
                                                    x={0}
                                                    y={0}
                                                    radius={outerR + 2}
                                                    stroke={"rgba(0,0,0,0.35)"}
                                                    strokeWidth={2}
                                                    dash={[6, 6]}
                                                    listening={false}
                                                />
                                            )}

                                            <Text
                                                text={pres.emoji}
                                                x={-iconSize / 2}
                                                y={-iconSize / 2 - 1}
                                                fontSize={iconSize}
                                                fill={"black"}
                                                listening={false}
                                            />

                                            <Circle
                                                x={0}
                                                y={0}
                                                radius={innerR}
                                                stroke={"rgba(0,0,0,0.18)"}
                                                strokeWidth={1}
                                                listening={false}
                                            />

                                            <Text
                                                text={(vis === "DM" ? "🔒 " : "") + (m.label || pres.title)}
                                                x={-140}
                                                y={outerR + 6}
                                                width={280}
                                                align="center"
                                                fontSize={labelSize}
                                                fill={"rgba(0,0,0,0.85)"}
                                                listening={false}
                                            />
                                        </Group>
                                    );
                                })}

                                {/* Persistent Attack Line (fixiert) */}
                                {persistentLine && (
                                    <Group listening={false}>
                                        <Line
                                            points={[persistentLine.ax, persistentLine.ay, persistentLine.bx, persistentLine.by]}
                                            stroke={persistentLine.color || "red"}
                                            strokeWidth={Math.max(4, Math.round(hexSize * 0.12))}
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
                                            hexSize={hexSize}
                                        />
                                    </Group>
                                )}

                                {/* Tokens */}
                                {tokensArr.map((t) => (
                                    <Token
                                        key={t.id}
                                        token={t}
                                        isSelf={t.id === selfId}
                                        isDm={isDm}
                                        selected={
                                            attackLock ? t.id === attackPick.attackerId : t.id === selectedId
                                        }
                                        targeted={
                                            attackLock ? t.id === attackPick.targetId : t.id === targetId
                                        }
                                        hexSize={hexSize}
                                        mapW={state.map.width}
                                        mapH={state.map.height}
                                        onMove={(id, nx, ny) => moveToken(id, nx, ny)}
                                        onClick={() => onTokenClick(t)}
                                        onHpChange={(id, hp) => setEnemyHp(id, hp)}
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
                                                        ? `Klicke: ${markerPresentation(placeMode.markerType).title} platzieren…`
                                                        : placeMode?.mode === "WALL" && placeMode.step === 1
                                                            ? `Klicke Startpunkt: ${placeMode.element === "FIRE" ? "Feuerwand" : "Eiswand"}…`
                                                            : `Klicke Endpunkt: ${placeMode?.element === "FIRE" ? "Feuerwand" : "Eiswand"}…`
                                            }
                                            x={20}
                                            y={20}
                                            fontSize={18}
                                            fill={"black"}
                                        />
                                        {placeMode?.visibility === "DM" && (
                                            <Text text={"🔒 nur DM sichtbar"} x={20} y={46} fontSize={14} fill={"rgba(0,0,0,0.7)"} />
                                        )}
                                    </Group>
                                )}
                            </Layer>
                        </Stage>
                    </div>

                    <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
                        Steuerung: Token ziehen = bewegen (dein Token; DM kann Gegner ziehen). Zoom: Mausrad. Pan: Shift+Linksklick ziehen
                        oder Mausrad-Klick ziehen.
                        <br />
                        Angriff: Mit <b>„Angriff auswählen (Lock)”</b> fixierst du Angreifer/Ziel, damit der Pfeil nicht rutscht.
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

                    {/* ATTACK LOCK */}
                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Angriff (fixiert)</div>

                        <div style={{ display: "grid", gap: 8 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                                <input
                                    type="checkbox"
                                    checked={attackLock}
                                    onChange={(e) => {
                                        const v = e.target.checked;
                                        setAttackLock(v);
                                        if (!v) {
                                            // beim Lock aus: Pfeil weg (damit es nicht verwirrt)
                                            setAttackPick({ attackerId: null, targetId: null });
                                        }
                                    }}
                                />
                                Angriff auswählen (Lock)
                            </label>

                            <div style={{ fontSize: 13 }}>
                                <div>
                                    Angreifer: <strong>{lockedAttacker ? lockedAttacker.name : "—"}</strong>
                                </div>
                                <div>
                                    Ziel: <strong>{lockedTarget ? lockedTarget.name : "—"}</strong>
                                </div>
                            </div>

                            <div>
                                <button onClick={triggerAttack} disabled={!canAttack}>
                                    Angriff ins Log
                                </button>
                                <button
                                    style={{ marginLeft: 8 }}
                                    onClick={() => setAttackPick({ attackerId: null, targetId: null })}
                                >
                                    Neuen Angriff wählen
                                </button>
                            </div>

                            <div style={{ fontSize: 12, opacity: 0.75 }}>
                                Wenn Lock aktiv: Klicke <b>Angreifer</b> → <b>Ziel</b>. Danach bleibt der Pfeil fix.
                            </div>
                        </div>
                    </div>

                    {/* ENEMY */}
                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Gegner hinzufügen</div>

                        <div style={{ display: "grid", gap: 8 }}>
                            <div>
                                <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>Name</label>
                                <input value={enemyName} onChange={(e) => setEnemyName(e.target.value)} style={{ width: "100%" }} />
                            </div>

                            <div style={{ display: "flex", gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>HP</label>
                                    <input
                                        value={enemyHpInput}
                                        onChange={(e) => setEnemyHpInput(e.target.value)}
                                        style={{ width: "100%" }}
                                        inputMode="numeric"
                                    />
                                </div>
                                <div style={{ width: 1 }} />
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

                            <div style={{ fontSize: 12, opacity: 0.75 }}>
                                Hinweis: HP +/- am Token funktionieren vollständig, sobald der Server <code>token:setHp</code> unterstützt.
                            </div>
                        </div>
                    </div>

                    {/* EVENTS / EFFECTS */}
                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Events & Effekte</div>

                        <div style={{ display: "grid", gap: 8 }}>
                            <div>
                                <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>Aktion</label>
                                <select value={eventKind} onChange={(e) => setEventKind(e.target.value)} style={{ width: "100%" }}>
                                    <option value="ATTACK">Angriff (Auswahl via Lock-Box oben)</option>
                                    <option value="TREASURE">Eventmarker: Schatz</option>
                                    <option value="TRAP">Eventmarker: Falle</option>
                                    <option value="LEVER">Eventmarker: Hebel</option>
                                    <option value="PLATE">Eventmarker: Trittplatte</option>
                                    <option value="KEY">Eventmarker: Schlüssel</option>
                                    <option value="OBJECT">Eventmarker: Objekt (Beschriftung)</option>
                                    <option value="NOTE">Notiz (Log)</option>
                                    <option value="WALL_FIRE">Feuerwand setzen</option>
                                    <option value="WALL_ICE">Eiswand setzen</option>
                                </select>
                            </div>

                            {eventKind === "NOTE" && (
                                <>
                                    <div>
                                        <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>Text</label>
                                        <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} style={{ width: "100%" }} />
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
                                    <LabelInput label="Label" value={treasureLabel} setValue={setTreasureLabel} disabled={!isDm} />
                                    <DmOnlyToggle value={treasureDmOnly} setValue={setTreasureDmOnly} />
                                    <button
                                        onClick={() => {
                                            if (!isDm) return alert("Nur der DM darf Marker platzieren.");
                                            setPlacingEnemy(false);
                                            setPlaceMode({
                                                mode: "MARKER",
                                                markerType: "TREASURE",
                                                label: treasureLabel || "Schatz",
                                                visibility: treasureDmOnly ? "DM" : "ALL",
                                            });
                                        }}
                                        disabled={!isDm}
                                    >
                                        Schatz platzieren (Klick auf Karte)
                                    </button>
                                </>
                            )}

                            {eventKind === "TRAP" && (
                                <>
                                    <LabelInput label="Label" value={trapLabel} setValue={setTrapLabel} disabled={!isDm} />
                                    <DmOnlyToggle value={trapDmOnly} setValue={setTrapDmOnly} />
                                    <button
                                        onClick={() => {
                                            if (!isDm) return alert("Nur der DM darf Marker platzieren.");
                                            setPlacingEnemy(false);
                                            setPlaceMode({
                                                mode: "MARKER",
                                                markerType: "TRAP",
                                                label: trapLabel || "Falle",
                                                visibility: trapDmOnly ? "DM" : "ALL",
                                            });
                                        }}
                                        disabled={!isDm}
                                    >
                                        Falle platzieren (Klick auf Karte)
                                    </button>
                                </>
                            )}

                            {eventKind === "LEVER" && (
                                <>
                                    <LabelInput label="Label" value={leverLabel} setValue={setLeverLabel} disabled={!isDm} />
                                    <DmOnlyToggle value={leverDmOnly} setValue={setLeverDmOnly} />
                                    <button
                                        onClick={() => {
                                            if (!isDm) return alert("Nur der DM darf Marker platzieren.");
                                            setPlacingEnemy(false);
                                            setPlaceMode({
                                                mode: "MARKER",
                                                markerType: "LEVER",
                                                label: leverLabel || "Hebel",
                                                visibility: leverDmOnly ? "DM" : "ALL",
                                            });
                                        }}
                                        disabled={!isDm}
                                    >
                                        Hebel platzieren (Klick auf Karte)
                                    </button>
                                </>
                            )}

                            {eventKind === "PLATE" && (
                                <>
                                    <LabelInput label="Label" value={plateLabel} setValue={setPlateLabel} disabled={!isDm} />
                                    <DmOnlyToggle value={plateDmOnly} setValue={setPlateDmOnly} />
                                    <button
                                        onClick={() => {
                                            if (!isDm) return alert("Nur der DM darf Marker platzieren.");
                                            setPlacingEnemy(false);
                                            setPlaceMode({
                                                mode: "MARKER",
                                                markerType: "PLATE",
                                                label: plateLabel || "Trittplatte",
                                                visibility: plateDmOnly ? "DM" : "ALL",
                                            });
                                        }}
                                        disabled={!isDm}
                                    >
                                        Trittplatte platzieren (Klick auf Karte)
                                    </button>
                                </>
                            )}

                            {eventKind === "KEY" && (
                                <>
                                    <LabelInput label="Label" value={keyLabel} setValue={setKeyLabel} disabled={!isDm} />
                                    <DmOnlyToggle value={keyDmOnly} setValue={setKeyDmOnly} />
                                    <button
                                        onClick={() => {
                                            if (!isDm) return alert("Nur der DM darf Marker platzieren.");
                                            setPlacingEnemy(false);
                                            setPlaceMode({
                                                mode: "MARKER",
                                                markerType: "KEY",
                                                label: keyLabel || "Schlüssel",
                                                visibility: keyDmOnly ? "DM" : "ALL",
                                            });
                                        }}
                                        disabled={!isDm}
                                    >
                                        Schlüssel platzieren (Klick auf Karte)
                                    </button>
                                </>
                            )}

                            {eventKind === "OBJECT" && (
                                <>
                                    <LabelInput label="Beschriftung" value={objectLabel} setValue={setObjectLabel} disabled={!isDm} />
                                    <DmOnlyToggle value={objectDmOnly} setValue={setObjectDmOnly} />
                                    <button
                                        onClick={() => {
                                            if (!isDm) return alert("Nur der DM darf Marker platzieren.");
                                            setPlacingEnemy(false);
                                            setPlaceMode({
                                                mode: "MARKER",
                                                markerType: "OBJECT",
                                                label: objectLabel || "Objekt",
                                                visibility: objectDmOnly ? "DM" : "ALL",
                                            });
                                        }}
                                        disabled={!isDm}
                                    >
                                        Objekt platzieren (Klick auf Karte)
                                    </button>
                                </>
                            )}

                            {eventKind === "WALL_FIRE" && (
                                <>
                                    <div style={{ fontSize: 12, opacity: 0.8 }}>2 Klicks: Startpunkt → Endpunkt</div>
                                    <DmOnlyToggle value={wallFireDmOnly} setValue={setWallFireDmOnly} />
                                    <button
                                        onClick={() => {
                                            if (!isDm) return alert("Nur der DM darf Wände setzen.");
                                            setPlacingEnemy(false);
                                            setPlaceMode({
                                                mode: "WALL",
                                                element: "FIRE",
                                                visibility: wallFireDmOnly ? "DM" : "ALL",
                                                step: 1,
                                                from: null,
                                            });
                                        }}
                                        disabled={!isDm}
                                    >
                                        Feuerwand setzen (2 Klicks)
                                    </button>
                                </>
                            )}

                            {eventKind === "WALL_ICE" && (
                                <>
                                    <div style={{ fontSize: 12, opacity: 0.8 }}>2 Klicks: Startpunkt → Endpunkt</div>
                                    <DmOnlyToggle value={wallIceDmOnly} setValue={setWallIceDmOnly} />
                                    <button
                                        onClick={() => {
                                            if (!isDm) return alert("Nur der DM darf Wände setzen.");
                                            setPlacingEnemy(false);
                                            setPlaceMode({
                                                mode: "WALL",
                                                element: "ICE",
                                                visibility: wallIceDmOnly ? "DM" : "ALL",
                                                step: 1,
                                                from: null,
                                            });
                                        }}
                                        disabled={!isDm}
                                    >
                                        Eiswand setzen (2 Klicks)
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

                    {/* ANGRIFFS-LOG */}
                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Angriffs-Log (für alle)</div>
                        <div style={{ maxHeight: 180, overflow: "auto", fontSize: 13, display: "grid", gap: 6 }}>
                            {attackEvents.length === 0 && <div style={{ opacity: 0.7 }}>Noch keine Angriffe.</div>}
                            {attackEvents
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

                    {/* SELECTED EFFECT */}
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
                                            {selectedEffect.element || (String(selectedEffect.label || "").includes("Feuer") ? "FIRE" : "ICE")}
                                        </div>
                                    )}
                                    {selectedEffect.kind === "marker" && (
                                        <div>
                                            <strong>Marker:</strong> {selectedEffect.markerType} ({selectedEffect.label})
                                        </div>
                                    )}
                                    <div>
                                        <strong>Sichtbar:</strong> {(selectedEffect.visibility || "ALL") === "DM" ? "🔒 nur DM" : "für alle"}
                                    </div>
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

                    {/* EVENT LOG */}
                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Event Log</div>
                        <div style={{ maxHeight: 320, overflow: "auto", fontSize: 13, display: "grid", gap: 6 }}>
                            {visibleEventsForLog.length === 0 && <div style={{ opacity: 0.7 }}>Noch keine Events.</div>}
                            {visibleEventsForLog
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

function LabelInput({ label, value, setValue, disabled }) {
    return (
        <div>
            <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>{label}</label>
            <input value={value} onChange={(e) => setValue(e.target.value)} style={{ width: "100%" }} disabled={disabled} />
        </div>
    );
}

function DmOnlyToggle({ value, setValue }) {
    return (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={!!value} onChange={(e) => setValue(e.target.checked)} />
            🔒 nur DM sichtbar
        </label>
    );
}

function ArrowHead({ ax, ay, bx, by, color, hexSize }) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    const ux = dx / len;
    const uy = dy / len;

    const headWidth = Math.max(8, Math.round(hexSize * 0.18));
    const back = Math.max(18, Math.round(hexSize * 0.62));

    const px = bx - ux * back;
    const py = by - uy * back;

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

function Token({ token, isSelf, isDm, onMove, onHpChange, hexSize, mapW, mapH, onClick, selected, targeted }) {
    const avatar = useHtmlImage(token.imgUrl);
    const isEnemy = token.kind === "enemy";
    const ringColor = getTokenRingColor(token);

    // Token fills hex
    const tokenHexSize = Math.max(14, hexSize * 0.98);
    const hexPts = useMemo(() => hexClipPolygonPoints(tokenHexSize), [tokenHexSize]);

    const hexW = Math.sqrt(3) * tokenHexSize;
    const hexH = 2 * tokenHexSize;

    // DM can drag enemies
    const canDrag = isSelf || (isDm && isEnemy);

    // IMPORTANT: Provide a real hit area
    const hitHexPoints = useMemo(() => hexCornerPoints(0, 0, tokenHexSize), [tokenHexSize]);

    const hp = typeof token.hp === "number" ? token.hp : (isEnemy ? 0 : null);

    const bumpHp = (delta) => {
        if (!isDm || !isEnemy) return;
        const next = Math.max(0, (typeof hp === "number" ? hp : 0) + delta);
        onHpChange?.(token.id, next);
    };

    return (
        <Group
            x={token.x}
            y={token.y}
            draggable={canDrag}
            onMouseDown={(e) => {
                e.cancelBubble = true;
            }}
            onDragStart={(e) => {
                e.cancelBubble = true;
            }}
            onDragEnd={(e) => {
                e.cancelBubble = true;
            }}
            onClick={(e) => {
                e.cancelBubble = true;
                onClick?.();
            }}
            clipFunc={(ctx) => {
                ctx.beginPath();
                ctx.moveTo(hexPts[0].x, hexPts[0].y);
                for (let i = 1; i < hexPts.length; i++) ctx.lineTo(hexPts[i].x, hexPts[i].y);
                ctx.closePath();
            }}
            onDragMove={(e) => {
                if (!canDrag) return;

                const rawX = e.target.x();
                const rawY = e.target.y();

                const snapped = snapPixelToHex(rawX, rawY, hexSize);
                const clamped = clampToMap(snapped.x, snapped.y, mapW, mapH);

                e.target.x(clamped.x);
                e.target.y(clamped.y);

                onMove?.(token.id, clamped.x, clamped.y);
            }}
        >
            {/* Hit area (transparent) */}
            <Line points={hitHexPoints} closed={true} fill={"rgba(0,0,0,0.001)"} strokeWidth={0} listening={true} />

            {/* Background */}
            <Rect
                x={-hexW / 2}
                y={-hexH / 2}
                width={hexW}
                height={hexH}
                fill={isEnemy ? "rgba(200,0,0,0.18)" : "rgba(0,0,0,0.12)"}
                listening={false}
            />

            {/* Avatar / fallback */}
            {avatar ? (
                <KonvaImage image={avatar} x={-hexW / 2} y={-hexH / 2} width={hexW} height={hexH} listening={false} />
            ) : (
                <Rect
                    x={-hexW / 2}
                    y={-hexH / 2}
                    width={hexW}
                    height={hexH}
                    fill={isEnemy ? "rgba(200,0,0,0.35)" : "rgba(0,0,0,0.18)"}
                    listening={false}
                />
            )}

            {/* Outline */}
            <Line
                points={hitHexPoints}
                closed={true}
                strokeWidth={Math.max(3, Math.round(hexSize * 0.10))}
                stroke={targeted ? "gold" : ringColor}
                opacity={0.98}
                shadowColor={targeted ? "gold" : ringColor}
                shadowBlur={Math.max(6, Math.round(hexSize * 0.18))}
                shadowOpacity={0.55}
                listening={false}
            />

            {(selected || isSelf) && (
                <Line
                    points={hexCornerPoints(0, 0, tokenHexSize * 0.9)}
                    closed={true}
                    strokeWidth={Math.max(2, Math.round(hexSize * 0.07))}
                    stroke={"rgba(255,255,255,0.9)"}
                    opacity={0.95}
                    listening={false}
                />
            )}

            {/* HP badge (für enemies) */}
            {isEnemy && (
                <Group x={0} y={-tokenHexSize * 0.78}>
                    <Rect
                        x={-30}
                        y={-12}
                        width={60}
                        height={22}
                        cornerRadius={10}
                        fill={"rgba(0,0,0,0.55)"}
                        shadowColor={"rgba(0,0,0,0.4)"}
                        shadowBlur={8}
                        shadowOpacity={0.5}
                        shadowOffsetY={2}
                        listening={false}
                    />
                    <Text
                        text={`HP ${typeof hp === "number" ? hp : 0}`}
                        x={-28}
                        y={-10}
                        width={56}
                        align="center"
                        fontSize={12}
                        fill={"white"}
                        listening={false}
                    />

                    {/* +/- nur DM */}
                    {isDm && (
                        <Group>
                            <Rect
                                x={-52}
                                y={-12}
                                width={18}
                                height={22}
                                cornerRadius={8}
                                fill={"rgba(255,255,255,0.75)"}
                                onMouseDown={(e) => {
                                    e.cancelBubble = true;
                                }}
                                onClick={(e) => {
                                    e.cancelBubble = true;
                                    bumpHp(-1);
                                }}
                            />
                            <Text text={"-"} x={-52} y={-11} width={18} align="center" fontSize={16} fill={"black"} listening={false} />

                            <Rect
                                x={34}
                                y={-12}
                                width={18}
                                height={22}
                                cornerRadius={8}
                                fill={"rgba(255,255,255,0.75)"}
                                onMouseDown={(e) => {
                                    e.cancelBubble = true;
                                }}
                                onClick={(e) => {
                                    e.cancelBubble = true;
                                    bumpHp(+1);
                                }}
                            />
                            <Text text={"+"} x={34} y={-11} width={18} align="center" fontSize={16} fill={"black"} listening={false} />
                        </Group>
                    )}
                </Group>
            )}

            <Text
                text={token.name}
                x={-140}
                y={tokenHexSize + 6}
                width={280}
                align="center"
                fontSize={Math.max(11, Math.round(hexSize * 0.24))}
                fill="black"
                listening={false}
            />

            {isDm && isEnemy && (
                <Text
                    text={"👑"}
                    x={-10}
                    y={-tokenHexSize + 6}
                    fontSize={Math.max(12, Math.round(hexSize * 0.26))}
                    fill={"rgba(0,0,0,0.8)"}
                    listening={false}
                />
            )}
        </Group>
    );
}