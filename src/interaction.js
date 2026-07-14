// interaction.js
// The "app" layer: owns scene state, wires up the control panel, handles
// dragging on the canvas, and calls into optics.js / render.js to compute
// and draw each frame. Redraws happen on demand rather than on a continuous
// animation loop, since nothing here needs to animate over time.

const canvas = document.getElementById('bench');
const ctx = canvas.getContext('2d');

const SNAP_PX = 14;
const WHITE_LIGHT_SAMPLES = [420, 460, 500, 540, 580, 620, 660];

const scene = {
  width: 0,
  height: 0,
  axisY: 0,
  source: {
    position: { x: 90, y: 0 },
    mode: 'point',
    angle: 0,
    spread: 40,
    beamWidth: 140,
    rayCount: 11,
    wavelength: 632,
    whiteLight: false,
  },
  elements: [],
};

let selected = null; // { type: 'source' } | { type: 'element', ref } | { type: 'axis' }
let dragging = null;
let snapActive = false;

// ---------- small helpers ----------

function selectedOfKind(kind) {
  return selected && selected.type === 'element' && selected.ref.kind === kind ? selected.ref : null;
}

function bindPair(slider, number, onChange) {
  slider.addEventListener('input', () => {
    number.value = slider.value;
    onChange(Number(slider.value));
  });
  number.addEventListener('input', () => {
    let v = Number(number.value);
    if (slider.min !== '' && v < Number(slider.min)) v = Number(slider.min);
    if (slider.max !== '' && v > Number(slider.max)) v = Number(slider.max);
    slider.value = v;
    onChange(v);
  });
}

function setPair(slider, number, value) {
  slider.value = value;
  number.value = value;
}

// ---------- sizing ----------

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const firstRun = scene.width === 0;
  scene.width = rect.width;
  scene.height = rect.height;
  if (firstRun) {
    scene.axisY = rect.height / 2;
    scene.source.position.y = scene.axisY;
  }
  draw();
}
window.addEventListener('resize', resizeCanvas);

// ---------- ray generation ----------

