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
    if (typeof token?.color === "string" && token.color.trim())
        return token.color.trim();
    const idx = hashToIndex(
        String(token?.id || ""),
        PLAYER_COLOR_PALETTE.length
    );
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

function markerPresentation(markerType) {
    switch (markerType) {
        case "TREASURE":
            return {
                emoji: "💰",
                fill: "rgba(255,215,0,0.85)",
                stroke: "rgba(120,80,0,0.95)",
                title: "Schatz",
            };
        case "TRAP":
            return {
                emoji: "⚠️",
                fill: "rgba(150,0,200,0.8)",
                stroke: "rgba(40,0,60,0.95)",
                title: "Falle",
            };
        case "LEVER":
            return {
                emoji: "🕹️",
                fill: "rgba(70,170,255,0.85)",
                stroke: "rgba(10,60,120,0.95)",
                title: "Hebel",
            };
        case "PLATE":
            return {
                emoji: "🧱",
                fill: "rgba(180,180,180,0.85)",
                stroke: "rgba(60,60,60,0.95)",
                title: "Trittplatte",
            };
        case "KEY":
            return {
                emoji: "🗝️",
                fill: "rgba(255,200,0,0.75)",
                stroke: "rgba(120,70,0,0.95)",
                title: "Schlüssel",
            };
        case "OBJECT":
            return {
                emoji: "📦",
                fill: "rgba(0,0,0,0.20)",
                stroke: "rgba(0,0,0,0.85)",
                title: "Objekt",
            };
        default:
            return {
                emoji: "❓",
                fill: "rgba(0,0,0,0.15)",
                stroke: "rgba(0,0,0,0.6)",
                title: "Marker",
            };
    }
}

function toIntSafe(v, fallback) {
    const n = Number(String(v ?? "").trim());
    if (!Number.isFinite(n)) return fallback;
    return Math.trunc(n);
}

/**
 * state.attacks kann 2 Formen haben:
 *  A) alt/vereinfach: { [attackerId]: targetId }
 *  B) server (neu):  { [attackerId]: { attackerId, targetId, at } }
 * Wir normalisieren beim Lesen.
 */
function getTargetIdFromAttackValue(v) {
    if (!v) return null;
    if (typeof v === "string") return v;
    if (typeof v === "object" && v.targetId) return String(v.targetId);
    return null;
}

