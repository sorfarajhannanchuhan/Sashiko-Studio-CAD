/**
 * Sashiko Studio CAD - Pattern Registry & Sub-Lab Pattern Filler
 * Houses metadata, SVG thumbnails, and lattice-node edge clipping into partitions.
 */

import { PATTERN_KEYS, generatePattern } from './LatticeGenerators.js';

export const ASANOHA_PATTERN = {
  id: PATTERN_KEYS.ASANOHA,
  name: 'Asanoha',
  kanji: '麻の葉',
  furigana: 'あさのは',
  type: 'Hemp Leaf (Moyōzashi)',
  desc: 'Sacred hexagonal hemp leaf geometry; wards off evil spirits and symbolizes vigorous healthy growth.',
  origin: 'Pan-Japanese Classic / Edo Bunka 6 (1809) Hanshiro Kanoko',
  symmetry: 'p6m (Hexagonal Isometric)',
  svgThumbnail: `<svg viewBox="0 0 40 40" width="100%" height="100%"><polygon points="33,12.5 20,5 7,12.5 7,27.5 20,35 33,27.5" stroke="#10B981" stroke-width="1.3" fill="none"/><path d="M20,20 L33,12.5 M20,20 L20,5 M20,20 L7,12.5 M20,20 L7,27.5 M20,20 L20,35 M20,20 L33,27.5 M20,20 L28.66,20 M20,20 L24.33,12.5 M20,20 L15.67,12.5 M20,20 L11.34,20 M20,20 L15.67,27.5 M20,20 L24.33,27.5 M28.66,20 L33,12.5 M28.66,20 L33,27.5 M24.33,12.5 L33,12.5 M24.33,12.5 L20,5 M15.67,12.5 L20,5 M15.67,12.5 L7,12.5 M11.34,20 L7,12.5 M11.34,20 L7,27.5 M15.67,27.5 L7,27.5 M15.67,27.5 L20,35 M24.33,27.5 L20,35 M24.33,27.5 L33,27.5" stroke="#10B981" stroke-width="1.1" fill="none" stroke-linecap="round"/></svg>`
};

export const PATTERNS = [ ASANOHA_PATTERN ];

export class PatternRegistry {
  constructor(partitionEngine, latticeGrid) {
    this.partitionEngine = partitionEngine;
    this.latticeGrid = latticeGrid;
    this.patterns = PATTERNS;
    this.customGenerators = new Map();
    this.selectedPatternId = PATTERN_KEYS.ASANOHA;
    this.clipboardEdges = null;

    // Pattern Tessellation & Repeat Configuration (Core Motif Unit Cell Architecture)
    this.repeatX = 2; // Horizontal repeats (side by side)
    this.repeatY = 2; // Vertical repeats (top to bottom)
    this.tessellateMode = 'repeat'; // 'repeat' | 'fill'
    this.motifScale = 1.0;

    this.initUI();
    this.initRepeatControls();
  }

  /**
   * Dynamically register an authentic verified pattern into the library
   * @param {Object} patternDef Pattern metadata { id, name, kanji, type, desc, svgThumbnail, ... }
   * @param {Function} [generatorFn] Optional custom lattice generator function (minI, minJ, maxI, maxJ) => Map
   */
  registerPattern(patternDef, generatorFn = null) {
    if (!patternDef || !patternDef.id) return null;

    const existingIdx = this.patterns.findIndex(p => p.id === patternDef.id);
    if (existingIdx >= 0) {
      this.patterns[existingIdx] = patternDef;
    } else {
      this.patterns.push(patternDef);
    }

    if (typeof generatorFn === 'function') {
      this.customGenerators.set(patternDef.id, generatorFn);
    }

    if (!this.selectedPatternId) {
      this.selectedPatternId = patternDef.id;
    }

    this.initUI();
    return patternDef;
  }

  /**
   * Remove a pattern from the library by ID
   */
  removePattern(patternId) {
    const idx = this.patterns.findIndex(p => p.id === patternId);
    if (idx >= 0) {
      this.patterns.splice(idx, 1);
      this.customGenerators.delete(patternId);
    }
    if (this.selectedPatternId === patternId) {
      this.selectedPatternId = this.patterns[0]?.id || null;
    }
    this.initUI();
  }

  /**
   * Clear all patterns from the library
   */
  clearPatterns() {
    this.patterns.length = 0;
    this.customGenerators.clear();
    this.selectedPatternId = null;
    this.initUI();
  }

