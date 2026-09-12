"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Bounds } from "@/lib/types";

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export interface Size {
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface PanZoom {
  /** Callback ref for the element the map is drawn into. */
  attach: (el: HTMLDivElement | null) => void;
  size: Size;
  view: Viewport;
  /** Transform for the root <g>. */
  transform: string;
  panning: boolean;
  fitTo: (b: Bounds, opts?: { padding?: number; animate?: boolean; maxZoom?: number }) => void;
  zoomBy: (factor: number) => void;
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  visibleWorld: () => Bounds;
}

export function usePanZoom(world: Bounds, limits = { min: 0.08, max: 14 }): PanZoom {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const anim = useRef<number | null>(null);
  const fitted = useRef(false);

  // Mirrored into refs so the native pointer/wheel listeners below always see
  // the latest values without being torn down and re-attached on every frame.
  const viewRef = useRef(view);
  const sizeRef = useRef(size);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const stop = () => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
  };

  const animateTo = useCallback((target: Viewport, animate: boolean) => {
    stop();
    if (!animate) {
      setView(target);
      return;
    }
    const from = viewRef.current;
    const start = performance.now();
    const duration = 420;
    const step = (now: number) => {
      const t = clamp((now - start) / duration, 0, 1);
      const e = easeInOut(t);
      setView({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        k: from.k * Math.pow(target.k / from.k, e),
      });
      if (t < 1) anim.current = requestAnimationFrame(step);
      else anim.current = null;
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  const fitTo = useCallback<PanZoom["fitTo"]>(
    (b, opts) => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const padding = opts?.padding ?? 48;
      const bw = Math.max(1, b.maxX - b.minX);
      const bh = Math.max(1, b.maxY - b.minY);
      const k = clamp(
        Math.min((w - padding * 2) / bw, (h - padding * 2) / bh),
        limits.min,
        Math.min(opts?.maxZoom ?? limits.max, limits.max),
      );
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      animateTo({ k, x: w / 2 - cx * k, y: h / 2 - cy * k }, opts?.animate ?? true);
    },
    [animateTo, limits.max, limits.min],
  );

  // Initial fit once the container has been measured.
  useEffect(() => {
    if (fitted.current || !size.w || !size.h) return;
    fitted.current = true;
    fitTo(world, { animate: false });
  }, [size.w, size.h, world, fitTo]);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      stop();
      setView((v) => {
        const k = clamp(v.k * factor, limits.min, limits.max);
        const scale = k / v.k;
        return { k, x: cx - (cx - v.x) * scale, y: cy - (cy - v.y) * scale };
      });
    },
    [limits.max, limits.min],
  );

  const zoomBy = useCallback(
    (factor: number) => zoomAt(factor, sizeRef.current.w / 2, sizeRef.current.h / 2),
    [zoomAt],
  );

  // Wheel needs a non-passive listener to be able to cancel page scroll.
  useEffect(() => {
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 400 : 1;
      zoomAt(Math.exp(-e.deltaY * unit * 0.0018), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [el, zoomAt]);

  // Drag to pan, two fingers to pinch.
  useEffect(() => {
    if (!el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinchDist = 0;
    let captured = false;

    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      // Elements that drive their own drag (editor sections) opt out of panning.
      if ((e.target as Element)?.closest?.("[data-nopan]")) return;
      pointers.set(e.pointerId, local(e));
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      // Capture is deliberately deferred until the pointer actually moves:
      // capturing here would retarget the follow-up click to this container and
      // seats would never receive it.
    };

    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const now = local(e);
      pointers.set(e.pointerId, now);

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) zoomAt(dist / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinchDist = dist;
        setPanning(true);
        return;
      }

      const dx = now.x - prev.x;
      const dy = now.y - prev.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved <= 4) return;
      if (!captured) {
        captured = true;
        setPanning(true);
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // the pointer may already be gone; panning still works without capture
        }
      }
      stop();
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (captured && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (pointers.size === 0) {
        captured = false;
        // Let the click handler see the drag flag before it clears.
        setTimeout(() => setPanning(false), 0);
      }
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [el, zoomAt]);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = el?.getBoundingClientRect();
      const v = viewRef.current;
      return {
        x: (clientX - (r?.left ?? 0) - v.x) / v.k,
        y: (clientY - (r?.top ?? 0) - v.y) / v.k,
      };
    },
    [el],
  );

  const visibleWorld = useCallback((): Bounds => {
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    return {
      minX: -v.x / v.k,
      minY: -v.y / v.k,
      maxX: (w - v.x) / v.k,
      maxY: (h - v.y) / v.k,
    };
  }, []);

  return {
    attach: setEl,
    size,
    view,
    transform: `translate(${view.x} ${view.y}) scale(${view.k})`,
    panning,
    fitTo,
    zoomBy,
    toWorld,
    visibleWorld,
  };
}

export const intersects = (a: Bounds, b: Bounds) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
