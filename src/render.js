// render.js
// Everything that touches the canvas 2D context lives here. optics.js knows
// nothing about pixels; this file knows nothing about ray-tracing math beyond
// the points it's handed.

const COLORS = {
  bg: '#0b0f14',
  grid: '#1b2733',
  gridDot: '#26364a',
  ray: '#ff3b4e',
  rayGlow: 'rgba(255, 59, 78, 0.35)',
  lens: '#8ecbff',
  mirror: '#e7ecf2',
  mirrorBack: '#0b0f14',
  source: '#ffd23f',
  selected: '#39ff88',
  axis: 'rgba(142, 203, 255, 0.25)',
};

const GRID_SPACING = 28;

function drawBreadboard(ctx, width, height) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.fillStyle = COLORS.gridDot;
  for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
    for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRayPath(ctx, points) {
  if (points.length < 2) return;

  // Soft glow pass underneath, then a crisp core line on top. Two strokes
  // instead of shadowBlur every frame keeps this cheap to redraw.
  ctx.strokeStyle = COLORS.rayGlow;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  ctx.strokeStyle = COLORS.ray;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

function drawLens(ctx, lens, isSelected) {
  const { a, b } = Optics.elementEndpoints(lens);
  const converging = lens.focalLength > 0;
  const axis = Optics.fromAngle(lens.angle);
  // Bulge direction: outward on both sides for a symmetric bi-convex/bi-concave look.
  const bulge = converging ? 10 : -8;

  ctx.strokeStyle = isSelected ? COLORS.selected : COLORS.lens;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(
    lens.center.x + axis.x * bulge, lens.center.y + axis.y * bulge,
    b.x, b.y
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(
    lens.center.x - axis.x * bulge, lens.center.y - axis.y * bulge,
    b.x, b.y
  );
  ctx.stroke();

  // Local optical axis, drawn faint, so you can see what "angle" means for this element.
  drawAxisLine(ctx, lens);
  drawFocalTicks(ctx, lens);

  drawLabel(ctx, lens.center, axis, `f = ${lens.focalLength > 0 ? '+' : ''}${lens.focalLength}px`);
}

function drawFocalTicks(ctx, lens) {
  const axis = Optics.fromAngle(lens.angle);
  const f = Math.abs(lens.focalLength);
  for (const sign of [1, -1]) {
    const p = Optics.add(lens.center, Optics.scale(axis, sign * f));
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 5, p.y - 5);
    ctx.lineTo(p.x + 5, p.y + 5);
    ctx.moveTo(p.x - 5, p.y + 5);
    ctx.lineTo(p.x + 5, p.y - 5);
    ctx.stroke();
  }
}

function drawMirror(ctx, mirror, isSelected) {
  const { a, b } = Optics.elementEndpoints(mirror);
  const axis = Optics.fromAngle(mirror.angle);

  // Backing (the "silvered" non-reflective side) drawn as a short hatch.
  ctx.strokeStyle = COLORS.mirrorBack;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(a.x - axis.x * 3, a.y - axis.y * 3);
  ctx.lineTo(b.x - axis.x * 3, b.y - axis.y * 3);
  ctx.stroke();

  ctx.strokeStyle = isSelected ? COLORS.selected : COLORS.mirror;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  drawAxisLine(ctx, mirror);
  drawLabel(ctx, mirror.center, axis, 'mirror');
}

function drawAxisLine(ctx, el) {
  const axis = Optics.fromAngle(el.angle);
  const p1 = Optics.add(el.center, Optics.scale(axis, -40));
  const p2 = Optics.add(el.center, Optics.scale(axis, 40));
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawLabel(ctx, center, axis, text) {
  const offset = { x: -axis.y, y: axis.x };
  const p = Optics.add(center, Optics.scale(offset, 26));
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(230, 238, 246, 0.7)';
  ctx.textAlign = 'center';
  ctx.fillText(text, p.x, p.y);
}

function drawSource(ctx, source, isSelected) {
  ctx.fillStyle = isSelected ? COLORS.selected : COLORS.source;
  ctx.beginPath();
  ctx.arc(source.position.x, source.position.y, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 210, 63, 0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(source.position.x, source.position.y, 12, 0, Math.PI * 2);
  ctx.stroke();

  drawLabel(ctx, source.position, Optics.fromAngle(source.angle), source.mode);
}

window.Render = {
  COLORS,
  drawBreadboard,
  drawRayPath,
  drawLens,
  drawMirror,
  drawSource,
};
