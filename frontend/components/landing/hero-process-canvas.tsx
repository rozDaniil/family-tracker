"use client";

import { useEffect, useRef } from "react";

type CardRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function progressInWindow(now: number, start: number, duration: number) {
  return clamp01((now - start) / duration);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  rect: CardRect,
  opacity: number,
  title: string,
  subtitle: string
) {
  if (opacity <= 0) {
    return;
  }

  const yShift = (1 - opacity) * 10;
  const x = rect.x;
  const y = rect.y + yShift;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.shadowColor = "rgba(90,71,53,0.12)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 7;
  roundedRect(ctx, x, y, rect.w, rect.h, 16);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(90,71,53,0.14)";
  ctx.stroke();

  ctx.fillStyle = "rgba(90,71,53,1)";
  ctx.font = "600 14px var(--font-nunito-sans), sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(title, x + 14, y + 13);

  ctx.fillStyle = "rgba(63,58,52,0.74)";
  ctx.font = "400 12px var(--font-nunito-sans), sans-serif";
  ctx.fillText(subtitle, x + 14, y + 35);
  ctx.restore();
}

function drawCurvedArrow(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  direction: "right" | "left",
  progress: number,
  breathe: number
) {
  if (progress <= 0) {
    return;
  }

  const cpOffset = 58;
  const cp1x = direction === "right" ? startX + cpOffset : startX - cpOffset;
  const cp2x = direction === "right" ? endX + cpOffset : endX - cpOffset;
  const cp1y = startY + 22;
  const cp2y = endY - 22;
  const p = clamp01(progress);

  ctx.save();
  ctx.beginPath();
  const segments = 70;
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * p;
    const point = cubicPoint(startX, startY, cp1x, cp1y, cp2x, cp2y, endX, endY, t);
    if (i === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }

  const baseAlpha = 0.74 + breathe * 0.14;
  const baseWidth = 2 + breathe * 0.25;

  ctx.setLineDash([2.5, 7.5]);
  ctx.lineDashOffset = 0;
  ctx.strokeStyle = `rgba(126,104,81,${baseAlpha.toFixed(3)})`;
  ctx.lineWidth = baseWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();

  if (p >= 1) {
    const tangent = cubicTangent(startX, startY, cp1x, cp1y, cp2x, cp2y, endX, endY, 1);
    const dx = tangent.x;
    const dy = tangent.y;
    const angle = Math.atan2(dy, dx);
    const head = 9;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - head * Math.cos(angle - 0.5), endY - head * Math.sin(angle - 0.5));
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - head * Math.cos(angle + 0.5), endY - head * Math.sin(angle + 0.5));
    ctx.strokeStyle = `rgba(126,104,81,${(baseAlpha + 0.05).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.stroke();
  }
  ctx.restore();
}

function cubicPoint(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number
) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t2 * t * x3,
    y: mt2 * mt * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t2 * t * y3,
  };
}

function cubicTangent(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number
) {
  const mt = 1 - t;
  return {
    x: 3 * mt * mt * (x1 - x0) + 6 * mt * t * (x2 - x1) + 3 * t * t * (x3 - x2),
    y: 3 * mt * mt * (y1 - y0) + 6 * mt * t * (y2 - y1) + 3 * t * t * (y3 - y2),
  };
}

export function HeroProcessCanvas() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let raf = 0;
    let startTs = 0;

    const timeline = {
      card1Start: 0.12,
      card1Dur: 0.42,
      arrow1Start: 0.62,
      arrow1Dur: 0.92,
      card2Start: 1.58,
      card2Dur: 0.42,
      arrow2Start: 2.08,
      arrow2Dur: 0.92,
      card3Start: 3.04,
      card3Dur: 0.42,
      doneAt: 3.5,
    };

    const draw = (ts: number) => {
      if (!startTs) {
        startTs = ts;
      }
      const elapsed = reduceMotion ? timeline.doneAt : (ts - startTs) / 1000;

      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cardW = Math.min(246, Math.max(196, width - 42));
      const cardH = 84;
      const centerX = width / 2;

      const offsetX = Math.min(42, Math.max(20, width * 0.09));
      const card1: CardRect = { x: centerX - cardW / 2 - offsetX, y: 20, w: cardW, h: cardH };
      const card2: CardRect = {
        x: centerX - cardW / 2,
        y: Math.round(height * 0.5) - cardH / 2 + 26,
        w: cardW,
        h: cardH,
      };
      const card3: CardRect = { x: centerX - cardW / 2 + offsetX, y: height - cardH + 6, w: cardW, h: cardH };

      const card1p = easeOutCubic(progressInWindow(elapsed, timeline.card1Start, timeline.card1Dur));
      const arrow1p = easeOutCubic(progressInWindow(elapsed, timeline.arrow1Start, timeline.arrow1Dur));
      const card2p = easeOutCubic(progressInWindow(elapsed, timeline.card2Start, timeline.card2Dur));
      const arrow2p = easeOutCubic(progressInWindow(elapsed, timeline.arrow2Start, timeline.arrow2Dur));
      const card3p = easeOutCubic(progressInWindow(elapsed, timeline.card3Start, timeline.card3Dur));

      const breathe = elapsed >= timeline.doneAt ? (Math.sin((elapsed - timeline.doneAt) * 2.3) + 1) / 2 : 0;

      drawCard(ctx, card1, card1p, "Placeholder block 1", "Temporary text");
      drawCurvedArrow(
        ctx,
        card1.x + card1.w / 2,
        card1.y + cardH,
        card2.x + card2.w / 2,
        card2.y,
        "right",
        arrow1p,
        breathe
      );

      drawCard(ctx, card2, card2p, "Placeholder block 2", "Temporary text");
      drawCurvedArrow(
        ctx,
        card2.x + card2.w / 2,
        card2.y + cardH,
        card3.x + card3.w / 2,
        card3.y,
        "left",
        arrow2p,
        breathe
      );
      drawCard(ctx, card3, card3p, "Placeholder block 3", "Temporary text");

      if (!reduceMotion) {
        raf = requestAnimationFrame(draw);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      startTs = 0;
      raf = requestAnimationFrame(draw);
    });

    resizeObserver.observe(wrap);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className="hero-process-canvas-wrap">
      <canvas ref={canvasRef} className="hero-process-canvas" aria-hidden="true" />
    </div>
  );
}
