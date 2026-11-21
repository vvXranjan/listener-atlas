import React, { useEffect, useRef } from 'react';
import { getQuality } from './perf.js';

// Deep-space background behind the globe:
// stars of different size and colour, a faint Milky Way band, gentle twinkling,
// the odd shooting star, and slow drift as you spin the globe (parallax).

const STAR_COUNT = 1400;
const BAND_COUNT = 1800; // extra faint stars that form the Milky Way
const SKY = 2.2; // sky is wider than the screen so it can scroll with the globe

function makeStars(w, h) {
  const rand = mulberry32(42);
  const stars = [];
  const tint = () => {
    const r = rand();
    if (r < 0.1) return [170, 200, 255]; // blue-white
    if (r < 0.22) return [140, 255, 190]; // Spotify green
    if (r < 0.28) return [255, 220, 180]; // warm
    return [255, 255, 255];
  };
  for (let i = 0; i < STAR_COUNT; i++) {
    const big = rand() < 0.04;
    stars.push({
      x: rand() * w * SKY,
      y: rand() * h * SKY,
      r: big ? 1.2 + rand() * 1.4 : 0.35 + rand() * 0.8,
      a: big ? 0.8 + rand() * 0.2 : 0.25 + rand() * 0.6,
      c: tint(),
      fill: null,
      tw: rand() < 0.35 ? 0.6 + rand() * 2.2 : 0, // twinkle speed (0 = steady)
      ph: rand() * Math.PI * 2,
      depth: 0.5 + rand() * 0.5, // parallax depth
    });
  }
  // Milky Way: dense faint stars along a tilted band
  for (let i = 0; i < BAND_COUNT; i++) {
    const t = rand();
    const spread = (rand() + rand() + rand() - 1.5) * 0.11; // roughly gaussian
    stars.push({
      x: t * w * SKY,
      y: (0.25 + t * 0.5 + spread) * h * SKY,
      r: 0.25 + rand() * 0.5,
      a: 0.15 + rand() * 0.35,
      c: rand() < 0.3 ? [200, 210, 255] : [255, 255, 255],
      tw: 0,
      ph: 0,
      depth: 0.35,
    });
  }
  for (const s of stars) s.fill = `rgb(${s.c[0]},${s.c[1]},${s.c[2]})`; // made once, not every frame
  return stars;
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function Starfield({ mapRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let stars = [];
    let nebula = null;
    let raf = 0;
    let last = 0;
    let shooting = null;
    let nextShoot = performance.now() + 4000;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5); // tiny dots don't need full Retina
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = makeStars(w, h);
      nebula = makeNebula(w * SKY, h * SKY);
    }

    function makeNebula(sw, sh) {
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(sw / 4));
      off.height = Math.max(1, Math.round(sh / 4));
      const g = off.getContext('2d');
      const blob = (x, y, r, color) => {
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, off.width, off.height);
      };
      const W = off.width;
      const H = off.height;
      // soft glow along the Milky Way + a few coloured clouds
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        blob(t * W, (0.25 + t * 0.5) * H, H * 0.16, 'rgba(60,200,140,0.06)');
      }
      blob(W * 0.3, H * 0.45, H * 0.22, 'rgba(30,215,96,0.05)');
      blob(W * 0.7, H * 0.62, H * 0.2, 'rgba(40,150,200,0.06)');
      blob(W * 0.5, H * 0.5, H * 0.12, 'rgba(255,200,150,0.04)');
      return off;
    }

    let lastKey = '';
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const smooth = getQuality() === 'smooth';
      if (now - last < (smooth ? 66 : 40)) return; // 15 fps in smooth mode, 25 otherwise
      last = now;
      const m = mapRef.current;
      // zoomed in, the globe covers the sky: draw one last faint frame, then rest
      const zNow = m ? m.getZoom() : 0;
      if (zNow > 4.2) {
        const key = `rest|${Math.round(zNow)}`;
        if (key === lastKey) return;
        lastKey = key;
      } else lastKey = '';

      const map = mapRef.current;
      let ox = 0;
      let oy = 0;
      let bearing = 0;
      let fade = 1;
      if (map) {
        const c = map.getCenter();
        const z = map.getZoom();
        ox = (c.lng / 360) * w * 1.2; // spin the globe -> stars drift
        oy = (c.lat / 180) * h * 0.6;
        bearing = (map.getBearing() * Math.PI) / 180;
        // full stars in space, softer when you're close to the ground
        fade = z < 3 ? 1 : Math.max(0.35, 1 - (z - 3) * 0.15);
      }

      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-bearing);
      ctx.translate(-w / 2, -h / 2);

      const sw = w * SKY;
      const sh = h * SKY;
      const baseX = -((ox % sw) + sw) % sw;
      const baseY = -(h * (SKY - 1)) / 2 - oy;

      // nebula / Milky Way glow (drawn twice so it wraps)
      ctx.globalAlpha = fade;
      for (const dx of [0, sw]) ctx.drawImage(nebula, baseX * 0.35 + dx - sw * 0.2, baseY, sw, sh);

      const t = now / 1000;
      const step = smooth ? 3 : 1; // smooth mode draws a third of the stars
      for (let si = 0; si < stars.length; si += step) {
        const s = stars[si];
        let x = (s.x + baseX * s.depth) % sw;
        if (x < 0) x += sw;
        x -= w * 0.1;
        const y = s.y + baseY * s.depth;
        if (x < -4 || x > w + 4 || y < -4 || y > h + 4) continue;
        let a = s.a;
        if (s.tw && !reduced) a *= 0.65 + 0.35 * Math.sin(t * s.tw + s.ph);
        ctx.globalAlpha = a * fade;
        ctx.fillStyle = s.fill;
        if (s.r > 1.1) {
          // bright star with a little glow
          ctx.beginPath();
          ctx.arc(x, y, s.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = a * fade * 0.18;
          ctx.beginPath();
          ctx.arc(x, y, s.r * 3.2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, s.r * 2, s.r * 2);
        }
      }
      ctx.restore();

      // shooting star now and then
      if (!reduced && !smooth) {
        if (!shooting && now > nextShoot) {
          shooting = {
            x: Math.random() * w * 0.8,
            y: Math.random() * h * 0.4,
            vx: 9 + Math.random() * 6,
            vy: 3 + Math.random() * 3,
            life: 0,
          };
          nextShoot = now + 7000 + Math.random() * 9000;
        }
        if (shooting) {
          const s = shooting;
          s.x += s.vx;
          s.y += s.vy;
          s.life += 1;
          const alpha = Math.max(0, 1 - s.life / 28) * fade;
          const grad = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 9, s.y - s.vy * 9);
          grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.globalAlpha = 1;
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x - s.vx * 9, s.y - s.vy * 9);
          ctx.stroke();
          if (s.life > 28) shooting = null;
        }
      }
      ctx.globalAlpha = 1;
    }

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [mapRef]);

  return <canvas ref={canvasRef} className="starfield" />;
}