  initUI() {
    const container = document.getElementById('patterns-card-grid');
    const badgeCount = document.getElementById('badge-pattern-count');
    if (badgeCount) {
      badgeCount.textContent = `${this.patterns.length} Motifs`;
    }
    if (!container) return;

    container.innerHTML = '';

    if (this.patterns.length === 0) {
      container.innerHTML = `
        <div class="empty-patterns-slate">
          <div class="empty-slate-icon">⛩️</div>
          <div class="empty-slate-title">Library Cleared & Ready</div>
          <div class="empty-slate-desc">
            All placeholder motifs removed.<br>
            Awaiting authentic pattern reference scans.<br>
            <span class="empty-slate-highlight">Master Multi-Agent Pipeline Active</span>
          </div>
        </div>
      `;
      return;
    }

    this.patterns.forEach((p) => {
      const card = document.createElement('div');
      card.className = `pat-card ${p.id === this.selectedPatternId ? 'active' : ''}`;
      card.dataset.patternId = p.id;
      card.setAttribute('draggable', 'true');
      card.title = `Click or Drag onto Canvas / Shape: ${p.name}`;
      card.innerHTML = `
        <div class="pat-thumb-box">${p.svgThumbnail || ''}</div>
        <div class="pat-info-col">
          <span class="pat-label">${p.name}</span>
          <span class="pat-sub">${p.kanji ? `${p.kanji} • ` : ''}${p.type || 'Sashiko'}</span>
        </div>
      `;

      // Drag and Drop from Library to Canvas / Partition
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/sashiko-pattern-id', p.id);
        e.dataTransfer.setData('text/plain', p.id);
        e.dataTransfer.effectAllowed = 'copy';
        card.classList.add('dragging');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });

      card.addEventListener('click', () => {
        this.selectedPatternId = p.id;
        container.querySelectorAll('.pat-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');

        if (typeof this.onPatternSelected === 'function') {
          this.onPatternSelected(p.id);
        }
      });

      card.addEventListener('dblclick', () => {
        this.selectedPatternId = p.id;
        container.querySelectorAll('.pat-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');

        if (typeof this.onPatternSelected === 'function') {
          this.onPatternSelected(p.id);
        }
      });

      container.appendChild(card);
    });
  }

  initRepeatControls() {
    const valX = document.getElementById('val-repeat-x');
    const valY = document.getElementById('val-repeat-y');
    const btnXDec = document.getElementById('btn-rep-x-dec');
    const btnXInc = document.getElementById('btn-rep-x-inc');
    const btnYDec = document.getElementById('btn-rep-y-dec');
    const btnYInc = document.getElementById('btn-rep-y-inc');
    const btnModeRep = document.getElementById('pat-mode-repeat');
    const btnModeFill = document.getElementById('pat-mode-fill');

    const updateUI = () => {
      if (valX) valX.textContent = this.repeatX;
      if (valY) valY.textContent = this.repeatY;
      if (btnModeRep) btnModeRep.classList.toggle('active', this.tessellateMode === 'repeat');
      if (btnModeFill) btnModeFill.classList.toggle('active', this.tessellateMode === 'fill');
      const rowX = document.getElementById('row-repeat-x');
      const rowY = document.getElementById('row-repeat-y');
      if (rowX) rowX.style.opacity = this.tessellateMode === 'repeat' ? '1' : '0.4';
      if (rowY) rowY.style.opacity = this.tessellateMode === 'repeat' ? '1' : '0.4';
    };

    // Debounce pattern regeneration on rapid stepper clicks (150ms trailing)
    let _repTimer = null;
    const debouncedRegen = () => {
      if (_repTimer) clearTimeout(_repTimer);
      _repTimer = setTimeout(() => {
        if (this.onPatternSelected) this.onPatternSelected(this.selectedPatternId);
      }, 150);
    };

    btnXDec?.addEventListener('click', () => {
      this.repeatX = Math.max(1, this.repeatX - 1);
      updateUI();
      debouncedRegen();
    });

    btnXInc?.addEventListener('click', () => {
      this.repeatX = Math.min(16, this.repeatX + 1);
      updateUI();
      debouncedRegen();
    });

    btnYDec?.addEventListener('click', () => {
      this.repeatY = Math.max(1, this.repeatY - 1);
      updateUI();
      debouncedRegen();
    });

    btnYInc?.addEventListener('click', () => {
      this.repeatY = Math.min(16, this.repeatY + 1);
      updateUI();
      debouncedRegen();
    });

    btnModeRep?.addEventListener('click', () => {
      this.tessellateMode = 'repeat';
      updateUI();
      debouncedRegen();
    });

    btnModeFill?.addEventListener('click', () => {
      this.tessellateMode = 'fill';
      updateUI();
      debouncedRegen();
    });

    updateUI();
  }

  getSelectedPattern() {
    if (this.patterns.length === 0) return null;
    return this.patterns.find(p => p.id === this.selectedPatternId) || this.patterns[0] || null;
  }

  /**
   * Generates stitches for a specific partition or the entire cushion,
   * strictly anchoring edges to lattice nodes and clipping to the polygon boundary.
   * Supports Core Motif Unit Cell tiling (repeatX, repeatY) or full boundary filling.
   */
  generateForPartition(partition, patternId = null, options = {}) {
    const patId = patternId || this.selectedPatternId;
    if (!patId) return new Map();

    const rotation = partition.rotation || options.rotation || 0; // in degrees (0, 45, 90, 180)
    const scale = partition.scaleMultiplier || options.scaleMultiplier || 1.0;
    const step = this.latticeGrid.getStepPx() * scale;

    // 1. Compute bounding box of polygon points
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of partition.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const mode = options.mode || this.tessellateMode || 'repeat';
    const repX = options.repeatX || this.repeatX || 2;
    const repY = options.repeatY || this.repeatY || 2;

    let minI, minJ, maxI, maxJ;

    if (mode === 'repeat' && !options.forceFill) {
      // Core Motif Unit Cell tiling:
      // For Asanoha: unit tile width L = 6, height 2*H ~ 10.392
      const unitW = 6;
      const unitH = 6 * Math.sqrt(3); // ~10.392

      const totalSpanI = repX * unitW;
      const totalSpanJ = repY * unitH;

      const midI = Math.round(cx / step);
      const midJ = Math.round(cy / step);

      minI = midI - Math.floor(totalSpanI / 2);
      maxI = minI + totalSpanI;
      minJ = midJ - Math.floor(totalSpanJ / 2);
      maxJ = minJ + Math.ceil(totalSpanJ);
    } else {
      // 'fill' mode: cover whole bounding box of partition polygon
      // Expand search box if rotated so entire area is covered
      const radius = Math.hypot(maxX - minX, maxY - minY) / 2;
      const bMinX = rotation !== 0 ? cx - radius : minX;
      const bMaxX = rotation !== 0 ? cx + radius : maxX;
      const bMinY = rotation !== 0 ? cy - radius : minY;
      const bMaxY = rotation !== 0 ? cy + radius : maxY;

      minI = Math.max(0, Math.floor(bMinX / step));
      minJ = Math.max(0, Math.floor(bMinY / step));
      maxI = Math.ceil(bMaxX / step);
      maxJ = Math.ceil(bMaxY / step);
    }

    // 2. Generate raw lattice edges (via custom generator or built-in)
    let rawEdges = null;
    if (this.customGenerators.has(patId)) {
      rawEdges = this.customGenerators.get(patId)(minI, minJ, maxI, maxJ);
    } else {
      rawEdges = generatePattern(patId, minI, minJ, maxI, maxJ);
    }

    if (!rawEdges || !(rawEdges instanceof Map)) {
      return new Map();
    }
    const clippedEdges = new Map();

    const radAngle = (rotation * Math.PI) / 180;
    const cosA = Math.cos(radAngle);
    const sinA = Math.sin(radAngle);

    // 3. Keep edges whose midpoint lies inside the partition polygon
    for (const [k, edge] of rawEdges.entries()) {
      let p1 = { x: edge.u[0] * step, y: edge.u[1] * step };
      let p2 = { x: edge.v[0] * step, y: edge.v[1] * step };

      if (rotation !== 0) {
        // Rotate world coordinates around polygon center
        const r1x = cosA * (p1.x - cx) - sinA * (p1.y - cy) + cx;
        const r1y = sinA * (p1.x - cx) + cosA * (p1.y - cy) + cy;
        const r2x = cosA * (p2.x - cx) - sinA * (p2.y - cy) + cx;
        const r2y = sinA * (p2.x - cx) + cosA * (p2.y - cy) + cy;
        p1 = { x: r1x, y: r1y };
        p2 = { x: r2x, y: r2y };
      }

      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      if (this.partitionEngine.isPointInside(mid, partition.points)) {
        // Snap rotated endpoints back to discrete lattice grid nodes
        const s1 = this.latticeGrid.snapToNode(p1);
        const s2 = this.latticeGrid.snapToNode(p2);
        if (s1.i !== s2.i || s1.j !== s2.j) {
          const finalKey = `${s1.i},${s1.j}--${s2.i},${s2.j}`;
          clippedEdges.set(finalKey, {
            u: [s1.i, s1.j],
            v: [s2.i, s2.j],
            partitionId: partition.id
          });
        }
      }
    }

    return clippedEdges;
  }
}
