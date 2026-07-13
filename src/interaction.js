// interaction.js
// The "app" layer: owns the scene state, wires up the control panel, handles
// dragging on the canvas, and calls into optics.js / render.js to compute
// and draw each frame. Redraws happen on demand (after a drag, a slider
// change, etc.) rather than on a continuous animation loop, since nothing
// here needs to animate over time.

const canvas = document.getElementById('bench');
const ctx = canvas.getContext('2d');

const scene = {
  width: 0,
  height: 0,
  source: {
    position: { x: 90, y: 260 },
    mode: 'point',       // 'point' | 'parallel'
    angle: 0,            // degrees, aim direction
    spread: 40,           // degrees, fan width (point mode)
    beamWidth: 140,       // px, aperture (parallel mode)
    rayCount: 11,
  },
  elements: [],
};

let selected = null; // { type: 'source' } | { type: 'element', ref: element }
let dragging = null; // same shape as `selected`, or null

// ---------- sizing ----------

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scene.width = rect.width;
  scene.height = rect.height;
  draw();
}
window.addEventListener('resize', resizeCanvas);

// ---------- ray generation ----------

function generateRays(source) {
  const rays = [];
  const aimRad = (source.angle * Math.PI) / 180;

  if (source.mode === 'point') {
    const spreadRad = (source.spread * Math.PI) / 180;
    const count = source.rayCount;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5; // -0.5..0.5
      const angle = aimRad + t * spreadRad;
      rays.push({ origin: source.position, dir: Optics.fromAngle(angle) });
    }
  } else {
    const dir = Optics.fromAngle(aimRad);
    const perp = { x: -dir.y, y: dir.x };
    const count = source.rayCount;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5;
      const offset = t * source.beamWidth;
      const origin = Optics.add(source.position, Optics.scale(perp, offset));
      rays.push({ origin, dir });
    }
  }
  return rays;
}

// ---------- draw ----------

function draw() {
  Render.drawBreadboard(ctx, scene.width, scene.height);

  const rays = generateRays(scene.source);
  for (const ray of rays) {
    const points = Optics.traceRay(ray.origin, ray.dir, scene.elements, scene.width, scene.height);
    Render.drawRayPath(ctx, points);
  }

  for (const el of scene.elements) {
    const isSelected = selected && selected.type === 'element' && selected.ref === el;
    if (el.kind === 'lens') Render.drawLens(ctx, el, isSelected);
    else Render.drawMirror(ctx, el, isSelected);
  }

  Render.drawSource(ctx, scene.source, selected && selected.type === 'source');
}

// ---------- hit testing ----------

function distToSegment(p, a, b) {
  const ab = Optics.sub(b, a);
  const ap = Optics.sub(p, a);
  const len2 = Optics.dot(ab, ab) || 1e-9;
  let t = Optics.dot(ap, ab) / len2;
  t = Math.max(0, Math.min(1, t));
  const closest = Optics.add(a, Optics.scale(ab, t));
  return Optics.length(Optics.sub(p, closest));
}

function hitTest(point) {
  if (Optics.length(Optics.sub(point, scene.source.position)) < 12) {
    return { type: 'source' };
  }
  for (let i = scene.elements.length - 1; i >= 0; i--) {
    const el = scene.elements[i];
    const { a, b } = Optics.elementEndpoints(el);
    if (distToSegment(point, a, b) < 10) {
      return { type: 'element', ref: el };
    }
  }
  return null;
}

