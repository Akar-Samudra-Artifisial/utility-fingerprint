"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { ClusterView, HeatField } from "@/lib/data/select";
import { SIGNATURE_MIN_COUNT } from "@/lib/data/select";
import { HEAT_GRID, type MapMeta } from "@/lib/data/types";
import { DIFF_LUT, HEAT_LUT } from "@/lib/colors";
import type { DiffField } from "@/lib/data/compare";
import type { Layer } from "@/lib/url-state";
import { abilityName, agentName, PHASE_LABEL, pct, roundClock } from "@/lib/format";
import { ClusterDetail } from "./cluster-detail";

interface MapCanvasProps {
  map: MapMeta;
  heat: HeatField | null;
  /** When set, the heat layer shows this signed A − B field with the diverging colormap instead. */
  diff?: DiffField | null;
  clusters: ClusterView[];
  colors: Map<string, string>;
  layers: readonly Layer[];
  focusId: string | null;
  onFocus: (id: string | null) => void;
  /** Short text summary for screen readers. */
  description: string;
  /** Colormap for `heat` (default: the cast-density LUT). */
  heatLut?: Uint8ClampedArray;
  /** Extra heat layers drawn above `heat`, in order, each with its own colormap (memoize the array). */
  overlays?: readonly HeatOverlay[];
  /** Accessible name per cluster button (default: ability, agent, phase, share, casts, time). */
  clusterLabel?: (c: ClusterView) => string;
  /** Tooltip / pinned card for a cluster (default: ClusterDetail). */
  renderDetail?: (c: ClusterView, onClose?: () => void) => ReactNode;
  /** Accessible name of the cluster button group. */
  clusterGroupLabel?: string;
}

export interface HeatOverlay {
  field: HeatField;
  lut: Uint8ClampedArray;
}

const NO_OVERLAYS: readonly HeatOverlay[] = [];

function defaultClusterLabel(c: ClusterView): string {
  return `${abilityName(c.ability)}, ${agentName(c.agent)}, ${PHASE_LABEL[c.phase]}: ${pct(c.cluster.share)} of casts, ${c.cluster.count} casts, average time ${roundClock(c.cluster.mean_t_round_ms)}`;
}

const HEAT_RES_STEP = 128; // heat canvas follows device pixels, bucketed to limit re-renders
const HEAT_RES_MAX = 2048;
const TOOLTIP_W = 240;
const TOOLTIP_H = 170;
const LABEL_LIMIT = 10; // share labels drawn for the N largest clusters (+ hovered/focused)
const MIN_HIT_PX = 10;

type Img = { src: string; el: HTMLImageElement | null; failed: boolean };

/** Accumulate radial blobs for cells where sign·value > 0; returns the alpha intensity image. */
function paintBlobs(
  cells: Float32Array,
  max: number,
  res: number,
  sign: 1 | -1,
  grid: number = HEAT_GRID,
): ImageData | null {
  const intensity = document.createElement("canvas");
  intensity.width = intensity.height = res;
  const ictx = intensity.getContext("2d", { willReadFrequently: true });
  if (!ictx) return null;
  const cell = res / grid;
  // coarse grids already span more map per cell; a tighter blob keeps heat from bleeding off the walls
  const radius = cell * (grid <= 24 ? 1.2 : 1.7);
  ictx.globalCompositeOperation = "lighter";
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const c = cells[row * grid + col] * sign;
      if (c <= 0) continue;
      // sqrt keeps mid-density areas visible next to one dominant spot
      const a = Math.min(1, 0.55 * Math.sqrt(c / max) + 0.08);
      const x = (col + 0.5) * cell;
      const y = (row + 0.5) * cell;
      const g = ictx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ictx.fillStyle = g;
      ictx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }
  return ictx.getImageData(0, 0, res, res);
}

function toCanvas(data: ImageData): HTMLCanvasElement | null {
  const out = document.createElement("canvas");
  out.width = data.width;
  out.height = data.height;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(data, 0, 0);
  return out;
}

/** Density heat: blob alpha → sequential LUT. */
function renderHeat(heat: HeatField, res: number, lut: Uint8ClampedArray = HEAT_LUT): HTMLCanvasElement | null {
  if (heat.max <= 0 || res <= 0) return null;
  const data = paintBlobs(heat.cells, heat.max, res, 1, heat.grid);
  if (!data) return null;
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const k = px[i + 3] * 4;
    px[i] = lut[k];
    px[i + 1] = lut[k + 1];
    px[i + 2] = lut[k + 2];
    px[i + 3] = lut[k + 3];
  }
  return toCanvas(data);
}

