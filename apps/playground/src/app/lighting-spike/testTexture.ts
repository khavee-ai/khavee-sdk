/**
 * testTexture — SPIKE 004 (backdrop-plane-dof). Throwaway.
 *
 * Generates a backdrop image procedurally instead of shipping photo fixtures.
 * Deliberate: a photo makes it hard to SEE what `cover` cropped, while a drawn
 * frame + centre crosshair + edge rulers make the crop self-evident — if the
 * outer border is missing on two sides, those sides were cropped, and by how
 * much is readable off the rulers.
 *
 * Also avoids adding binary fixtures to the repo for a throwaway spike.
 */
import * as THREE from "three";

export interface TestPatternOptions {
  /** Image aspect ratio (width / height). */
  aspect: number;
  /** Long-edge resolution in px. */
  size?: number;
  label?: string;
}

export function makeTestPatternTexture({
  aspect,
  size = 1024,
  label = "",
}: TestPatternOptions): THREE.CanvasTexture {
  const w = aspect >= 1 ? size : Math.round(size * aspect);
  const h = aspect >= 1 ? Math.round(size / aspect) : size;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Base gradient — gives DOF something with gentle detail to blur, so the
  // blur is judgeable on more than just hard lines.
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#2b3a67");
  grad.addColorStop(0.5, "#4a6fa5");
  grad.addColorStop(1, "#8e6fa5");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // High-frequency grid — the first thing to visibly go when DOF engages.
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  const step = Math.round(Math.min(w, h) / 16);
  for (let x = 0; x <= w; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Outer border — if an edge is missing on screen, that edge was cropped.
  const inset = Math.round(Math.min(w, h) * 0.02);
  ctx.strokeStyle = "#ff3b6b";
  ctx.lineWidth = Math.max(4, Math.round(Math.min(w, h) * 0.012));
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);

  // Edge rulers — read how much was cropped, not just that it was.
  ctx.fillStyle = "#ffd166";
  const tick = Math.round(Math.min(w, h) * 0.03);
  for (let i = 1; i < 10; i++) {
    const x = (w * i) / 10;
    const y = (h * i) / 10;
    ctx.fillRect(x - 1, 0, 2, tick);
    ctx.fillRect(x - 1, h - tick, 2, tick);
    ctx.fillRect(0, y - 1, tick, 2);
    ctx.fillRect(w - tick, y - 1, tick, 2);
  }

  // Centre crosshair — should stay dead centre no matter the aspect.
  ctx.strokeStyle = "#00e5a0";
  ctx.lineWidth = Math.max(3, Math.round(Math.min(w, h) * 0.008));
  const cx = w / 2;
  const cy = h / 2;
  const arm = Math.min(w, h) * 0.08;
  ctx.beginPath();
  ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy);
  ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm);
  ctx.stroke();

  // Corner tags — name which corner survived.
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(Math.min(w, h) * 0.045)}px monospace`;
  const pad = inset + tick;
  ctx.textBaseline = "top";
  ctx.fillText("TL", pad, pad);
  ctx.textAlign = "right";
  ctx.fillText("TR", w - pad, pad);
  ctx.textBaseline = "bottom";
  ctx.fillText("BR", w - pad, h - pad);
  ctx.textAlign = "left";
  ctx.fillText("BL", pad, h - pad);

  // Aspect label at centre.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `bold ${Math.round(Math.min(w, h) * 0.05)}px monospace`;
  ctx.fillText(label || `${aspect.toFixed(3)}`, cx, cy + arm * 1.4);
  ctx.font = `${Math.round(Math.min(w, h) * 0.03)}px monospace`;
  ctx.fillText(`${w}x${h}`, cx, cy + arm * 1.4 + Math.min(w, h) * 0.06);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Cover crops by sampling a sub-rectangle; clamping stops the cropped edge
  // from wrapping around and reappearing on the opposite side.
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export const TEST_ASPECTS: { label: string; aspect: number }[] = [
  { label: "16:9 landscape", aspect: 16 / 9 },
  { label: "4:3", aspect: 4 / 3 },
  { label: "1:1 square", aspect: 1 },
  { label: "9:16 phone", aspect: 9 / 16 },
  { label: "21:9 ultrawide", aspect: 21 / 9 },
];