function canvasPoint(evt) {
  const rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

// ---------- mouse events ----------

canvas.addEventListener('mousedown', (evt) => {
  const p = canvasPoint(evt);
  const hit = hitTest(p);
  selected = hit;
  dragging = hit;
  syncPanelToSelection();
  draw();
});

window.addEventListener('mousemove', (evt) => {
  if (!dragging) return;
  const p = canvasPoint(evt);
  if (dragging.type === 'source') {
    scene.source.position = p;
  } else {
    dragging.ref.center = p;
  }
  draw();
});

window.addEventListener('mouseup', () => { dragging = null; });

// ---------- panel: source controls ----------

const sourceModeEl = document.getElementById('source-mode');
const rayCountEl = document.getElementById('ray-count');
const spreadRow = document.getElementById('spread-row');
const spreadEl = document.getElementById('source-spread');
const widthRow = document.getElementById('width-row');
const widthEl = document.getElementById('source-width');
const aimEl = document.getElementById('source-angle');
const rayCountVal = document.getElementById('ray-count-val');

sourceModeEl.addEventListener('change', () => {
  scene.source.mode = sourceModeEl.value;
  spreadRow.hidden = scene.source.mode !== 'point';
  widthRow.hidden = scene.source.mode !== 'parallel';
  draw();
});
rayCountEl.addEventListener('input', () => {
  scene.source.rayCount = Number(rayCountEl.value);
  rayCountVal.textContent = `(${rayCountEl.value})`;
  draw();
});
spreadEl.addEventListener('input', () => { scene.source.spread = Number(spreadEl.value); draw(); });
widthEl.addEventListener('input', () => { scene.source.beamWidth = Number(widthEl.value); draw(); });
aimEl.addEventListener('input', () => { scene.source.angle = Number(aimEl.value); draw(); });

// ---------- panel: selected element controls ----------

const elementControls = document.getElementById('element-controls');
const elementTitle = document.getElementById('element-title');
const angleEl = document.getElementById('el-angle');
const focalRow = document.getElementById('focal-row');
const focalEl = document.getElementById('el-focal');
const readoutEl = document.getElementById('el-readout');

function syncPanelToSelection() {
  const isElement = selected && selected.type === 'element';
  elementControls.hidden = !isElement;
  if (!isElement) return;

  const el = selected.ref;
  elementTitle.textContent = el.kind === 'lens' ? 'Selected lens' : 'Selected mirror';
  angleEl.value = Math.round((el.angle * 180) / Math.PI);
  focalRow.hidden = el.kind !== 'lens';
  if (el.kind === 'lens') focalEl.value = el.focalLength;
  updateReadout(el);
}

function updateReadout(el) {
  if (el.kind === 'lens') {
    const type = el.focalLength > 0 ? 'converging (convex)' : 'diverging (concave)';
    readoutEl.textContent = `${type}, f = ${el.focalLength}px`;
  } else {
    const deg = Math.round((el.angle * 180) / Math.PI);
    readoutEl.textContent = `flat mirror, angle = ${deg}\u00B0`;
  }
}

angleEl.addEventListener('input', () => {
  if (!selected || selected.type !== 'element') return;
  selected.ref.angle = (Number(angleEl.value) * Math.PI) / 180;
  updateReadout(selected.ref);
  draw();
});
focalEl.addEventListener('input', () => {
  if (!selected || selected.type !== 'element' || selected.ref.kind !== 'lens') return;
  let f = Number(focalEl.value);
  if (Math.abs(f) < 20) f = f < 0 ? -20 : 20; // avoid a degenerate zero-focal-length lens
  selected.ref.focalLength = f;
  focalEl.value = f;
  updateReadout(selected.ref);
  draw();
});

// Note: angle is stored in RADIANS on the element (optics.js works in
// radians), but the slider works in degrees for a human-friendly UI.
// elementEndpoints/refractThinLens read `el.angle` directly, so keep the
// conversion here at the panel boundary.

// ---------- toolbar ----------

document.getElementById('add-lens').addEventListener('click', () => {
  const el = {
    kind: 'lens',
    center: { x: scene.width / 2, y: scene.height / 2 },
    angle: 0,
    height: 150,
    focalLength: 140,
  };
  scene.elements.push(el);
  selected = { type: 'element', ref: el };
  syncPanelToSelection();
  draw();
});

document.getElementById('add-mirror').addEventListener('click', () => {
  const el = {
    kind: 'mirror',
    center: { x: scene.width * 0.7, y: scene.height / 2 },
    angle: -Math.PI / 4,
    height: 150,
  };
  scene.elements.push(el);
  selected = { type: 'element', ref: el };
  syncPanelToSelection();
  draw();
});

document.getElementById('delete-selected').addEventListener('click', () => {
  if (!selected || selected.type !== 'element') return;
  scene.elements = scene.elements.filter((el) => el !== selected.ref);
  selected = null;
  syncPanelToSelection();
  draw();
});

// ---------- init ----------

resizeCanvas();
// Seed the scene with one lens so the bench isn't empty on first load.
document.getElementById('add-lens').click();
scene.elements[0].center = { x: 380, y: 260 };
scene.source.rayCount = 11;
rayCountEl.value = 11;
rayCountVal.textContent = '(11)';
draw();