/** Signed heat (A − B): positive and negative blobs painted separately, netted per pixel → diverging LUT. */
function renderDiff(diff: DiffField, res: number): HTMLCanvasElement | null {
  if (diff.maxAbs <= 0 || res <= 0) return null;
  const pos = paintBlobs(diff.cells, diff.maxAbs, res, 1);
  const neg = paintBlobs(diff.cells, diff.maxAbs, res, -1);
  if (!pos || !neg) return null;
  const px = pos.data;
  const nx = neg.data;
  for (let i = 0; i < px.length; i += 4) {
    const k = Math.round((px[i + 3] - nx[i + 3] + 255) / 2) * 4;
    px[i] = DIFF_LUT[k];
    px[i + 1] = DIFF_LUT[k + 1];
    px[i + 2] = DIFF_LUT[k + 2];
    px[i + 3] = DIFF_LUT[k + 3];
  }
  return toCanvas(pos);
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  len: number,
  color: string,
  dashed: boolean,
) {
  const ex = x + dx * len;
  const ey = y + dy * len;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.setLineDash(dashed ? [4, 4] : []);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  const head = 7;
  const ang = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(ex + Math.cos(ang) * 2, ey + Math.sin(ang) * 2);
  ctx.lineTo(ex - head * Math.cos(ang - 0.45), ey - head * Math.sin(ang - 0.45));
  ctx.lineTo(ex - head * Math.cos(ang + 0.45), ey - head * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  family: string,
  taken: DOMRect[],
  force: boolean,
) {
  ctx.save();
  ctx.font = `600 11px ${family}`;
  const w = ctx.measureText(text).width + 10;
  const h = 17;
  const rect = new DOMRect(x - w / 2, y - h / 2, w, h);
  const overlaps = taken.some(
    (t) => rect.left < t.right && rect.right > t.left && rect.top < t.bottom && rect.bottom > t.top,
  );
  if (overlaps && !force) {
    ctx.restore();
    return;
  }
  taken.push(rect);
  ctx.fillStyle = "rgba(8,11,16,0.88)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f2f5f9";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

export function MapCanvas({
  map,
  heat,
  diff = null,
  clusters,
  colors,
  layers,
  focusId,
  onFocus,
  description,
  heatLut = HEAT_LUT,
  overlays = NO_OVERLAYS,
  clusterLabel = defaultClusterLabel,
  renderDetail,
  clusterGroupLabel = "Utility clusters",
}: MapCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  const [heatRes, setHeatRes] = useState(0);
  const [img, setImg] = useState<Img>({ src: "", el: null, failed: false });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const pendingPointer = useRef<{ x: number; y: number } | null>(null);
  const rafId = useRef<number | null>(null);

  // Square drawing area that fits the container.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const side = Math.max(0, Math.floor(Math.min(width, height || width)));
      const dpr = window.devicePixelRatio || 1;
      setSize(side);
      setHeatRes(Math.min(HEAT_RES_MAX, Math.ceil((side * dpr) / HEAT_RES_STEP) * HEAT_RES_STEP));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  // Minimap image (cross-origin; only drawn, never read back, so no CORS needed).
  useEffect(() => {
    let cancelled = false;
    const el = new Image();
    el.decoding = "async";
    el.onload = () => !cancelled && setImg({ src: map.display_icon, el, failed: false });
    el.onerror = () => !cancelled && setImg({ src: map.display_icon, el: null, failed: true });
    el.src = map.display_icon;
    return () => {
      cancelled = true;
    };
  }, [map.display_icon]);

  const imgReady = img.src === map.display_icon && img.el !== null;
  const imgFailed = img.src === map.display_icon && img.failed;

  const heatCanvas = useMemo(
    () => {
      if (typeof document === "undefined") return null;
      if (diff) return renderDiff(diff, heatRes);
      return heat ? renderHeat(heat, heatRes, heatLut) : null;
    },
    [heat, diff, heatRes, heatLut],
  );

  const overlayCanvases = useMemo(
    () =>
      typeof document === "undefined"
        ? []
        : overlays.map((o) => renderHeat(o.field, heatRes, o.lut)).filter((c): c is HTMLCanvasElement => c !== null),
    [overlays, heatRes],
  );

  const labelled = useMemo(() => {
    const ids = [...clusters]
      .sort((a, b) => b.cluster.count - a.cluster.count)
      .slice(0, LABEL_LIMIT)
      .map((c) => c.id);
    return new Set(ids);
  }, [clusters]);

  // Keyboard order: biggest clusters first (same priority as the share labels).
  const keyboardOrder = useMemo(
    () => [...clusters].sort((a, b) => b.cluster.count - a.cluster.count),
    [clusters],
  );

  const showHeat = layers.includes("heat");
  const showClusters = layers.includes("clusters");
  const showArrows = layers.includes("arrows");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // canvas cannot resolve CSS variables; reuse the resolved page font stack
    const family = getComputedStyle(canvas).fontFamily || "system-ui, sans-serif";
    ctx.clearRect(0, 0, size, size);

    if (imgReady && img.el) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(img.el, 0, 0, size, size);
      ctx.globalAlpha = 1;
    }

    if (showHeat && heatCanvas) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(heatCanvas, 0, 0, size, size);
    }
    for (const oc of overlayCanvases) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(oc, 0, 0, size, size);
    }

    // Site letters (valorant-api callouts: label anchors, not exact centres).
    ctx.save();
    ctx.font = `700 13px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const s of map.sites) {
      const x = s.u * size;
      const y = s.v * size;
      ctx.fillStyle = "rgba(8,11,16,0.7)";
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e9edf2";
      ctx.fillText(s.site, x, y + 0.5);
    }
    ctx.restore();

    if (!showClusters && !showArrows) return;
    const taken: DOMRect[] = [];
    const ordered = [...clusters].sort((a, b) => {
      const pa = a.id === focusId || a.id === hoverId ? 1 : 0;
      const pb = b.id === focusId || b.id === hoverId ? 1 : 0;
      return pa - pb || b.cluster.radius - a.cluster.radius;
    });

    for (const c of ordered) {
      const color = colors.get(c.agent) ?? "#ffffff";
      const x = c.cluster.u * size;
      const y = c.cluster.v * size;
      const r = Math.max(c.cluster.radius * size, 6);
      const active = c.id === focusId || c.id === hoverId;
      const dimmed = focusId !== null && !active;
      const lowSample = c.cluster.count < SIGNATURE_MIN_COUNT;
      ctx.globalAlpha = dimmed ? 0.22 : 1;

      if (showClusters) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha *= active ? 0.3 : 0.14;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = active ? 2.5 : 1.5;
        ctx.setLineDash(lowSample ? [3, 3] : []);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (showArrows && c.cluster.view) {
        const [du, dv] = c.cluster.view;
        const consistency = c.cluster.view_consistency ?? 0;
        const len = Math.max(r + 6, size * (0.025 + 0.045 * consistency));
        drawArrow(ctx, x, y, du, dv, len, color, consistency < 0.5);
      }

      ctx.globalAlpha = 1;
    }

    // Share labels last, highest priority first, skipping ones that would collide.
    if (showClusters) {
      const isActive = (c: ClusterView) => c.id === focusId || c.id === hoverId;
      const toLabel = clusters
        .filter((c) => isActive(c) || (focusId === null && labelled.has(c.id)))
        .sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || b.cluster.count - a.cluster.count);
      for (const c of toLabel) {
        const r = Math.max(c.cluster.radius * size, 6);
        const color = colors.get(c.agent) ?? "#ffffff";
        const label = `${Math.round(c.cluster.share * 100)}%`;
        drawPill(ctx, label, c.cluster.u * size, c.cluster.v * size - r - 11, color, family, taken, isActive(c));
      }
    }
  }, [
    size,
    imgReady,
    img.el,
    heatCanvas,
    overlayCanvases,
    showHeat,
    showClusters,
    showArrows,
    clusters,
    colors,
    focusId,
    hoverId,
    labelled,
    map.sites,
  ]);

  function hitTest(clientX: number, clientY: number): ClusterView | null {
    const canvas = canvasRef.current;
    if (!canvas || !(showClusters || showArrows)) return null;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: ClusterView | null = null;
    let bestD = Infinity;
    for (const c of clusters) {
      const d = Math.hypot(c.cluster.u * size - px, c.cluster.v * size - py);
      const r = Math.max(c.cluster.radius * size, MIN_HIT_PX);
      // prefer the closest centre among the circles under the pointer
      if (d <= r && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  const hovered = hoverId ? clusters.find((c) => c.id === hoverId) ?? null : null;
  const focused = focusId ? clusters.find((c) => c.id === focusId) ?? null : null;
  const showHover = hovered !== null && hovered.id !== focusId;

  return (
    <div ref={wrapRef} className="relative flex min-h-0 w-full flex-1 items-center justify-center">
      <div className="relative" style={{ width: size, height: size }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={description}
          className="block size-full cursor-crosshair rounded-md"
          style={{ width: size, height: size }}
          onPointerMove={(e) => {
            // Hit-test at most once per frame; state only changes when the hovered cluster does.
            pendingPointer.current = { x: e.clientX, y: e.clientY };
            if (rafId.current !== null) return;
            rafId.current = requestAnimationFrame(() => {
              rafId.current = null;
              const p = pendingPointer.current;
              if (!p) return;
              setHoverId(hitTest(p.x, p.y)?.id ?? null);
            });
          }}
          onPointerLeave={() => {
            pendingPointer.current = null;
            setHoverId(null);
          }}
          onClick={(e) => {
            const hit = hitTest(e.clientX, e.clientY);
            onFocus(hit && hit.id !== focusId ? hit.id : null);
          }}
        />
        {!imgReady && !imgFailed && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            Loading minimap…
          </div>
        )}
        {imgFailed && (
          <p className="absolute inset-x-0 top-2 text-center text-xs text-destructive">
            Minimap image could not be loaded; overlays are still positioned correctly.
          </p>
        )}
        {(showClusters || showArrows) && keyboardOrder.length > 0 && (
          <div role="group" aria-label={`${clusterGroupLabel}. Arrow keys move between clusters, Enter highlights, Escape clears.`}>
            {keyboardOrder.map((c, i) => {
              const r = Math.max(c.cluster.radius * size, MIN_HIT_PX);
              const tabbable = focusId ? c.id === focusId : i === 0;
              return (
                <button
                  key={c.id}
                  type="button"
                  data-cluster-id={c.id}
                  tabIndex={tabbable ? 0 : -1}
                  aria-pressed={c.id === focusId}
                  aria-label={clusterLabel(c)}
                  className="pointer-events-none absolute rounded-full opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring"
                  style={{ left: c.cluster.u * size - r, top: c.cluster.v * size - r, width: r * 2, height: r * 2 }}
                  onFocus={() => setHoverId(c.id)}
                  onBlur={() => setHoverId((h) => (h === c.id ? null : h))}
                  onClick={() => onFocus(c.id === focusId ? null : c.id)}
                  onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
                    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
                    if (e.key === "Escape") {
                      onFocus(null);
                      return;
                    }
                    if (step === undefined && e.key !== "Home" && e.key !== "End") return;
                    e.preventDefault();
                    const n = keyboardOrder.length;
                    const next =
                      e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (step ?? 0) + n) % n;
                    const group = e.currentTarget.parentElement;
                    group?.querySelector<HTMLButtonElement>(`[data-cluster-id="${CSS.escape(keyboardOrder[next].id)}"]`)?.focus();
                  }}
                />
              );
            })}
          </div>
        )}
        {/* One card at a time: a hovered / keyboard-focused cluster wins over the pinned one, which returns after. */}
        {showHover && hovered && (
          <div
            className="pointer-events-none absolute z-10 w-60"
            style={{
              // anchored next to the cluster, clamped inside the map (never negative on small screens)
              left: Math.max(0, Math.min(hovered.cluster.u * size + 16, size - TOOLTIP_W - 4)),
              top: Math.max(0, Math.min(hovered.cluster.v * size + 16, size - TOOLTIP_H)),
            }}
          >
            {renderDetail ? (
              renderDetail(hovered)
            ) : (
              <ClusterDetail view={hovered} color={colors.get(hovered.agent) ?? "#fff"} />
            )}
          </div>
        )}
        {focused && !showHover && (
          <div className="absolute top-2 right-2 z-10 w-60">
            {renderDetail ? (
              renderDetail(focused, () => onFocus(null))
            ) : (
              <ClusterDetail
                view={focused}
                color={colors.get(focused.agent) ?? "#fff"}
                onClose={() => onFocus(null)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