export default function Board({ socket, session, onLeave }) {
    const { roomId } = session;

    const initialMap =
        session?.state?.map || {
            url: "https://upload.wikimedia.org/wikipedia/commons/5/5a/Parchment.00.jpg",
            width: 2000,
            height: 1400,
        };

    const [state, setState] = useState(() => {
        const s = session?.state || {};
        return {
            map: s.map || initialMap,
            tokens: s.tokens || {},
            effects: s.effects || {},
            dmId: s.dmId || null,
            attacks: s.attacks || {},
        };
    });

    const [mapUrl, setMapUrl] = useState(initialMap.url);
    const [mapW, setMapW] = useState(initialMap.width);
    const [mapH, setMapH] = useState(initialMap.height);

    // Hex grid settings
    const [showGrid, setShowGrid] = useState(true);
    const [hexSize, setHexSize] = useState(45);

    // Effects (UI list)
    const [effects, setEffects] = useState(() =>
        Object.values(session?.state?.effects || {})
    );

    // selection (frei – NICHT der fixierte Angriff)
    const [selectedId, setSelectedId] = useState(null);
    const [targetId, setTargetId] = useState(null);

    // keep latest selection for patch-cleanup without re-registering socket listener
    const selectedIdRef = useRef(null);
    const targetIdRef = useRef(null);
    useEffect(() => {
        selectedIdRef.current = selectedId;
    }, [selectedId]);
    useEffect(() => {
        targetIdRef.current = targetId;
    }, [targetId]);

    // Angriff Lock (Auswahl)
    const [attackLock, setAttackLock] = useState(false);
    const [attackPick, setAttackPick] = useState({
        attackerId: null,
        targetId: null,
    });

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

    // event/effect UI inputs (Marker/Walls)
    const [eventKind, setEventKind] = useState("ATTACK");

    const [treasureLabel, setTreasureLabel] = useState("Truhe");
    const [trapLabel, setTrapLabel] = useState("Falle");
    const [leverLabel, setLeverLabel] = useState("Hebel");
    const [plateLabel, setPlateLabel] = useState("Trittplatte");
    const [keyLabel, setKeyLabel] = useState("Schlüssel");
    const [objectLabel, setObjectLabel] = useState("Beschriftung…");

    // Sichtbarkeit pro Aktion (Effekte/Marker)
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

    const selfId = socket?.id;
    const isDm = !!state?.dmId && !!selfId && state.dmId === selfId;

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

    // Socket patches (register once)
    useEffect(() => {
        if (!socket) return;

        const onPatch = (patch) => {
            setState((prev) => {
                const next = structuredClone(prev);

                if (patch.type === "map:set") next.map = patch.map;

                else if (patch.type === "token:upsert") {
                    next.tokens = next.tokens || {};
                    next.tokens[patch.token.id] = patch.token;
                } else if (patch.type === "token:move") {
                    const t = next.tokens?.[patch.id];
                    if (t) {
                        t.x = patch.x;
                        t.y = patch.y;
                    }
                } else if (patch.type === "token:remove") {
                    const removedId = patch.id;
                    if (next.tokens?.[removedId]) delete next.tokens[removedId];

                    // UI cleanup (use refs -> no dependency rebind)
                    if (selectedIdRef.current === removedId) setSelectedId(null);
                    if (targetIdRef.current === removedId) setTargetId(null);
                    setAttackPick((cur) => {
                        if (cur.attackerId === removedId || cur.targetId === removedId) {
                            return { attackerId: null, targetId: null };
                        }
                        return cur;
                    });

                    // attacks cleanup (client-side robust)
                    next.attacks = next.attacks || {};
                    if (next.attacks[removedId]) delete next.attacks[removedId];

                    // remove any attacks pointing to removedId
                    for (const [aId, aVal] of Object.entries(next.attacks)) {
                        const tgt = getTargetIdFromAttackValue(aVal);
                        if (tgt === removedId) delete next.attacks[aId];
                    }
                } else if (patch.type === "room:dm") {
                    next.dmId = patch.dmId;
                }

                // persistent attacks
                else if (patch.type === "attack:set") {
                    next.attacks = next.attacks || {};
                    if (patch.attack?.attackerId && patch.attack?.targetId) {
                        // store as object-compatible (keep server shape)
                        next.attacks[String(patch.attack.attackerId)] = {
                            attackerId: String(patch.attack.attackerId),
                            targetId: String(patch.attack.targetId),
                            at: patch.attack.at || Date.now(),
                        };
                    }
                } else if (patch.type === "attack:clear") {
                    next.attacks = next.attacks || {};
                    const attackerId = String(patch.attackerId || "");
                    if (attackerId && next.attacks[attackerId]) delete next.attacks[attackerId];
                }

                // effects
                else if (patch.type === "effect:upsert") {
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

        socket.on("state:patch", onPatch);
        return () => socket.off("state:patch", onPatch);
    }, [socket]);

    // Sort tokens by y
    const tokensArr = useMemo(() => {
        return Object.values(state.tokens || {}).sort((a, b) => (a.y || 0) - (b.y || 0));
    }, [state.tokens]);

    const enemiesArr = useMemo(() => {
        return Object.values(state.tokens || {})
            .filter((t) => t?.kind === "enemy")
            .sort((a, b) =>
                String(a.name || "").localeCompare(String(b.name || ""))
            );
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
            const t = next.tokens?.[id];
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
            if (next.tokens?.[tokenId]) next.tokens[tokenId].hp = hp;
            return next;
        });

        socket.emit("token:setHp", { roomId, id: tokenId, hp }, () => { });
    };

    const removeEnemy = (enemyId) => {
        if (!isDm) return;
        socket.emit("token:removeEnemy", { roomId, id: enemyId }, (res) => {
            if (res && res.ok === false)
                alert("Gegner entfernen fehlgeschlagen: " + (res.error || "unknown"));
        });
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

    const lockedAttacker = attackPick.attackerId
        ? state.tokens?.[attackPick.attackerId]
        : null;
    const lockedTarget = attackPick.targetId
        ? state.tokens?.[attackPick.targetId]
        : null;

    const canSetAttack =
        lockedAttacker && lockedTarget && attackPick.attackerId !== attackPick.targetId;

    const setAttack = () => {
        if (!canSetAttack) return;

        socket.emit(
            "attack:set",
            { roomId, attackerId: attackPick.attackerId, targetId: attackPick.targetId },
            (res) => {
                if (res && res.ok === false)
                    alert("Angriff setzen fehlgeschlagen: " + (res.error || "unknown"));
            }
        );

        // Optional: nach Set direkt Auswahl resetten (damit sofort neu wählbar)
        setAttackPick({ attackerId: null, targetId: null });
        setAttackLock(false);
    };

    const clearAttackFor = (attackerId) => {
        if (!attackerId) return;
        socket.emit("attack:clear", { roomId, attackerId }, (res) => {
            if (res && res.ok === false)
                alert("Angriff löschen fehlgeschlagen: " + (res.error || "unknown"));
        });
    };

    const handleDeleteEffect = (id) => {
        if (!id) return;
        if (!isDm) return;

        socket.emit("effect:remove", { roomId, id }, (res) => {
            if (res && res.ok === false)
                alert("Löschen fehlgeschlagen: " + (res.error || "unknown"));
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
                        effect: {
                            kind: "marker",
                            markerType,
                            label,
                            visibility: vis,
                            x: pos.x,
                            y: pos.y,
                        },
                    },
                    (res) => {
                        if (res && res.ok === false)
                            alert("Effect add failed: " + (res.error || "unknown"));
                    }
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
                        if (res && res.ok === false)
                            alert("Effect add failed: " + (res.error || "unknown"));
                    }
                );

                setPlaceMode(null);
                return;
            }
        }
    };

    // Preview-Pfeil (gestrichelt) nur während Lock-Auswahl
    const previewLine = useMemo(() => {
        if (!attackPick.attackerId || !attackPick.targetId) return null;
        const a = state.tokens?.[attackPick.attackerId];
        const b = state.tokens?.[attackPick.targetId];
        if (!a || !b) return null;

        const color = getTokenRingColor(a);
        return { ax: a.x, ay: a.y, bx: b.x, by: b.y, color };
    }, [state.tokens, attackPick.attackerId, attackPick.targetId]);

    // Persistent attack lines (solid) – aus state.attacks (string oder object)
    const persistentAttackLines = useMemo(() => {
        const attacks = state.attacks || {};
        const lines = [];
        for (const [attackerIdRaw, attackVal] of Object.entries(attacks)) {
            const attackerId = String(attackerIdRaw);
            const targetId = getTargetIdFromAttackValue(attackVal);
            if (!targetId) continue;

            const a = state.tokens?.[attackerId];
            const b = state.tokens?.[String(targetId)];
            if (!a || !b) continue;

            lines.push({
                attackerId,
                targetId: String(targetId),
                ax: a.x,
                ay: a.y,
                bx: b.x,
                by: b.y,
                color: getTokenRingColor(a),
            });
        }
        return lines;
    }, [state.attacks, state.tokens]);

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
    // - Wenn Angriff Lock aktiv: Klicks wählen Angreifer/Ziel
    // - Wenn Lock aus: normal (selectedId/targetId) zum „rumklicken“
    const onTokenClick = (t) => {
        if (attackLock) {
            setAttackPick((cur) => {
                if (!cur.attackerId) return { attackerId: t.id, targetId: null };
                if (!cur.targetId)
                    return {
                        attackerId: cur.attackerId,
                        targetId: t.id === cur.attackerId ? null : t.id,
                    };
                return cur;
            });
            return;
        }

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

                                {/* EFFECTS: markers */}
                                {markers.map((m) => {
                                    const markerType = String(m.markerType || "OBJECT").toUpperCase();
                                    const isSel = m.id === selectedEffectId;
                                    const vis = m?.visibility || "ALL";
                                    const pres = markerPresentation(markerType);

                                    const outerR = Math.max(12, Math.round(hexSize * 0.42));
                                    const innerR = Math.max(10, Math.round(hexSize * 0.3));
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

                                {/* Persistent Attack Lines (solid) */}
                                {persistentAttackLines.map((ln) => (
                                    <Group key={`${ln.attackerId}->${ln.targetId}`} listening={false}>
                                        <Line
                                            points={[ln.ax, ln.ay, ln.bx, ln.by]}
                                            stroke={ln.color || "red"}
                                            strokeWidth={Math.max(4, Math.round(hexSize * 0.12))}
                                            lineCap="round"
                                            lineJoin="round"
                                            opacity={0.92}
                                            shadowColor={ln.color || "red"}
                                            shadowBlur={10}
                                            shadowOpacity={0.55}
                                        />
                                        <ArrowHead ax={ln.ax} ay={ln.ay} bx={ln.bx} by={ln.by} color={ln.color || "red"} hexSize={hexSize} />
                                    </Group>
                                ))}

                                {/* Preview Attack Line (Lock-Auswahl) – gestrichelt */}
                                {attackLock && previewLine && (
                                    <Group listening={false}>
                                        <Line
                                            points={[previewLine.ax, previewLine.ay, previewLine.bx, previewLine.by]}
                                            stroke={previewLine.color || "red"}
                                            strokeWidth={Math.max(3, Math.round(hexSize * 0.1))}
                                            lineCap="round"
                                            lineJoin="round"
                                            opacity={0.75}
                                            dash={[10, 10]}
                                            shadowColor={previewLine.color || "red"}
                                            shadowBlur={8}
                                            shadowOpacity={0.35}
                                        />
                                        <ArrowHead ax={previewLine.ax} ay={previewLine.ay} bx={previewLine.bx} by={previewLine.by} color={previewLine.color || "red"} hexSize={hexSize} />
                                    </Group>
                                )}

                                {/* Tokens */}
                                {tokensArr.map((t) => (
                                    <Token
                                        key={t.id}
                                        token={t}
                                        selfId={selfId}
                                        isDm={isDm}
                                        selected={attackLock ? t.id === attackPick.attackerId : t.id === selectedId}
                                        targeted={attackLock ? t.id === attackPick.targetId : t.id === targetId}
                                        hexSize={hexSize}
                                        mapW={state.map.width}
                                        mapH={state.map.height}
                                        onMove={(id, nx, ny) => moveToken(id, nx, ny)}
                                        onClick={() => onTokenClick(t)}
                                        onHpChange={(id, hp) => setEnemyHp(id, hp)}
                                        onRemoveEnemy={(id) => removeEnemy(id)}
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
                        Steuerung: Token ziehen = bewegen (dein Token; DM kann Gegner ziehen). Zoom: Mausrad. Pan: Shift+Linksklick ziehen oder
                        Mausrad-Klick ziehen.
                        <br />
                        Angriff: Mit <b>„Angriff auswählen (Lock)”</b> wählst du Angreifer → Ziel und setzt danach den Angriff. Die Pfeile bleiben, bis du
                        ein neues Ziel setzt oder ein Gegner entfernt wird.
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

                    {/* ATTACK PICK */}
                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Angriff (Pfeil bleibt)</div>

                        <div style={{ display: "grid", gap: 8 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                                <input
                                    type="checkbox"
                                    checked={attackLock}
                                    onChange={(e) => {
                                        const v = e.target.checked;
                                        setAttackLock(v);
                                        if (!v) setAttackPick({ attackerId: null, targetId: null });
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
                                <button onClick={setAttack} disabled={!canSetAttack}>
                                    Angriff setzen
                                </button>
                                <button style={{ marginLeft: 8 }} onClick={() => setAttackPick({ attackerId: null, targetId: null })}>
                                    Neu wählen
                                </button>
                            </div>

                            <div style={{ fontSize: 12, opacity: 0.75 }}>
                                Wenn Lock aktiv: Klicke <b>Angreifer</b> → <b>Ziel</b>. Danach <b>„Angriff setzen“</b>.
                            </div>
                        </div>
                    </div>

                    {/* DM: ENEMIES PANEL (HP +/- + Remove) */}
                    {isDm && (
                        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                            <div style={{ fontWeight: 700, marginBottom: 8 }}>Gegner & HP (nur DM)</div>

                            {enemiesArr.length === 0 ? (
                                <div style={{ fontSize: 13, opacity: 0.7 }}>Keine Gegner auf dem Feld.</div>
                            ) : (
                                <div style={{ display: "grid", gap: 8 }}>
                                    {enemiesArr.map((en) => {
                                        const hp = typeof en.hp === "number" ? en.hp : 0;
                                        return (
                                            <div
                                                key={en.id}
                                                style={{
                                                    border: "1px solid #eee",
                                                    borderRadius: 10,
                                                    padding: 8,
                                                    display: "grid",
                                                    gap: 6,
                                                }}
                                            >
                                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                    <div style={{ fontWeight: 700, flex: 1 }}>{en.name}</div>
                                                    <div style={{ fontFamily: "monospace", opacity: 0.85 }}>HP {hp}</div>
                                                </div>

                                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                    <button onClick={() => setEnemyHp(en.id, hp - 1)}>-</button>
                                                    <button onClick={() => setEnemyHp(en.id, hp + 1)}>+</button>
                                                    <button onClick={() => clearAttackFor(en.id)} title="Pfeil dieses Gegners löschen">
                                                        Angriff löschen
                                                    </button>
                                                    <button onClick={() => removeEnemy(en.id)} style={{ marginLeft: "auto", background: "#ffe5e5" }}>
                                                        Entfernen
                                                    </button>
                                                </div>

                                                <div style={{ fontSize: 12, opacity: 0.7 }}>
                                                    Tipp: Entfernen löscht auch alle Angriffe, die diesen Gegner betreffen.
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ENEMY ADD */}
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
                                        disabled={!isDm}
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
                                    disabled={!isDm}
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

                    {/* EVENTS / EFFECTS */}
                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Effekte</div>

                        <div style={{ display: "grid", gap: 8 }}>
                            <div>
                                <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>Aktion</label>
                                <select value={eventKind} onChange={(e) => setEventKind(e.target.value)} style={{ width: "100%" }}>
                                    <option value="ATTACK">Angriff (oben)</option>
                                    <option value="TREASURE">Eventmarker: Schatz</option>
                                    <option value="TRAP">Eventmarker: Falle</option>
                                    <option value="LEVER">Eventmarker: Hebel</option>
                                    <option value="PLATE">Eventmarker: Trittplatte</option>
                                    <option value="KEY">Eventmarker: Schlüssel</option>
                                    <option value="OBJECT">Eventmarker: Objekt (Beschriftung)</option>
                                    <option value="WALL_FIRE">Feuerwand setzen</option>
                                    <option value="WALL_ICE">Eiswand setzen</option>
                                </select>
                            </div>

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

                    {/* SELECTED EFFECT */}
                    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10 }}>
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

function Token({
    token,
    selfId,
    isDm,
    onMove,
    onHpChange,
    onRemoveEnemy,
    hexSize,
    mapW,
    mapH,
    onClick,
    selected,
    targeted,
}) {
    const avatar = useHtmlImage(token.imgUrl);
    const isEnemy = token.kind === "enemy";
    const ringColor = getTokenRingColor(token);

    const tokenHexSize = Math.max(14, hexSize * 0.98);
    const hexPts = useMemo(() => hexClipPolygonPoints(tokenHexSize), [tokenHexSize]);

    const hexW = Math.sqrt(3) * tokenHexSize;
    const hexH = 2 * tokenHexSize;

    const isSelf = token.id === selfId;
    const canDrag = isSelf || (isDm && isEnemy);

    const hitHexPoints = useMemo(() => hexCornerPoints(0, 0, tokenHexSize), [tokenHexSize]);

    // HP should be DM-only visible
    const hp = typeof token.hp === "number" ? token.hp : 0;

    const bumpHp = (delta) => {
        if (!isDm || !isEnemy) return;
        const next = Math.max(0, hp + delta);
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
            onContextMenu={(e) => {
                if (!isDm || !isEnemy) return;
                e.evt.preventDefault();
                e.cancelBubble = true;
                onRemoveEnemy?.(token.id);
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
                strokeWidth={Math.max(3, Math.round(hexSize * 0.1))}
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

            {/* HP badge (nur DM, nur enemies) */}
            {isDm && isEnemy && (
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
                    <Text text={`HP ${hp}`} x={-28} y={-10} width={56} align="center" fontSize={12} fill={"white"} listening={false} />

                    {/* +/- nur DM */}
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