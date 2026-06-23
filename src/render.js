import { toroidalOffset } from './physics.js';

const NUM_STARS = 200;
let stars = null;

function initStars() {
  stars = [];
  for (let i = 0; i < NUM_STARS; i++) {
    stars.push({
      angle:       Math.random() * Math.PI * 2,
      radiusNorm:  Math.sqrt(Math.random()),    // sqrt = uniform area distribution
      size:        0.4 + Math.random() * 1.3,
      brightness:  0.07 + Math.random() * 0.18,
      phase:       Math.random() * Math.PI * 2,
      twinkleRate: 0.08 + Math.random() * 0.32, // Hz — slow, varied twinkle
    });
  }
}

function drawStars(ctx, W, H) {
  if (!stars) initStars();

  const t    = performance.now() / 1000;
  const rot  = t * (Math.PI * 2 / 300);         // one full revolution per 5 min
  const cx   = W / 2;
  const cy   = H / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy) * 1.05;

  for (const s of stars) {
    const a  = s.angle + rot;
    const r  = s.radiusNorm * maxR;
    const sx = cx + Math.cos(a) * r;
    const sy = cy + Math.sin(a) * r;
    if (sx < -2 || sx > W + 2 || sy < -2 || sy > H + 2) continue;

    const twinkle = 0.6 + 0.4 * Math.sin(t * s.twinkleRate * Math.PI * 2 + s.phase);
    const alpha   = (s.brightness * twinkle).toFixed(2);

    ctx.beginPath();
    ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(210, 220, 235, ${alpha})`;
    ctx.fill();
  }
}

export function render(ctx, canvas, planets, moons, config) {
  const W = canvas.width;
  const H = canvas.height;
  const boundsX = config.boundsX ?? config.bounds;
  const boundsY = config.boundsY ?? config.bounds;

  const scale = H / boundsY;
  const wx = x => x * scale;
  const wy = y => y * scale;

  // Fade trails — slight blue-black tint for deep-space feel at equilibrium
  ctx.fillStyle = 'rgba(3, 6, 10, 0.13)';
  ctx.fillRect(0, 0, W, H);

  // Stars redrawn crisp each frame so they don't accumulate trails
  drawStars(ctx, W, H);

  // Gravity lines
  for (const moon of moons) {
    const mx = wx(moon.x);
    const my = wy(moon.y);

    for (const planet of planets) {
      const { dx, dy } = toroidalOffset(moon.x, moon.y, planet.x, planet.y, boundsX, boundsY);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const influence = planet.size * config.audibleRadiusMultiplier;
      if (dist >= influence) continue;

      const t     = dist / influence;
      const alpha = (1 - t) * 0.55;
      const hue   = (planet.scaleIndex / planet.scaleLength) * 300;

      ctx.strokeStyle = `hsla(${hue}, 70%, 65%, ${alpha})`;
      ctx.lineWidth   = alpha * 1.8 + 0.3;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + dx * scale, my + dy * scale);
      ctx.stroke();
    }
  }

  // Planets
  for (const planet of planets) {
    const hue   = (planet.scaleIndex / planet.scaleLength) * 300;
    const pr    = planet.size * scale;
    const px    = wx(planet.x);
    const py    = wy(planet.y);
    const glowR = pr * 2.8;

    // Net moon pull for glow elongation
    let netX = 0, netY = 0;
    for (const moon of moons) {
      const { dx, dy } = toroidalOffset(planet.x, planet.y, moon.x, moon.y, boundsX, boundsY);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.001) continue;
      const influence = planet.size * config.audibleRadiusMultiplier;
      if (d >= influence) continue;
      const t = Math.pow(1 - d / influence, 1.5);
      netX += (dx / d) * t;
      netY += (dy / d) * t;
    }

    // 1. Elliptical glow
    ctx.save();
    ctx.translate(px, py);
    const netMag = Math.sqrt(netX * netX + netY * netY);
    if (netMag > 0.001) {
      ctx.rotate(Math.atan2(netY, netX));
      ctx.scale(1 + Math.min(netMag * 0.12, 0.18), 1);
    }
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
    glow.addColorStop(0, `hsla(${hue}, 80%, 65%, 0.2)`);
    glow.addColorStop(1, `hsla(${hue}, 80%, 65%, 0)`);
    ctx.beginPath();
    ctx.arc(0, 0, glowR, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();

    // Ring helper — draws a dark flat annulus at origin in current transform
    const ringInner = pr * 1.18;
    const ringOuter = pr * 2.1;
    const drawRing = () => {
      const rg = ctx.createRadialGradient(0, 0, ringInner, 0, 0, ringOuter);
      rg.addColorStop(0,    'rgba(0, 0, 0, 0.92)');
      rg.addColorStop(0.55, 'rgba(0, 0, 0, 0.88)');
      rg.addColorStop(0.82, 'rgba(0, 0, 0, 0.5)');
      rg.addColorStop(1,    'rgba(0, 0, 0, 0)');
      ctx.beginPath();
      ctx.arc(0, 0, ringOuter, 0, Math.PI * 2, false);
      ctx.arc(0, 0, ringInner, 0, Math.PI * 2, true);
      ctx.fillStyle = rg;
      ctx.fill('evenodd');
    };

    // 2. Ring back half — clipped to upper screen, drawn before planet
    if (planet.hasRing) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, py);
      ctx.clip();
      ctx.translate(px, py);
      ctx.scale(1, 0.28);
      drawRing();
      ctx.restore();
    }

    // 3. Planet body
    const lit = ctx.createRadialGradient(
      px - pr * 0.3, py - pr * 0.3, pr * 0.01,
      px + pr * 0.1, py + pr * 0.1, pr
    );
    lit.addColorStop(0,    `hsl(${hue}, 68%, 55%)`);
    lit.addColorStop(0.4,  `hsl(${hue}, 76%, 56%)`);
    lit.addColorStop(1,    `hsl(${hue}, 70%, 32%)`);
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = lit;
    ctx.fill();

    // 4. Ring front half — clipped to lower screen, drawn over planet
    if (planet.hasRing) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, py, W, H - py);
      ctx.clip();
      ctx.translate(px, py);
      ctx.scale(1, 0.28);
      drawRing();
      ctx.restore();
    }
  }

  // Moons
  for (const moon of moons) {
    ctx.beginPath();
    ctx.arc(wx(moon.x), wy(moon.y), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#EEEEE8';
    ctx.fill();
  }
}

export function clearCanvas(ctx, canvas) {
  const W = canvas.width;
  const H = canvas.height;
  const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
  grad.addColorStop(0, '#070D14');
  grad.addColorStop(1, '#030608');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}
