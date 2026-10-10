/**
 * Robust 2D Convex Hull computation (Andrew's Monotone Chain Algorithm)
 * Converts any arbitrary collection of points into an ordered convex polygon boundary.
 */
export function computeConvexHull(points) {
  if (!points || points.length <= 3) return points ? [...points] : [];

  // Deduplicate points within 0.1px
  const unique = [];
  const seen = new Set();
  for (const p of points) {
    const k = `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`;
    if (!seen.has(k)) {
      seen.add(k);
      unique.push({ x: p.x, y: p.y });
    }
  }
  if (unique.length <= 3) return unique;

  unique.sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);

  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  // Lower hull
  const lower = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Upper hull
  const upper = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export class SubLabManager {
  constructor(partitionEngine, camera, patternRegistry) {
    this.partitionEngine = partitionEngine;
    this.camera = camera;
    this.patternRegistry = patternRegistry;

    this.activePartitionId = 'B2';
    this.activeTemplate = '3x3';
    this.isGreenSubLabActive = false; // Sub-Lab isolation mode OFF by default (clean blank canvas)
    this.constrainToLab = false;      // When true, drawing is constrained strictly inside the active lab polygon
    this.customLabCounter = 0;
    this.hoveredDropPartition = null; // Currently hovered shape during library drag & drop
    this.onSelectionChanged = null;

    if (this.camera && this.camera.workAreaEnabled) {
      this.initNineSquareBlocks();
    } else {
      this.partitionEngine.partitions = [];
    }
    this.initUI();
  }

  createLabFromStitches(stitchKeys, stitchesMap, latticeGrid) {
    if (!stitchKeys || stitchKeys.size === 0 || !stitchesMap || !latticeGrid) return null;

    const allPoints = [];
    for (const key of stitchKeys) {
      const edge = stitchesMap.get(key);
      if (!edge) continue;
      const p1 = latticeGrid.nodeToWorld(edge.u[0], edge.u[1]);
      const p2 = latticeGrid.nodeToWorld(edge.v[0], edge.v[1]);
      allPoints.push(p1);
      allPoints.push(p2);
    }

    if (allPoints.length === 0) return null;

    let hullPoints = null;
    if (allPoints.length >= 3) {
      hullPoints = computeConvexHull(allPoints);
    }

    if (!hullPoints || hullPoints.length < 3) {
      // If 1 or 2 stitches, construct a neat padded bounding box
      const pad = (latticeGrid.getStepPx && latticeGrid.getStepPx()) || 16;
      let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
      for (const p of allPoints) {
        if (p.x < pMinX) pMinX = p.x;
        if (p.x > pMaxX) pMaxX = p.x;
        if (p.y < pMinY) pMinY = p.y;
        if (p.y > pMaxY) pMaxY = p.y;
      }
      hullPoints = [
        { x: pMinX - pad, y: pMinY - pad },
        { x: pMaxX + pad, y: pMinY - pad },
        { x: pMaxX + pad, y: pMaxY + pad },
        { x: pMinX - pad, y: pMaxY + pad }
      ];
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of hullPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const dpi = (this.camera && (this.camera.dpi || this.camera.ppi)) || 96;
    const wInches = ((maxX - minX) / dpi).toFixed(1);
    const hInches = ((maxY - minY) / dpi).toFixed(1);

    this.customLabCounter = (this.customLabCounter || 0) + 1;
    const labId = `Custom-Lab-${this.customLabCounter}`;
    const name = `Work Area ${this.customLabCounter} (${wInches}" × ${hInches}")`;
    const label = `LAB ${this.customLabCounter}`;

    const customPartition = {
      id: labId,
      name,
      label,
      type: 'custom',
      isCustom: true,
      rotation: 0,
      fabricColor: null,
      points: hullPoints,
      bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
    };

    this.partitionEngine.partitions.push(customPartition);
    this.activePartitionId = labId;
    this.isGreenSubLabActive = true;
    this.constrainToLab = true;

    // Update Green Sub-Lab toggle button in UI if exists
    const btnToggleGreen = document.getElementById('btn-toggle-green-sublab');
    if (btnToggleGreen) {
      btnToggleGreen.classList.add('active');
      btnToggleGreen.textContent = '● Sub-Lab Focus: ON';
    }

    this.renderPartitionListUI();
    if (this.camera) this.camera.requestRender();

    return customPartition;
  }

  deleteCustomLab(id) {
    this.partitionEngine.partitions = this.partitionEngine.partitions.filter(p => p.id !== id);
    if (this.activePartitionId === id) {
      this.activePartitionId = this.partitionEngine.partitions[0]?.id || null;
    }
    this.renderPartitionListUI();
    if (this.camera) this.camera.requestRender();
  }

  toggleConstraint(forcedState = null) {
    if (forcedState !== null) {
      this.constrainToLab = forcedState;
    } else {
      this.constrainToLab = !this.constrainToLab;
    }
    this.renderPartitionListUI();
    if (this.camera) this.camera.requestRender();
    return this.constrainToLab;
  }

  get partitions() {
    return this.partitionEngine.partitions;
  }

  applyTemplate(templateKey) {
    this.activeTemplate = templateKey;
    switch (templateKey) {
      case '4x4':
        this.initFourByFourBlocks();
        break;
      case '2x2':
        this.initTwoByTwoBlocks();
        break;
      case '3-band':
        this.initThreeBandBlocks();
        break;
      case 'l-frame':
        this.initLFrameBlocks();
        break;
      case 'diamond':
        this.initDiamondBlocks();
        break;
      case '3x3':
      default:
        this.initNineSquareBlocks();
        break;
    }
    this.renderPartitionListUI();
    this.camera.requestRender();
  }

  initNineSquareBlocks() {
    const artboardW = (this.camera && this.camera.artboardWidthPx) || (this.camera && this.camera.cushionPx) || 1587.4;
    const artboardH = (this.camera && this.camera.artboardHeightPx) || (this.camera && this.camera.cushionPx) || 2245.0;
    const blockW = artboardW / 3;
    const blockH = artboardH / 3;

    const blockDefs = [
      { id: 'A1', label: 'A1', name: 'A1 (Top-Left)', r: 0, c: 0 },
      { id: 'A2', label: 'A2', name: 'A2 (Top-Center)', r: 0, c: 1 },
      { id: 'A3', label: 'A3', name: 'A3 (Top-Right)', r: 0, c: 2 },
      { id: 'B1', label: 'B1', name: 'B1 (Mid-Left)', r: 1, c: 0 },
      { id: 'B2', label: 'B2', name: 'B2 (Center Medallion)', r: 1, c: 1 },
      { id: 'B3', label: 'B3', name: 'B3 (Mid-Right)', r: 1, c: 2 },
      { id: 'C1', label: 'C1', name: 'C1 (Bottom-Left)', r: 2, c: 0 },
      { id: 'C2', label: 'C2', name: 'C2 (Bottom-Center)', r: 2, c: 1 },
      { id: 'C3', label: 'C3', name: 'C3 (Bottom-Right)', r: 2, c: 2 }
    ];

    this.partitionEngine.partitions = blockDefs.map(b => {
      const x0 = b.c * blockW;
      const y0 = b.r * blockH;
      const x1 = (b.c + 1) * blockW;
      const y1 = (b.r + 1) * blockH;
      return {
        id: b.id,
        name: b.name,
        label: b.label,
        type: 'square',
        row: b.r,
        col: b.c,
        rotation: 0,
        fabricColor: null,
        points: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 }
        ]
      };
    });

    this.activePartitionId = 'B2';
  }

  initFourByFourBlocks() {
    const artboardW = (this.camera && this.camera.artboardWidthPx) || (this.camera && this.camera.cushionPx) || 1587.4;
    const artboardH = (this.camera && this.camera.artboardHeightPx) || (this.camera && this.camera.cushionPx) || 2245.0;
    const blockW = artboardW / 4;
    const blockH = artboardH / 4;
    const rows = ['A', 'B', 'C', 'D'];

    const partitions = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const id = `${rows[r]}${c + 1}`;
        const x0 = c * blockW;
        const y0 = r * blockH;
        const x1 = (c + 1) * blockW;
        const y1 = (r + 1) * blockH;
        partitions.push({
          id,
          name: `Block ${id}`,
          label: id,
          type: 'square',
          row: r,
          col: c,
          rotation: 0,
          fabricColor: null,
          points: [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 }
          ]
        });
      }
    }
    this.partitionEngine.partitions = partitions;
    this.activePartitionId = 'B2';
  }

  initTwoByTwoBlocks() {
    const artboardW = (this.camera && this.camera.artboardWidthPx) || (this.camera && this.camera.cushionPx) || 1587.4;
    const artboardH = (this.camera && this.camera.artboardHeightPx) || (this.camera && this.camera.cushionPx) || 2245.0;
    const halfW = artboardW / 2;
    const halfH = artboardH / 2;

    const blockDefs = [
      { id: 'Q1', label: 'Q1', name: 'Quadrant 1 (Top-Left)', r: 0, c: 0 },
      { id: 'Q2', label: 'Q2', name: 'Quadrant 2 (Top-Right)', r: 0, c: 1 },
      { id: 'Q3', label: 'Q3', name: 'Quadrant 3 (Bottom-Left)', r: 1, c: 0 },
      { id: 'Q4', label: 'Q4', name: 'Quadrant 4 (Bottom-Right)', r: 1, c: 1 }
    ];

    this.partitionEngine.partitions = blockDefs.map(b => {
      const x0 = b.c * halfW;
      const y0 = b.r * halfH;
      const x1 = (b.c + 1) * halfW;
      const y1 = (b.r + 1) * halfH;
      return {
        id: b.id,
        name: b.name,
        label: b.label,
        type: 'square',
        row: b.r,
        col: b.c,
        rotation: 0,
        fabricColor: null,
        points: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 }
        ]
      };
    });

    this.activePartitionId = 'Q1';
  }

  initThreeBandBlocks() {
    const artboardW = (this.camera && this.camera.artboardWidthPx) || (this.camera && this.camera.cushionPx) || 1587.4;
    const artboardH = (this.camera && this.camera.artboardHeightPx) || (this.camera && this.camera.cushionPx) || 2245.0;
    const bandH = artboardH / 3;

    const bandDefs = [
      { id: 'Band-1', label: 'B1', name: 'Top Band', r: 0 },
      { id: 'Band-2', label: 'B2', name: 'Center Stripe', r: 1 },
      { id: 'Band-3', label: 'B3', name: 'Bottom Band', r: 2 }
    ];

    this.partitionEngine.partitions = bandDefs.map(b => {
      const y0 = b.r * bandH;
      const y1 = (b.r + 1) * bandH;
      return {
        id: b.id,
        name: b.name,
        label: b.label,
        type: 'square',
        row: b.r,
        col: 0,
        rotation: 0,
        fabricColor: null,
        points: [
          { x: 0, y: y0 },
          { x: artboardW, y: y0 },
          { x: artboardW, y: y1 },
          { x: 0, y: y1 }
        ]
      };
    });

    this.activePartitionId = 'Band-2';
  }

  initLFrameBlocks() {
    const artboardW = (this.camera && this.camera.artboardWidthPx) || (this.camera && this.camera.cushionPx) || 1587.4;
    const artboardH = (this.camera && this.camera.artboardHeightPx) || (this.camera && this.camera.cushionPx) || 2245.0;
    const insetX = artboardW * 0.22;
    const insetY = artboardH * 0.22;

    this.partitionEngine.partitions = [
      {
        id: 'Center',
        name: 'Center Medallion',
        label: 'CTR',
        type: 'square',
        rotation: 0,
        fabricColor: null,
        points: [
          { x: insetX, y: insetY },
          { x: artboardW - insetX, y: insetY },
          { x: artboardW - insetX, y: artboardH - insetY },
          { x: insetX, y: artboardH - insetY }
        ]
      },
      {
        id: 'Border-Top',
        name: 'Top Frame',
        label: 'TOP',
        type: 'square',
        rotation: 0,
        fabricColor: null,
        points: [
          { x: 0, y: 0 },
          { x: artboardW, y: 0 },
          { x: artboardW, y: insetY },
          { x: 0, y: insetY }
        ]
      },
      {
        id: 'Border-Right',
        name: 'Right Frame',
        label: 'RGT',
        type: 'square',
        rotation: 0,
        fabricColor: null,
        points: [
          { x: artboardW - insetX, y: insetY },
          { x: artboardW, y: insetY },
          { x: artboardW, y: artboardH - insetY },
          { x: artboardW - insetX, y: artboardH - insetY }
        ]
      },
      {
        id: 'Border-Bottom',
        name: 'Bottom Frame',
        label: 'BTM',
        type: 'square',
        rotation: 0,
        fabricColor: null,
        points: [
          { x: 0, y: artboardH - insetY },
          { x: artboardW, y: artboardH - insetY },
          { x: artboardW, y: artboardH },
          { x: 0, y: artboardH }
        ]
      },
      {
        id: 'Border-Left',
        name: 'Left Frame',
        label: 'LFT',
        type: 'square',
        rotation: 0,
        fabricColor: null,
        points: [
          { x: 0, y: insetY },
          { x: insetX, y: insetY },
          { x: insetX, y: artboardH - insetY },
          { x: 0, y: artboardH - insetY }
        ]
      }
    ];

    this.activePartitionId = 'Center';
  }

  initDiamondBlocks() {
    const artboardW = (this.camera && this.camera.artboardWidthPx) || (this.camera && this.camera.cushionPx) || 1587.4;
    const artboardH = (this.camera && this.camera.artboardHeightPx) || (this.camera && this.camera.cushionPx) || 2245.0;
    const midX = artboardW / 2;
    const midY = artboardH / 2;

    this.partitionEngine.partitions = [
      {
        id: 'Diamond',
        name: 'Center Diamond (45°)',
        label: 'DIA',
        type: 'diamond',
        rotation: 0,
        fabricColor: null,
        points: [
          { x: midX, y: 0 },
          { x: artboardW, y: midY },
          { x: midX, y: artboardH },
          { x: 0, y: midY }
        ]
      },
      {
        id: 'Corner-TL',
        name: 'Corner Top-Left',
        label: 'CTL',
        type: 'triangle',
        rotation: 0,
        fabricColor: null,
        points: [
          { x: 0, y: 0 },
          { x: midX, y: 0 },
          { x: 0, y: midY }
        ]
      },
      {
        id: 'Corner-TR',
        name: 'Corner Top-Right',
        label: 'CTR',
        type: 'triangle',
        rotation: 0,
        fabricColor: null,
        points: [
          { x: midX, y: 0 },
          { x: artboardW, y: 0 },
          { x: artboardW, y: midY }
        ]
      },
      {
        id: 'Corner-BR',
        name: 'Corner Bottom-Right',
        label: 'CBR',
        type: 'triangle',
        rotation: 0,
        fabricColor: null,
        points: [
          { x: artboardW, y: midY },
          { x: artboardW, y: artboardH },
          { x: midX, y: artboardH }
        ]
      },
      {
        id: 'Corner-BL',
        name: 'Corner Bottom-Left',
        label: 'CBL',
        type: 'triangle',
        rotation: 0,
        fabricColor: null,
        points: [
          { x: 0, y: midY },
          { x: midX, y: artboardH },
          { x: 0, y: artboardH }
        ]
      }
    ];

    this.activePartitionId = 'Diamond';
  }

  initUI() {
    const btnToggleGreen = document.getElementById('btn-toggle-green-sublab');
    if (btnToggleGreen) {
      btnToggleGreen.classList.toggle('active', this.isGreenSubLabActive);
      btnToggleGreen.textContent = this.isGreenSubLabActive ? '● Sub-Lab Focus: ON' : '○ Sub-Lab Focus: OFF';

      btnToggleGreen.addEventListener('click', () => {
        this.isGreenSubLabActive = !this.isGreenSubLabActive;
        btnToggleGreen.classList.toggle('active', this.isGreenSubLabActive);
        btnToggleGreen.textContent = this.isGreenSubLabActive ? '● Sub-Lab Focus: ON' : '○ Sub-Lab Focus: OFF';
        this.renderPartitionListUI();
        this.camera.requestRender();
      });
    }

    const btnPaste = document.getElementById('btn-paste-pattern-to-shape');
    if (btnPaste) {
      btnPaste.addEventListener('click', () => {
        this.pasteSelectedPatternToActiveShape();
      });
    }

    this.renderPartitionListUI();
  }

  getShapeIconSvg(type) {
    switch (type) {
      case 'diamond':
        return `<svg viewBox="0 0 24 24" width="18" height="18"><polygon points="12,2 22,12 12,22 2,12" stroke="currentColor" fill="none" stroke-width="2"/></svg>`;
      case 'triangle':
        return `<svg viewBox="0 0 24 24" width="18" height="18"><polygon points="12,3 22,21 2,21" stroke="currentColor" fill="none" stroke-width="2"/></svg>`;
      case 'circle':
        return `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="9" stroke="currentColor" fill="none" stroke-width="2"/></svg>`;
      case 'square':
      default:
        return `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" fill="none" stroke-width="2"/></svg>`;
    }
  }

  renderPartitionListUI() {
    const listEl = document.getElementById('vertical-shape-list');
    const badgeEl = document.getElementById('shape-count-badge');
    if (!listEl) return;

    const partitions = this.partitionEngine.partitions;
    if (badgeEl) badgeEl.textContent = partitions.length;

    // Set default active partition to B2 if not set or invalid
    if (!this.activePartitionId || !partitions.find(p => p.id === this.activePartitionId)) {
      const b2 = partitions.find(p => p.id === 'B2');
      this.activePartitionId = b2 ? 'B2' : (partitions[0] ? partitions[0].id : null);
    }

    listEl.innerHTML = '';
    partitions.forEach((p, idx) => {
      const item = document.createElement('div');
      const isActive = p.id === this.activePartitionId;
      item.className = `shape-item-card ${isActive ? 'active' : ''}`;
      item.dataset.shapeId = p.id;

      const statusText = isActive
        ? (this.isGreenSubLabActive ? 'Active Sub-Lab' : 'Selected')
        : 'Master Block';

      const labelText = p.name || p.id || `Block ${idx + 1}`;
      const colorIndicator = p.fabricColor
        ? `<span class="fabric-color-dot" style="background:${p.fabricColor};" title="${p.fabricColor}"></span>`
        : '';

      const delBtnHtml = p.isCustom
        ? `<button class="btn-del-custom-lab" data-del-id="${p.id}" title="Delete Custom Lab" style="background:transparent;border:none;color:#F87171;cursor:pointer;padding:2px 6px;font-size:12px;margin-left:auto;">✕</button>`
        : '';

      item.innerHTML = `
        <div class="shape-icon-badge">${this.getShapeIconSvg(p.type)}</div>
        <div class="shape-item-details">
          <div class="shape-title-row">
            <span class="shape-item-name">${labelText}</span>
            ${colorIndicator}
          </div>
          <span class="shape-item-sub">${statusText}</span>
        </div>
        ${delBtnHtml}
        ${this.isGreenSubLabActive && isActive ? '<span class="green-dot-pulse" title="Active Sub-Lab"></span>' : ''}
      `;

      const btnDel = item.querySelector('.btn-del-custom-lab');
      if (btnDel) {
        btnDel.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteCustomLab(p.id);
        });
      }

      if (isActive) {
        // If custom lab, show constraint toggle row
        if (p.isCustom) {
          const constrainRow = document.createElement('div');
          constrainRow.className = 'shape-constraint-row';
          constrainRow.style.cssText = 'width:100%;margin-top:6px;display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-top:1px solid rgba(255,255,255,0.06);';
          constrainRow.innerHTML = `
            <span class="nano-label" style="font-size:10px;color:#94A3B8;">CONSTRAINT:</span>
            <button class="pill-nano ${this.constrainToLab ? 'active' : ''}" id="btn-toggle-custom-constraint" style="font-size:10px;padding:3px 8px;cursor:pointer;background:${this.constrainToLab ? '#0284C7' : '#334155'};color:#fff;border-radius:4px;border:none;">
              ${this.constrainToLab ? '🔒 Lock Inside Lab' : '🔓 Free Draw Everywhere'}
            </button>
          `;
          constrainRow.querySelector('#btn-toggle-custom-constraint')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleConstraint();
          });
          item.appendChild(constrainRow);
        }

        // Rotation row
        const transRow = document.createElement('div');
        transRow.className = 'shape-transform-row';
        const currentRot = p.rotation || 0;
        transRow.innerHTML = `
          <span class="nano-label">ROT:</span>
          <button class="pill-nano ${currentRot === 0 ? 'active' : ''}" data-rot="0">0°</button>
          <button class="pill-nano ${currentRot === 45 ? 'active' : ''}" data-rot="45">45°</button>
          <button class="pill-nano ${currentRot === 90 ? 'active' : ''}" data-rot="90">90°</button>
        `;
        transRow.querySelectorAll('button[data-rot]').forEach((b) => {
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            p.rotation = parseInt(b.dataset.rot, 10);
            this.pasteSelectedPatternToActiveShape();
            this.renderPartitionListUI();
            this.camera.requestRender();
          });
        });
        item.appendChild(transRow);

        // Fabric color swatches row
        const colorRow = document.createElement('div');
        colorRow.className = 'shape-color-row';
        colorRow.innerHTML = `
          <span class="nano-label">FABRIC:</span>
          <div class="fabric-swatches-nano">
            <button class="swatch-nano ${!p.fabricColor ? 'active' : ''}" data-color="" title="None / Base Artboard" style="background:#2A2D37;">✕</button>
            <button class="swatch-nano ${p.fabricColor === '#1E293B' ? 'active' : ''}" data-color="#1E293B" title="Indigo Navy" style="background:#1E293B;"></button>
            <button class="swatch-nano ${p.fabricColor === '#9A3412' ? 'active' : ''}" data-color="#9A3412" title="Terracotta Rust" style="background:#9A3412;"></button>
            <button class="swatch-nano ${p.fabricColor === '#B45309' ? 'active' : ''}" data-color="#B45309" title="Ochre Gold" style="background:#B45309;"></button>
            <button class="swatch-nano ${p.fabricColor === '#365314' ? 'active' : ''}" data-color="#365314" title="Sage Olive" style="background:#365314;"></button>
            <button class="swatch-nano ${p.fabricColor === '#F8FAFC' ? 'active' : ''}" data-color="#F8FAFC" title="Natural Linen" style="background:#F8FAFC;"></button>
            <button class="swatch-nano ${p.fabricColor === '#18181B' ? 'active' : ''}" data-color="#18181B" title="Charcoal Noir" style="background:#18181B;"></button>
            <input type="color" class="custom-fabric-input" value="${p.fabricColor || '#1E293B'}" title="Custom Color">
          </div>
        `;
        colorRow.querySelectorAll('button[data-color]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            p.fabricColor = btn.dataset.color || null;
            this.renderPartitionListUI();
            this.camera.requestRender();
          });
        });
        const customColorInput = colorRow.querySelector('.custom-fabric-input');
        if (customColorInput) {
          customColorInput.addEventListener('input', (e) => {
            e.stopPropagation();
            p.fabricColor = e.target.value;
            this.camera.requestRender();
          });
          customColorInput.addEventListener('change', (e) => {
            e.stopPropagation();
            p.fabricColor = e.target.value;
            this.renderPartitionListUI();
            this.camera.requestRender();
          });
        }
        item.appendChild(colorRow);
      }

      item.addEventListener('click', () => {
        this.selectPartition(p.id);
      });

      listEl.appendChild(item);
    });

    this.updateHUD();
  }

  // Alias for backward compatibility
  renderShapeList() {
    this.renderPartitionListUI();
  }

  selectPartition(id) {
    this.activePartitionId = id;
    this.renderPartitionListUI();
    this.camera.requestRender();

    if (typeof this.onSelectionChanged === 'function') {
      this.onSelectionChanged(this.getActivePartition());
    }
  }

  getActivePartition() {
    const found = this.partitionEngine.partitions.find(p => p.id === this.activePartitionId);
    return found || this.partitionEngine.partitions[0] || null;
  }

  updateHUD() {
    const hudEl = document.getElementById('hud-active-shape');
    if (hudEl) {
      const active = this.getActivePartition();
      hudEl.textContent = active ? `Active: ${active.name || active.id}` : 'Active: Full Cushion';
    }
  }

  pasteSelectedPatternToActiveShape() {
    const active = this.getActivePartition();
    if (!active) return;

    const patternEdges = this.patternRegistry.generateForPartition(active);
    if (typeof this.onPatternPasted === 'function') {
      this.onPatternPasted(patternEdges, active);
    }
  }

  /**
   * Renders partition fabric fills, boundaries, and Sub-Lab isolation.
   */
  renderPartitions(ctx, state, optics) {
    const partitions = this.partitionEngine.partitions;
    if (!partitions || partitions.length === 0) return;

    ctx.save();
    const zoom = state.zoom || 1;

    // 1. Render Solid Fabric Patchwork Color fills (Visible whenever fabricColor is set)
    partitions.forEach((p) => {
      const pts = p.points;
      if (!pts || pts.length < 3) return;

      if (p.fabricColor) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = p.fabricColor;
        ctx.fill();

        // Subtle seam line between fabric pieces
        ctx.strokeStyle = optics.isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)';
        ctx.lineWidth = Math.max(1, 1.2 / zoom);
        ctx.stroke();
        ctx.restore();
      }
    });

    // 2. Render Sub-Lab guidelines and custom lab boundaries
    const hasCustomLabs = partitions.some(p => p.isCustom);
    if (!this.isGreenSubLabActive && !hasCustomLabs) {
      ctx.restore();
      return;
    }

    partitions.forEach((p) => {
      // ONLY render custom user-created labs on canvas! (Never spam A1..C3 block lines)
      if (!p.isCustom) return;

      const isActive = p.id === this.activePartitionId;
      const pts = p.points;
      if (!pts || pts.length < 3) return;

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();

      if (isActive) {
        ctx.save();
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = Math.max(1.5, 1.8 / zoom);
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        ctx.shadowColor = 'rgba(56, 189, 248, 0.4)';
        ctx.shadowBlur = 8;
        ctx.stroke();

        ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
        ctx.fill();
        ctx.restore();
      } else {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
        ctx.lineWidth = Math.max(0.75, 1.0 / zoom);
        ctx.setLineDash([4 / zoom, 4 / zoom]);
        ctx.stroke();
      }

      // Draw prominent floating badge above top-left of shape
      let minX = Infinity, minY = Infinity;
      for (const pt of pts) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
      }

      const badgeText = `📐 ${p.name} ${isActive && this.constrainToLab ? '🔒 Bounded Area' : ''}`;
      const fontSize = Math.max(10, 11 / zoom);
      ctx.save();
      ctx.font = `600 ${fontSize}px "JetBrains Mono", Consolas, monospace`;
      const tw = ctx.measureText(badgeText).width;
      const bw = tw + (16 / zoom);
      const bh = 22 / zoom;
      const bx = minX;
      const by = minY - bh - (6 / zoom);

      // Pill background
      ctx.fillStyle = '#181A24';
      ctx.strokeStyle = isActive ? '#38BDF8' : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = Math.max(1, 1.2 / zoom);
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(bx, by, bw, bh, 4 / zoom);
      } else {
        ctx.rect(bx, by, bw, bh);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isActive ? '#38BDF8' : '#EDEDED';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, bx + (8 / zoom), by + bh / 2);
      ctx.restore();
    });

    // 3. Render Drop Hover Glow when dragging pattern from library over any partition/shape
    if (this.hoveredDropPartition && this.hoveredDropPartition.points) {
      const hPts = this.hoveredDropPartition.points;
      if (hPts.length >= 3) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(hPts[0].x, hPts[0].y);
        for (let i = 1; i < hPts.length; i++) ctx.lineTo(hPts[i].x, hPts[i].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.fill();
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = Math.max(2.5, 3.2 / zoom);
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        ctx.stroke();

        let hMinX = Infinity, hMinY = Infinity;
        for (const pt of hPts) {
          hMinX = Math.min(hMinX, pt.x);
          hMinY = Math.min(hMinY, pt.y);
        }
        const badge = `📥 Drop to Fill: ${this.hoveredDropPartition.name || this.hoveredDropPartition.id}`;
        const fontSize = Math.max(10, 11 / zoom);
        ctx.font = `700 ${fontSize}px "JetBrains Mono", sans-serif`;
        const tw = ctx.measureText(badge).width;
        ctx.fillStyle = '#0284C7';
        ctx.fillRect(hMinX, hMinY - (24 / zoom), tw + (16 / zoom), 20 / zoom);
        ctx.fillStyle = '#FFFFFF';
        ctx.textBaseline = 'middle';
        ctx.fillText(badge, hMinX + (8 / zoom), hMinY - (14 / zoom));
        ctx.restore();
      }
    }

    ctx.restore();
  }
}