function baseRays(source) {
  const rays = [];
  const aimRad = (source.angle * Math.PI) / 180;

  if (source.mode === 'point') {
    const spreadRad = (source.spread * Math.PI) / 180;
    const count = source.rayCount;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5;
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

// Expands each geometric ray into one or more (ray, wavelength) pairs.
function generateRays(source) {
  const geometric = baseRays(source);
  const wavelengths = source.whiteLight ? WHITE_LIGHT_SAMPLES : [source.wavelength];
  const out = [];
  for (const ray of geometric) {
    for (const wavelength of wavelengths) {
      out.push({ origin: ray.origin, dir: ray.dir, wavelength });
    }
  }
  return out;
}

// ---------- draw ----------

function draw() {
  Render.drawBreadboard(ctx, scene.width, scene.height);
  Render.drawOpticalAxis(ctx, scene.width, scene.axisY, dragging && snapActive);

  const rays = generateRays(scene.source);
  for (const ray of rays) {
    const points = Optics.traceRay(ray.origin, ray.dir, scene.elements, scene.width, scene.height, ray.wavelength);
    Render.drawRayPath(ctx, points, Optics.wavelengthToRGB(ray.wavelength));
  }

  for (const el of scene.elements) {
    const isSelected = selected && selected.type === 'element' && selected.ref === el;
    if (el.kind === 'lens') Render.drawLens(ctx, el, isSelected);
    else if (el.kind === 'mirror') Render.drawMirror(ctx, el, isSelected);
    else if (el.kind === 'prism') Render.drawPrism(ctx, el, isSelected);
  }

  Render.drawSource(ctx, scene.source, selected && selected.type === 'source');

  const lensSel = selectedOfKind('lens');
  if (lensSel) {
    const info = Optics.computeImageInfo(scene.source, lensSel);
    Render.drawImageMarker(ctx, scene.source, lensSel, info);
  }

  updateReadouts();
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

function elementHitTest(el, point) {
  if (el.kind === 'prism') {
    const { face1, face2 } = Optics.buildPrismFaces(el);
    return (
      distToSegment(point, face1.a, face1.b) < 10 ||
      distToSegment(point, face2.a, face2.b) < 10 ||
      distToSegment(point, face1.b, face2.b) < 10
    );
  }
  const { a, b } = Optics.elementEndpoints(el);
  return distToSegment(point, a, b) < 10;
}

function hitTest(point) {
  if (Optics.length(Optics.sub(point, scene.source.position)) < 12) return { type: 'source' };
  for (let i = scene.elements.length - 1; i >= 0; i--) {
    if (elementHitTest(scene.elements[i], point)) return { type: 'element', ref: scene.elements[i] };
  }
  if (Math.abs(point.y - scene.axisY) < 8) return { type: 'axis' };
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

  if (dragging.type === 'axis') {
    scene.axisY = p.y;
    snapActive = false;
  } else {
    snapActive = Math.abs(p.y - scene.axisY) < SNAP_PX;
    if (snapActive) p.y = scene.axisY;
    if (dragging.type === 'source') scene.source.position = p;
    else dragging.ref.center = p;
    if (selected && selected.type === 'element') {
      document.getElementById('el-x').value = Math.round(p.x);
      document.getElementById('el-y').value = Math.round(p.y);
    }
  }
  draw();
});

window.addEventListener('mouseup', () => { dragging = null; snapActive = false; draw(); });

// ---------- panel: source controls ----------

const sourceModeEl = document.getElementById('source-mode');
const spreadRow = document.getElementById('spread-row');
const widthRow = document.getElementById('width-row');
const wavelengthRow = document.getElementById('wavelength-row');
const whiteEl = document.getElementById('source-white');
const wavelengthSlider = document.getElementById('source-wavelength');
const wavelengthNum = document.getElementById('source-wavelength-num');

sourceModeEl.addEventListener('change', () => {
  scene.source.mode = sourceModeEl.value;
  spreadRow.hidden = scene.source.mode !== 'point';
  widthRow.hidden = scene.source.mode !== 'parallel';
  draw();
});

bindPair(document.getElementById('ray-count'), document.getElementById('ray-count-num'), (v) => { scene.source.rayCount = v; draw(); });
bindPair(document.getElementById('source-spread'), document.getElementById('source-spread-num'), (v) => { scene.source.spread = v; draw(); });
bindPair(document.getElementById('source-width'), document.getElementById('source-width-num'), (v) => { scene.source.beamWidth = v; draw(); });
bindPair(document.getElementById('source-angle'), document.getElementById('source-angle-num'), (v) => { scene.source.angle = v; draw(); });
bindPair(wavelengthSlider, wavelengthNum, (v) => { scene.source.wavelength = v; draw(); });

whiteEl.addEventListener('change', () => {
  scene.source.whiteLight = whiteEl.checked;
  wavelengthRow.classList.toggle('disabled', scene.source.whiteLight);
  wavelengthSlider.disabled = scene.source.whiteLight;
  wavelengthNum.disabled = scene.source.whiteLight;
  draw();
});

// ---------- panel: selected element — common ----------

const elementControls = document.getElementById('element-controls');
const elementTitle = document.getElementById('element-title');
const elX = document.getElementById('el-x');
const elY = document.getElementById('el-y');
const elReadout = document.getElementById('el-readout');
const imageAnalysis = document.getElementById('image-analysis');
const imageReadout = document.getElementById('image-readout');

const lensControlsDiv = document.getElementById('lens-controls');
const mirrorControlsDiv = document.getElementById('mirror-controls');
const prismControlsDiv = document.getElementById('prism-controls');

elX.addEventListener('input', () => { const el = selectedElement(); if (el) { el.center.x = Number(elX.value); draw(); } });
elY.addEventListener('input', () => { const el = selectedElement(); if (el) { el.center.y = Number(elY.value); draw(); } });

function selectedElement() {
  return selected && selected.type === 'element' ? selected.ref : null;
}

bindPair(document.getElementById('el-angle'), document.getElementById('el-angle-num'), (v) => {
  const el = selectedElement();
  if (!el) return;
  el.angle = (v * Math.PI) / 180;
  draw();
});

// ---------- panel: lens ----------

const lensModelEl = document.getElementById('el-lens-model');
const lensIdealDiv = document.getElementById('lens-ideal-controls');
const lensRealisticDiv = document.getElementById('lens-realistic-controls');
const lensTypeEl = document.getElementById('el-lens-type');
const focalSlider = document.getElementById('el-focal');
const focalNum = document.getElementById('el-focal-num');
const glassEl = document.getElementById('el-glass');
const customGlassDiv = document.getElementById('lens-custom-glass');
const customAEl = document.getElementById('el-custom-a');
const customBEl = document.getElementById('el-custom-b');
const r1Slider = document.getElementById('el-r1');
const r1Num = document.getElementById('el-r1-num');
const r2Slider = document.getElementById('el-r2');
const r2Num = document.getElementById('el-r2-num');
const thicknessSlider = document.getElementById('el-thickness');
const thicknessNum = document.getElementById('el-thickness-num');

lensModelEl.addEventListener('change', () => {
  const el = selectedOfKind('lens');
  if (!el) return;
  el.model = lensModelEl.value;
  lensIdealDiv.hidden = el.model !== 'ideal';
  lensRealisticDiv.hidden = el.model !== 'realistic';
  draw();
});

lensTypeEl.addEventListener('change', () => {
  const el = selectedOfKind('lens');
  if (!el) return;
  const magnitude = Math.abs(el.focalLength);
  el.focalLength = lensTypeEl.value === 'converging' ? magnitude : -magnitude;
  draw();
});

bindPair(focalSlider, focalNum, (v) => {
  const el = selectedOfKind('lens');
  if (!el) return;
  const sign = lensTypeEl.value === 'converging' ? 1 : -1;
  el.focalLength = sign * v;
  draw();
});

glassEl.addEventListener('change', () => {
  const el = selectedOfKind('lens');
  if (!el) return;
  el.glass = glassEl.value;
  customGlassDiv.hidden = el.glass !== 'custom';
  draw();
});
customAEl.addEventListener('input', () => { const el = selectedOfKind('lens'); if (el) { el.customA = Number(customAEl.value); draw(); } });
customBEl.addEventListener('input', () => { const el = selectedOfKind('lens'); if (el) { el.customB = Number(customBEl.value); draw(); } });

bindPair(r1Slider, r1Num, (v) => { const el = selectedOfKind('lens'); if (el) { el.r1 = v; draw(); } });
bindPair(r2Slider, r2Num, (v) => { const el = selectedOfKind('lens'); if (el) { el.r2 = v; draw(); } });
bindPair(thicknessSlider, thicknessNum, (v) => { const el = selectedOfKind('lens'); if (el) { el.thickness = v; draw(); } });

// ---------- panel: mirror ----------

const mirrorSurfaceEl = document.getElementById('el-mirror-surface');
const mirrorRadiusRow = document.getElementById('mirror-radius-row');
const mirrorRadiusSlider = document.getElementById('el-mirror-radius');
const mirrorRadiusNum = document.getElementById('el-mirror-radius-num');

mirrorSurfaceEl.addEventListener('change', () => {
  const el = selectedOfKind('mirror');
  if (!el) return;
  el.surface = mirrorSurfaceEl.value;
  mirrorRadiusRow.hidden = el.surface === 'flat';
  draw();
});
bindPair(mirrorRadiusSlider, mirrorRadiusNum, (v) => { const el = selectedOfKind('mirror'); if (el) { el.radius = v; draw(); } });

// ---------- panel: prism ----------

const prismApexSlider = document.getElementById('el-prism-apex');
const prismApexNum = document.getElementById('el-prism-apex-num');
const prismHeightSlider = document.getElementById('el-prism-height');
const prismHeightNum = document.getElementById('el-prism-height-num');
const prismGlassEl = document.getElementById('el-prism-glass');
const prismCustomGlassDiv = document.getElementById('prism-custom-glass');
const prismCustomAEl = document.getElementById('el-prism-custom-a');
const prismCustomBEl = document.getElementById('el-prism-custom-b');

bindPair(prismApexSlider, prismApexNum, (v) => { const el = selectedOfKind('prism'); if (el) { el.apexAngle = v; draw(); } });
bindPair(prismHeightSlider, prismHeightNum, (v) => { const el = selectedOfKind('prism'); if (el) { el.height = v; draw(); } });
prismGlassEl.addEventListener('change', () => {
  const el = selectedOfKind('prism');
  if (!el) return;
  el.glass = prismGlassEl.value;
  prismCustomGlassDiv.hidden = el.glass !== 'custom';
  draw();
});
prismCustomAEl.addEventListener('input', () => { const el = selectedOfKind('prism'); if (el) { el.customA = Number(prismCustomAEl.value); draw(); } });
prismCustomBEl.addEventListener('input', () => { const el = selectedOfKind('prism'); if (el) { el.customB = Number(prismCustomBEl.value); draw(); } });

// ---------- panel sync ----------

function syncPanelToSelection() {
  const isElement = selected && selected.type === 'element';
  elementControls.hidden = !isElement;
  if (!isElement) { imageAnalysis.hidden = true; return; }

  const el = selected.ref;
  elementTitle.textContent = el.kind[0].toUpperCase() + el.kind.slice(1) + ' \u2014 selected';
  elX.value = Math.round(el.center.x);
  elY.value = Math.round(el.center.y);
  setPair(document.getElementById('el-angle'), document.getElementById('el-angle-num'), Math.round((el.angle * 180) / Math.PI));

  lensControlsDiv.hidden = el.kind !== 'lens';
  mirrorControlsDiv.hidden = el.kind !== 'mirror';
  prismControlsDiv.hidden = el.kind !== 'prism';

  if (el.kind === 'lens') {
    lensModelEl.value = el.model;
    lensIdealDiv.hidden = el.model !== 'ideal';
    lensRealisticDiv.hidden = el.model !== 'realistic';
    lensTypeEl.value = el.focalLength >= 0 ? 'converging' : 'diverging';
    setPair(focalSlider, focalNum, Math.abs(el.focalLength));
    glassEl.value = el.glass;
    customGlassDiv.hidden = el.glass !== 'custom';
    customAEl.value = el.customA;
    customBEl.value = el.customB;
    setPair(r1Slider, r1Num, el.r1);
    setPair(r2Slider, r2Num, el.r2);
    setPair(thicknessSlider, thicknessNum, el.thickness);
  } else if (el.kind === 'mirror') {
    mirrorSurfaceEl.value = el.surface;
    mirrorRadiusRow.hidden = el.surface === 'flat';
    setPair(mirrorRadiusSlider, mirrorRadiusNum, el.radius);
  } else if (el.kind === 'prism') {
    setPair(prismApexSlider, prismApexNum, el.apexAngle);
    setPair(prismHeightSlider, prismHeightNum, el.height);
    prismGlassEl.value = el.glass;
    prismCustomGlassDiv.hidden = el.glass !== 'custom';
    prismCustomAEl.value = el.customA;
    prismCustomBEl.value = el.customB;
  }

  imageAnalysis.hidden = el.kind !== 'lens';
}

function formatImageInfo(info) {
  if (!info.valid) return info.reason;
  if (info.parallel) {
    return `Collimated input \u2192 focuses at the focal plane, f = ${Math.round(info.focalLength)}px (${info.real ? 'real' : 'virtual'}).`;
  }
  return [
    `object distance:  ${info.objectDistance.toFixed(0)}px`,
    `image distance:   ${info.imageDistance.toFixed(0)}px`,
    `magnification:    ${info.magnification.toFixed(2)}\u00D7`,
    `${info.real ? 'real image' : 'virtual image'}, ${info.inverted ? 'inverted' : 'upright'}`,
  ].join('\n');
}

function updateReadouts() {
  if (!selected || selected.type !== 'element') return;
  const el = selected.ref;

  if (el.kind === 'lens') {
    if (el.model === 'ideal') {
      const type = el.focalLength > 0 ? 'converging' : 'diverging';
      elReadout.textContent = `${type}, f = ${Math.round(el.focalLength)}px`;
    } else {
      const n = Optics.lensIndexAt(el, scene.source.wavelength);
      const f = Optics.effectiveFocalLength(el, scene.source.wavelength);
      elReadout.textContent = `n(${scene.source.wavelength}nm) = ${n.toFixed(4)}`;
      document.getElementById('lens-effective-f').textContent =
        `effective focal length \u2248 ${Math.round(f)}px (thin-lens estimate; the traced rays include real spherical aberration beyond this paraxial value)`;
    }
    const info = Optics.computeImageInfo(scene.source, el);
    imageReadout.textContent = formatImageInfo(info);
  } else if (el.kind === 'mirror') {
    elReadout.textContent = el.surface === 'flat'
      ? 'flat mirror'
      : `${el.surface} mirror, R = ${Math.round(el.radius)}px, f = ${Math.round(el.radius / 2)}px`;
  } else if (el.kind === 'prism') {
    const n = Optics.prismIndexAt(el, scene.source.wavelength);
    elReadout.textContent = `n(${scene.source.wavelength}nm) = ${n.toFixed(4)}, apex angle ${el.apexAngle}\u00B0`;
  }
}

// ---------- toolbar ----------

document.getElementById('add-lens').addEventListener('click', () => {
  const el = {
    kind: 'lens', model: 'ideal',
    center: { x: scene.width / 2, y: scene.axisY },
    angle: 0, height: 150,
    focalLength: 140,
    glass: 'crown', customA: 1.50, customB: 0.0042,
    r1: 150, r2: -150, thickness: 30,
  };
  scene.elements.push(el);
  selected = { type: 'element', ref: el };
  syncPanelToSelection();
  draw();
});

document.getElementById('add-mirror').addEventListener('click', () => {
  const el = {
    kind: 'mirror',
    center: { x: scene.width * 0.7, y: scene.axisY },
    angle: -Math.PI / 4, height: 150,
    surface: 'flat', radius: 240,
  };
  scene.elements.push(el);
  selected = { type: 'element', ref: el };
  syncPanelToSelection();
  draw();
});

document.getElementById('add-prism').addEventListener('click', () => {
  const el = {
    kind: 'prism',
    center: { x: scene.width * 0.55, y: scene.axisY },
    angle: 0, apexAngle: 60, height: 120,
    glass: 'crown', customA: 1.50, customB: 0.0042,
  };
  scene.elements.push(el);
  selected = { type: 'element', ref: el };
  syncPanelToSelection();
  draw();
});

document.getElementById('delete-selected').addEventListener('click', () => {
  const el = selectedElement();
  if (!el) return;
  scene.elements = scene.elements.filter((e) => e !== el);
  selected = null;
  syncPanelToSelection();
  draw();
});

// ---------- init ----------

resizeCanvas();
document.getElementById('add-lens').click();
scene.elements[0].center = { x: 380, y: scene.axisY };
draw();
