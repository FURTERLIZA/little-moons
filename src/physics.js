export function toroidalDistance(ax, ay, bx, by, boundsX, boundsY = boundsX) {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  if (dx > boundsX / 2) dx = boundsX - dx;
  if (dy > boundsY / 2) dy = boundsY - dy;
  return Math.sqrt(dx * dx + dy * dy);
}

export function toroidalOffset(ax, ay, bx, by, boundsX, boundsY = boundsX) {
  let dx = bx - ax;
  let dy = by - ay;
  if (dx > boundsX / 2)  dx -= boundsX;
  if (dx < -boundsX / 2) dx += boundsX;
  if (dy > boundsY / 2)  dy -= boundsY;
  if (dy < -boundsY / 2) dy += boundsY;
  return { dx, dy };
}

export function tickPlanets(planets, config) {
  const { gravityConstant, bounds } = config;
  const boundsX  = config.boundsX ?? bounds;
  const boundsY  = config.boundsY ?? bounds;
  const MIN_DISTANCE = 1.0;
  const maxSpeed = config.maxPlanetSpeed ?? 0.35;
  const damping  = config.planetDamping  ?? 0.984;
  const dt       = 1 / config.tickRateHz;

  for (let i = 0; i < planets.length; i++) {
    const a = planets[i];
    let fx = 0, fy = 0;

    for (let j = 0; j < planets.length; j++) {
      if (i === j) continue;
      const b = planets[j];
      const { dx, dy } = toroidalOffset(a.x, a.y, b.x, b.y, boundsX, boundsY);
      let d = Math.sqrt(dx * dx + dy * dy);
      d = Math.max(d, MIN_DISTANCE);
      const push = gravityConstant * b.mass / (d * d);
      fx -= push * dx / d;
      fy -= push * dy / d;
    }

    a.vx += fx * dt;
    a.vy += fy * dt;

    const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
    if (speed > maxSpeed) {
      a.vx = a.vx / speed * maxSpeed;
      a.vy = a.vy / speed * maxSpeed;
    }

    a.vx *= damping;
    a.vy *= damping;

    a.x += a.vx * dt;
    a.y += a.vy * dt;

    a.x = ((a.x % boundsX) + boundsX) % boundsX;
    a.y = ((a.y % boundsY) + boundsY) % boundsY;
  }
}

export function tickPhysics(moons, planets, config) {
  const { gravityConstant, maxMoonSpeed, damping, bounds, audibleRadiusMultiplier } = config;
  const boundsX = config.boundsX ?? bounds;
  const boundsY = config.boundsY ?? bounds;
  const dt = 1 / config.tickRateHz;

  for (const moon of moons) {
    let fx = 0, fy = 0;
    let nearPlanet = false;

    for (const planet of planets) {
      const { dx, dy } = toroidalOffset(moon.x, moon.y, planet.x, planet.y, boundsX, boundsY);
      const d2 = dx * dx + dy * dy;

      if (Math.sqrt(d2) < planet.size * audibleRadiusMultiplier) nearPlanet = true;

      const soft = planet.size * 0.7;
      const s    = d2 + soft * soft;
      const pull = gravityConstant * planet.mass / (s * Math.sqrt(s));
      fx += pull * dx;
      fy += pull * dy;
    }

    moon.vx += fx * dt;
    moon.vy += fy * dt;

    const speed = Math.sqrt(moon.vx * moon.vx + moon.vy * moon.vy);
    if (speed > maxMoonSpeed) {
      moon.vx = moon.vx / speed * maxMoonSpeed;
      moon.vy = moon.vy / speed * maxMoonSpeed;
    }

    if (!nearPlanet) {
      moon.vx *= damping;
      moon.vy *= damping;
    }

    moon.x += moon.vx * dt;
    moon.y += moon.vy * dt;

    moon.x = ((moon.x % boundsX) + boundsX) % boundsX;
    moon.y = ((moon.y % boundsY) + boundsY) % boundsY;
  }
}
