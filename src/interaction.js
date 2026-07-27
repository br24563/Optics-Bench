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
  pan: { x: 0, y: 0 },
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
  const aimRad = (source.angle * Math.PI) / 180;

  // White light reads cleanly as a single beam splitting into a spectrum —
  // tracing an entire fan x 7 wavelengths at once just produces an
  // overlapping muddle (and many of those rays miss the prism's aperture
  // at typical spread angles anyway), so ignore spread/width/count here.
  if (source.whiteLight) {
    return [{ origin: source.position, dir: Optics.fromAngle(aimRad) }];
  }

  const rays = [];
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
  Render.drawBreadboard(ctx, scene.width, scene.height, scene.pan.x, scene.pan.y);

  const viewMinX = -scene.pan.x;
  const viewMinY = -scene.pan.y;
  const viewport = { minX: viewMinX, minY: viewMinY, maxX: viewMinX + scene.width, maxY: viewMinY + scene.height };

  ctx.save();
  ctx.translate(scene.pan.x, scene.pan.y);

  Render.drawOpticalAxis(ctx, viewMinX, viewport.maxX, scene.axisY, dragging && dragging.type !== 'pan' && snapActive);

  const rays = generateRays(scene.source);
  for (const ray of rays) {
    const points = Optics.traceRay(ray.origin, ray.dir, scene.elements, viewport, ray.wavelength);
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

  ctx.restore();

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

function toWorld(screenPoint) {
  return { x: screenPoint.x - scene.pan.x, y: screenPoint.y - scene.pan.y };
}

// ---------- mouse events ----------

canvas.addEventListener('mousedown', (evt) => {
  const screenP = canvasPoint(evt);
  const worldP = toWorld(screenP);
  const hit = hitTest(worldP);

  if (hit) {
    selected = hit;
    dragging = hit;
  } else {
    // Empty space: pan the whole bench instead of selecting nothing.
    selected = null;
    dragging = { type: 'pan', startMouse: screenP, startPan: { x: scene.pan.x, y: scene.pan.y } };
    canvas.classList.add('panning');
  }
  canvas.focus();
  syncPanelToSelection();
  draw();
});

window.addEventListener('mousemove', (evt) => {
  if (!dragging) return;

  if (dragging.type === 'pan') {
    const screenP = canvasPoint(evt);
    scene.pan.x = dragging.startPan.x + (screenP.x - dragging.startMouse.x);
    scene.pan.y = dragging.startPan.y + (screenP.y - dragging.startMouse.y);
    draw();
    return;
  }

  const p = toWorld(canvasPoint(evt));

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

window.addEventListener('mouseup', () => {
  dragging = null;
  snapActive = false;
  canvas.classList.remove('panning');
  draw();
});

// ---------- keyboard: arrow-key nudge, delete, escape ----------
// Makes the bench usable without a mouse: Tab to focus the canvas, click
// (or Tab-cycle in the future) to select something, then arrow keys nudge
// it the same way a drag would. Hold Shift for a larger step.

const NUDGE_STEP = 5; // mm
const NUDGE_STEP_FAST = 20; // mm, with Shift held

canvas.addEventListener('keydown', (evt) => {
  if (evt.key === 'Escape') {
    selected = null;
    syncPanelToSelection();
    draw();
    return;
  }

  if (!selected) return;

  if (evt.key === 'Delete' || evt.key === 'Backspace') {
    if (selected.type === 'element') {
      evt.preventDefault();
      document.getElementById('delete-selected').click();
    }
    return;
  }

  let dx = 0, dy = 0;
  const step = evt.shiftKey ? NUDGE_STEP_FAST : NUDGE_STEP;
  if (evt.key === 'ArrowLeft') dx = -step;
  else if (evt.key === 'ArrowRight') dx = step;
  else if (evt.key === 'ArrowUp') dy = -step;
  else if (evt.key === 'ArrowDown') dy = step;
  else return;
  evt.preventDefault();

  if (selected.type === 'axis') {
    scene.axisY += dy;
  } else if (selected.type === 'source') {
    scene.source.position = { x: scene.source.position.x + dx, y: scene.source.position.y + dy };
  } else if (selected.type === 'element') {
    selected.ref.center = { x: selected.ref.center.x + dx, y: selected.ref.center.y + dy };
    elX.value = Math.round(selected.ref.center.x);
    elY.value = Math.round(selected.ref.center.y);
  }
  draw();
});

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

const rayCountRow = document.getElementById('ray-count-row');
const rayCountSlider = document.getElementById('ray-count');
const rayCountNum = document.getElementById('ray-count-num');
const sourceSpreadSlider = document.getElementById('source-spread');
const sourceSpreadNum = document.getElementById('source-spread-num');
const sourceWidthSlider = document.getElementById('source-width');
const sourceWidthNum = document.getElementById('source-width-num');

whiteEl.addEventListener('change', () => {
  scene.source.whiteLight = whiteEl.checked;
  const disable = scene.source.whiteLight;

  wavelengthRow.classList.toggle('disabled', disable);
  wavelengthSlider.disabled = disable;
  wavelengthNum.disabled = disable;

  // White light traces a single beam, so the fan/spread/width controls
  // have no effect while it's on — disable them rather than leave a
  // misleading control that silently does nothing.
  rayCountRow.classList.toggle('disabled', disable);
  rayCountSlider.disabled = disable;
  rayCountNum.disabled = disable;
  spreadRow.classList.toggle('disabled', disable);
  sourceSpreadSlider.disabled = disable;
  sourceSpreadNum.disabled = disable;
  widthRow.classList.toggle('disabled', disable);
  sourceWidthSlider.disabled = disable;
  sourceWidthNum.disabled = disable;

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
const lensHeightSlider = document.getElementById('el-lens-height');
const lensHeightNum = document.getElementById('el-lens-height-num');
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

bindPair(lensHeightSlider, lensHeightNum, (v) => {
  const el = selectedOfKind('lens');
  if (!el) return;
  el.height = v;
  draw();
});

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
    setPair(lensHeightSlider, lensHeightNum, el.height);
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

function formatImageInfo(info, spot) {
  if (!info.valid) return info.reason;
  const lines = [];
  if (info.parallel) {
    lines.push(`Collimated input \u2192 focuses at the focal plane, f = ${Math.round(info.focalLength)}mm (${info.real ? 'real' : 'virtual'}).`);
  } else {
    lines.push(`object distance:  ${info.objectDistance.toFixed(0)}mm`);
    lines.push(`image distance:   ${info.imageDistance.toFixed(0)}mm`);
    lines.push(`magnification:    ${info.magnification.toFixed(2)}\u00D7`);
    lines.push(`${info.real ? 'real image' : 'virtual image'}, ${info.inverted ? 'inverted' : 'upright'}`);
  }
  if (info.airyRadius != null) {
    lines.push(`diffraction limit:  Airy radius \u2248 ${(info.airyRadius * 1000).toFixed(2)}\u00B5m (1.22 \u03BB \u00D7 working f/#)`);
  }
  if (spot) {
    lines.push(
      `spherical aberration: RMS spot radius \u2248 ${(spot.rmsRadius * 1000).toFixed(2)}\u00B5m, ` +
      `peak \u2248 ${(spot.peakRadius * 1000).toFixed(2)}\u00B5m (${spot.sampleCount} rays across the aperture)`
    );
  }
  return lines.join('\n');
}

function updateReadouts() {
  if (!selected || selected.type !== 'element') return;
  const el = selected.ref;

  if (el.kind === 'lens') {
    if (el.model === 'ideal') {
      const type = el.focalLength > 0 ? 'converging' : 'diverging';
      elReadout.textContent = `${type}, f = ${Math.round(el.focalLength)}mm`;
    } else {
      const n = Optics.lensIndexAt(el, scene.source.wavelength);
      const f = Optics.effectiveFocalLength(el, scene.source.wavelength);
      elReadout.textContent = `n(${scene.source.wavelength}nm) = ${n.toFixed(4)}`;
      document.getElementById('lens-effective-f').textContent =
        `effective focal length \u2248 ${Math.round(f)}mm (thin-lens estimate; the traced rays include real spherical aberration beyond this paraxial value)`;
    }
    const info = Optics.computeImageInfo(scene.source, el);
    const spot = el.model === 'realistic' ? Optics.computeSpotDiagram(el, scene.source) : null;
    imageReadout.textContent = formatImageInfo(info, spot);
  } else if (el.kind === 'mirror') {
    elReadout.textContent = el.surface === 'flat'
      ? 'flat mirror'
      : `${el.surface} mirror, R = ${Math.round(el.radius)}mm, f = ${Math.round(el.radius / 2)}mm`;
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
    angle: 0, height: 90,
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
    angle: 0, apexAngle: 65, height: 120,
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

document.getElementById('reset-view').addEventListener('click', () => {
  scene.pan = { x: 0, y: 0 };
  draw();
});

// ---------- scene save/load (JSON) ----------
// Lets a configuration be shared or reproduced exactly -- save the source
// and every element as plain JSON, load it back into an identical scene.

const SCENE_FORMAT_VERSION = 1;

function serializeScene() {
  return {
    formatVersion: SCENE_FORMAT_VERSION,
    axisY: scene.axisY,
    source: scene.source,
    elements: scene.elements,
  };
}

function syncSourcePanelFromScene() {
  const src = scene.source;
  sourceModeEl.value = src.mode;
  spreadRow.hidden = src.mode !== 'point';
  widthRow.hidden = src.mode !== 'parallel';
  setPair(rayCountSlider, rayCountNum, src.rayCount);
  setPair(sourceSpreadSlider, sourceSpreadNum, src.spread);
  setPair(sourceWidthSlider, sourceWidthNum, src.beamWidth);
  setPair(document.getElementById('source-angle'), document.getElementById('source-angle-num'), src.angle);
  setPair(wavelengthSlider, wavelengthNum, src.wavelength);
  whiteEl.checked = src.whiteLight;
  whiteEl.dispatchEvent(new Event('change'));
}

function loadSceneData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.elements) || typeof data.source !== 'object') {
    throw new Error('That file doesn’t look like a saved optical-bench scene.');
  }
  scene.source = Object.assign({}, scene.source, data.source);
  scene.elements = data.elements;
  if (typeof data.axisY === 'number') scene.axisY = data.axisY;
  selected = null;
  syncSourcePanelFromScene();
  syncPanelToSelection();
  draw();
}

const sceneIoStatus = document.getElementById('scene-io-status');
function showSceneIoStatus(message, isError) {
  sceneIoStatus.hidden = false;
  sceneIoStatus.textContent = message;
  sceneIoStatus.style.color = isError ? 'var(--accent)' : 'var(--accent-2)';
}

document.getElementById('save-scene').addEventListener('click', () => {
  const json = JSON.stringify(serializeScene(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'optical-bench-scene.json';
  a.click();
  URL.revokeObjectURL(url);
  showSceneIoStatus('Scene saved.');
});

const loadSceneFileInput = document.getElementById('load-scene-file');
document.getElementById('load-scene').addEventListener('click', () => loadSceneFileInput.click());
loadSceneFileInput.addEventListener('change', () => {
  const file = loadSceneFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadSceneData(JSON.parse(reader.result));
      showSceneIoStatus(`Loaded "${file.name}".`);
    } catch (err) {
      showSceneIoStatus(err.message || 'Could not load that file.', true);
    }
  };
  reader.readAsText(file);
  loadSceneFileInput.value = '';
});

// ---------- init ----------

resizeCanvas();
document.getElementById('add-lens').click();
scene.elements[0].center = { x: 380, y: scene.axisY };
draw();
