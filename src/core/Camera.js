/**
 * Sashiko Studio CAD - Pure Canvas Camera Engine with Bounded Physical Artboard (Image 1 Style)
 * Supports standard A2, A3, A4 and Cushion Artboard presets, 60fps pan/zoom,
 * and high-DPR architectural rulers.
 */

export const ARTBOARD_PRESETS = {
  '16x16': { name: '16" × 16"', wMm: 406.4, hMm: 406.4, wIn: 16, hIn: 16 },
  '18x18': { name: '18" × 18"', wMm: 457.2, hMm: 457.2, wIn: 18, hIn: 18 },
  '20x20': { name: '20" × 20"', wMm: 508.0, hMm: 508.0, wIn: 20, hIn: 20 },
  'cushion-16': { name: '16" × 16"', wMm: 406.4, hMm: 406.4, wIn: 16, hIn: 16 },
  'cushion-18': { name: '18" × 18"', wMm: 457.2, hMm: 457.2, wIn: 18, hIn: 18 },
  'cushion-20': { name: '20" × 20"', wMm: 508.0, hMm: 508.0, wIn: 20, hIn: 20 },
  'A2': { name: 'A2 (420 × 594 mm)', wMm: 420, hMm: 594, wIn: 16.54, hIn: 23.39 },
  'A3': { name: 'A3 (297 × 420 mm)', wMm: 297, hMm: 420, wIn: 11.69, hIn: 16.54 },
  'A4': { name: 'A4 (210 × 297 mm)', wMm: 210, hMm: 297, wIn: 8.27, hIn: 11.69 }
};

export class Camera {
  constructor(canvasEl, stageEl) {
    this.canvas = canvasEl;
    this.stage = stageEl;
    this.ctx = canvasEl.getContext('2d');

    this.ppi = 96; // 96 CSS pixels per physical inch

    // Default Bounded Artboard: 18" × 18" Cushion Standard (Auto-Centered on Infinite Grid)
    this.artboardPreset = '18" × 18"';
    this.orientation = 'portrait'; // 'portrait' | 'landscape'
    this.artboardWidthMm = 457.2;
    this.artboardHeightMm = 457.2;
    this.updateArtboardPixels();

    // Camera Transform (Screen coordinates)
    this.panX = 0;
    this.panY = 0;
    this.zoom = 0.35;

    this.isPanning = false;
    this.lastScreenX = 0;
    this.lastScreenY = 0;

    this.subscribers = [];

    // Architectural Rulers
    this.showRulers = true;
    this.rulerUnit = 'in'; // 'in' | 'cm' | 'mm'
    this.rulerSize = 24; // 24px professional standard
    this.onRulerUnitChanged = null;
    this.currentMouseX = 0;
    this.currentMouseY = 0;

    this.artboardBg = '#121316'; // Artboard paper background
    this.workbenchBg = '#1A1C23'; // Surrounding studio floor
    this.workAreaEnabled = false; // Default: Free Infinite Canvas (No forced cushion frame or badge)

    this.init();
  }

  updateArtboardPixels() {
    let wMm = this.artboardWidthMm;
    let hMm = this.artboardHeightMm;
    if (this.orientation === 'landscape') {
      const temp = wMm;
      wMm = hMm;
      hMm = temp;
    }
    this.activeWidthMm = wMm;
    this.activeHeightMm = hMm;
    this.artboardWidthPx = (wMm / 25.4) * this.ppi;
    this.artboardHeightPx = (hMm / 25.4) * this.ppi;
  }

  // Backwards compatibility getters
  get cushionPx() {
    return this.artboardWidthPx;
  }

  get cushionInches() {
    return this.activeWidthMm / 25.4;
  }

  setArtboard(presetKey, orientation = 'portrait') {
    const config = ARTBOARD_PRESETS[presetKey] || ARTBOARD_PRESETS['A2'];
    this.artboardPreset = presetKey;
    this.orientation = orientation;
    this.artboardWidthMm = config.wMm;
    this.artboardHeightMm = config.hMm;
    this.updateArtboardPixels();
    this.centerCushion();
  }

  setCushionSize(inches) {
    this.setCustomArtboard(inches, inches, `Cushion ${inches}"×${inches}"`);
  }

  setCustomArtboard(widthInches, heightInches, name = null) {
    this.artboardWidthMm = widthInches * 25.4;
    this.artboardHeightMm = heightInches * 25.4;
    this.activeWidthInches = widthInches;
    this.activeHeightInches = heightInches;
    this.orientation = widthInches > heightInches ? 'landscape' : 'portrait';
    this.artboardPreset = name || `${widthInches}"×${heightInches}"`;
    this.updateArtboardPixels();
    this.centerCushion();
  }

  init() {
    this.resize();
    this.centerCushion();
    this.bindEvents();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.stage.getBoundingClientRect();
    const w = rect.width || window.innerWidth;
    const h = rect.height || window.innerHeight;

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    this.screenWidth = w;
    this.screenHeight = h;
    this.dpr = dpr;

    this.requestRender();
  }

  centerCushion() {
    const margin = 56;
    const availableW = this.screenWidth - margin * 2;
    const availableH = this.screenHeight - margin * 2;

    const zoomX = availableW / this.artboardWidthPx;
    const zoomY = availableH / this.artboardHeightPx;
    this.zoom = Math.max(0.08, Math.min(zoomX, zoomY, 1.8));

    this.panX = (this.screenWidth - this.artboardWidthPx * this.zoom) / 2;
    this.panY = (this.screenHeight - this.artboardHeightPx * this.zoom) / 2;

    this.updateZoomHUD();
    this.requestRender();
  }

  setWorkAreaEnabled(val) {
    this.workAreaEnabled = !!val;
    if (!this.workAreaEnabled) {
      this.workAreaBadgeBounds = null;
    }
    this.requestRender();
  }

  zoomAtScreenPoint(clientX, clientY, factor) {
    const newZoom = Math.max(0.05, Math.min(this.zoom * factor, 5.0));
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
    this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
    this.zoom = newZoom;

    this.updateZoomHUD();
    this.requestRender();
  }

  bindEvents() {
    // Wheel Zooming & Touchpad Scroll (Figma / Illustrator Standard)
    this.stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Guard: Ignore wheel zoom/pan when Hardware Trace Lock is active
      if (this.artLabManager?.isTraceLocked) {
        return;
      }

      // Case 1: Pinch-to-zoom OR Ctrl + Scroll wheel -> Zoom centered on cursor
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01);
        this.zoomAtScreenPoint(e.clientX, e.clientY, factor);
        return;
      }

      // Case 2: Standard Two-Finger Trackpad Swipe OR Mouse Wheel -> 2D Pan!
      // 2-finger scroll moves the canvas viewport smoothly up/down and left/right
      this.panX -= e.deltaX;
      this.panY -= e.deltaY;
      this.requestRender();
    }, { passive: false });

    // Global Zoom Trapping: Prevent native browser page zoom so toolbar icons & UI NEVER scale!
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.01);
        const clientX = (e.clientX >= 0 && e.clientX <= window.innerWidth) ? e.clientX : window.innerWidth / 2;
        const clientY = (e.clientY >= 0 && e.clientY <= window.innerHeight) ? e.clientY : window.innerHeight / 2;
        this.zoomAtScreenPoint(clientX, clientY, factor);
      }
    }, { passive: false });

    // Trap touch gesture zoom events on window
    window.addEventListener('gesturestart', (e) => e.preventDefault());
    window.addEventListener('gesturechange', (e) => e.preventDefault());
    window.addEventListener('gestureend', (e) => e.preventDefault());

    // Spacebar + Pan Dragging & Zoom Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.spacePressed && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        this.spacePressed = true;
        this.canvas.style.cursor = 'grab';
      }
      // Ctrl+0: Fit Artboard
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        this.centerCushion();
      }
      // Ctrl + / Ctrl - / Ctrl = : Zoom Canvas Viewport (NOT browser page!)
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_')) {
        e.preventDefault();
        const factor = (e.key === '=' || e.key === '+') ? 1.2 : 0.833;
        const centerX = this.screenWidth / 2;
        const centerY = this.screenHeight / 2;
        this.zoomAtScreenPoint(centerX, centerY, factor);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spacePressed = false;
        if (!this.isPanning) {
          if (typeof this.onCursorRestore === 'function') {
            this.onCursorRestore();
          } else {
            this.canvas.style.cursor = 'default';
          }
        }
      }
    });

    this.stage.addEventListener('pointerdown', (e) => {
      if (this.artLabManager?.isTraceLocked) {
        return;
      }
      if (e.button === 1 || (e.button === 0 && this.spacePressed)) {
        this.isPanning = true;
        this.lastScreenX = e.clientX;
        this.lastScreenY = e.clientY;
        this.canvas.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.lastScreenX;
        const dy = e.clientY - this.lastScreenY;
        this.panX += dx;
        this.panY += dy;
        this.lastScreenX = e.clientX;
        this.lastScreenY = e.clientY;
        this.requestRender();
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (this.isPanning) {
        this.isPanning = false;
        this.canvas.style.cursor = this.spacePressed ? 'grab' : 'default';
      }
    });

    window.addEventListener('resize', () => {
      this.resize();
      this.centerCushion();
    });

    this.stage.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.currentMouseX = e.clientX - rect.left;
      this.currentMouseY = e.clientY - rect.top;
      if (this.showRulers) {
        this.requestRender();
      }
    });

    const handleCanvasClick = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // Click corner box to cycle units: in -> cm -> mm
      const rSz = this.rulerSize || 24;
      if (this.showRulers && sx <= rSz && sy <= rSz) {
        let nextUnit = 'in';
        if (this.rulerUnit === 'in') nextUnit = 'cm';
        else if (this.rulerUnit === 'cm') nextUnit = 'mm';
        else nextUnit = 'in';
        this.setRulerUnit(nextUnit);
        return;
      }

      // Click Work Area Badge to open Size Selection Menu directly on canvas
      if (this.workAreaBadgeBounds) {
        const world = this.screenToWorld(e.clientX, e.clientY);
        const b = this.workAreaBadgeBounds;
        if (world.x >= b.x && world.x <= b.x + b.w && world.y >= b.y && world.y <= b.y + b.h) {
          e.stopPropagation();
          if (typeof this.onWorkAreaBadgeClicked === 'function') {
            this.onWorkAreaBadgeClicked(e);
            return;
          }
        }
      }
    };

    this.canvas.addEventListener('click', handleCanvasClick);

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R') && !e.shiftKey && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        this.showRulers = !this.showRulers;
        this.requestRender();
      }
    });
  }

  setRulerUnit(unit) {
    if (unit === this.rulerUnit) return;
    this.rulerUnit = unit;
    if (typeof this.onRulerUnitChanged === 'function') {
      this.onRulerUnitChanged(unit);
    }
    this.requestRender();
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom
    };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: worldX * this.zoom + this.panX,
      y: worldY * this.zoom + this.panY
    };
  }

  getViewportWorldBounds() {
    const pad = 40;
    return {
      minX: (0 - this.panX) / this.zoom - pad,
      minY: (0 - this.panY) / this.zoom - pad,
      maxX: (this.screenWidth - this.panX) / this.zoom + pad,
      maxY: (this.screenHeight - this.panY) / this.zoom + pad
    };
  }

  updateZoomHUD() {
    const el = document.getElementById('hud-zoom');
    if (el) el.textContent = `Zoom: ${Math.round(this.zoom * 100)}%`;
    const elDim = document.getElementById('hud-dimension');
    if (elDim) {
      elDim.textContent = `${this.activeWidthMm.toFixed(0)} × ${this.activeHeightMm.toFixed(0)} mm (${(this.activeWidthMm / 25.4).toFixed(1)}" × ${(this.activeHeightMm / 25.4).toFixed(1)}")`;
    }
  }

  subscribe(fn) {
    this.subscribers.push(fn);
  }

  requestRender() {
    if (!this.rafPending) {
      this.rafPending = true;
      requestAnimationFrame(() => {
        this.rafPending = false;
        this.render();
      });
    }
  }

  render() {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;

    // Reset screen transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Uniform canvas background across entire window
    ctx.fillStyle = this.artboardBg || '#121316';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply Camera Transform
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // 1. Render Middle Work Area Framing (Auto-Centered Cushions & Artboard - only if enabled)
    if (this.workAreaEnabled) {
      ctx.save();
      // Soft ambient shadow for active work area
      ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
      ctx.shadowBlur = 36 / this.zoom;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 16 / this.zoom;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
      ctx.fillRect(0, 0, this.artboardWidthPx, this.artboardHeightPx);
      ctx.restore();

      // Crisp Middle Work Area Boundary (Professional Illustrator / Figma Slate)
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = Math.max(1.0, 1.2 / this.zoom);
      ctx.setLineDash([8 / this.zoom, 6 / this.zoom]);
      ctx.strokeRect(0, 0, this.artboardWidthPx, this.artboardHeightPx);

      // Precision Corner L-Crop Marks (Clean Blueprint Accent)
      const markLen = 14 / this.zoom;
      ctx.setLineDash([]);
      ctx.strokeStyle = '#38BDF8'; // Professional crisp cyan/ice-blue
      ctx.lineWidth = Math.max(1.5, 1.8 / this.zoom);
      ctx.beginPath();
      // TL
      ctx.moveTo(-markLen, 0); ctx.lineTo(0, 0); ctx.lineTo(0, -markLen);
      // TR
      ctx.moveTo(this.artboardWidthPx + markLen, 0); ctx.lineTo(this.artboardWidthPx, 0); ctx.lineTo(this.artboardWidthPx, -markLen);
      // BR
      ctx.moveTo(this.artboardWidthPx + markLen, this.artboardHeightPx); ctx.lineTo(this.artboardWidthPx, this.artboardHeightPx); ctx.lineTo(this.artboardWidthPx, this.artboardHeightPx + markLen);
      // BL
      ctx.moveTo(-markLen, this.artboardHeightPx); ctx.lineTo(0, this.artboardHeightPx); ctx.lineTo(0, this.artboardHeightPx + markLen);
      ctx.stroke();

      // Clickable Work Area Pill Badge in top-left margin
      const titleFontSz = Math.max(10, 11 / this.zoom);
      ctx.font = `600 ${titleFontSz}px "JetBrains Mono", Consolas, monospace`;
      const labelText = `📐 ${this.artboardPreset} (${Math.round(this.activeWidthMm)}×${Math.round(this.activeHeightMm)}mm)  ✎ Edit Size`;
      const textMetrics = ctx.measureText(labelText);
      const badgeW = textMetrics.width + (18 / this.zoom);
      const badgeH = 22 / this.zoom;
      const badgeX = 0;
      const badgeY = -badgeH - (8 / this.zoom);

      this.workAreaBadgeBounds = { x: badgeX, y: badgeY, w: badgeW, h: badgeH };

      // Pill Background
      ctx.fillStyle = '#181A24';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = Math.max(1.0, 1.2 / this.zoom);
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4 / this.zoom);
      } else {
        ctx.rect(badgeX, badgeY, badgeW, badgeH);
      }
      ctx.fill();
      ctx.stroke();

      // Pill Text
      ctx.fillStyle = '#E2E8F0';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, badgeX + (9 / this.zoom), badgeY + badgeH / 2);
      ctx.restore();
    } else {
      this.workAreaBadgeBounds = null;
    }

    const state = {
      width: this.artboardWidthPx,
      height: this.artboardHeightPx,
      cushionInches: this.cushionInches,
      activeWidthMm: this.activeWidthMm,
      activeHeightMm: this.activeHeightMm,
      ppi: this.ppi,
      zoom: this.zoom
    };

    // Execute render pipeline subscribers (LatticeGrid, StitchPen, SubLabs, ArtLab, VirtualRuler)
    for (const fn of this.subscribers) {
      try {
        fn(ctx, state);
      } catch (subErr) {
        console.warn('Render subscriber error:', subErr);
      }
    }

    ctx.restore();

    // 2. Render Architectural Rulers along top & left
    this.renderRulers(ctx, dpr);
  }

  renderRulers(ctx, dpr) {
    if (!this.showRulers) return;

    const rulerSize = this.rulerSize || 24;
    const w = this.screenWidth;
    const h = this.screenHeight;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // 1. Ruler Backgrounds (Dark architectural graphite slate)
    ctx.fillStyle = '#161822';
    ctx.fillRect(0, 0, w, rulerSize);
    ctx.fillRect(0, 0, rulerSize, h);

    // Subtle outline divider lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rulerSize);
    ctx.lineTo(w, rulerSize);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(rulerSize, 0);
    ctx.lineTo(rulerSize, h);
    ctx.stroke();

    // 2. Active Page / Artboard Range Highlight (when workAreaEnabled is ON)
    if (this.workAreaEnabled && this.artboardWidthPx && this.artboardHeightPx) {
      const artStartX = this.panX;
      const artEndX = this.artboardWidthPx * this.zoom + this.panX;
      const artStartY = this.panY;
      const artEndY = this.artboardHeightPx * this.zoom + this.panY;

      // Top ruler artboard range
      const hlX1 = Math.max(rulerSize, Math.min(artStartX, artEndX));
      const hlX2 = Math.min(w, Math.max(artStartX, artEndX));
      if (hlX2 > hlX1) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
        ctx.fillRect(hlX1, 0, hlX2 - hlX1, rulerSize);
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 1.5;
        if (artStartX >= rulerSize && artStartX <= w) {
          ctx.beginPath();
          ctx.moveTo(artStartX, 0);
          ctx.lineTo(artStartX, rulerSize);
          ctx.stroke();
        }
        if (artEndX >= rulerSize && artEndX <= w) {
          ctx.beginPath();
          ctx.moveTo(artEndX, 0);
          ctx.lineTo(artEndX, rulerSize);
          ctx.stroke();
        }
      }

      // Left ruler artboard range
      const hlY1 = Math.max(rulerSize, Math.min(artStartY, artEndY));
      const hlY2 = Math.min(h, Math.max(artStartY, artEndY));
      if (hlY2 > hlY1) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
        ctx.fillRect(0, hlY1, rulerSize, hlY2 - hlY1);
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 1.5;
        if (artStartY >= rulerSize && artStartY <= h) {
          ctx.beginPath();
          ctx.moveTo(0, artStartY);
          ctx.lineTo(rulerSize, artStartY);
          ctx.stroke();
        }
        if (artEndY >= rulerSize && artEndY <= h) {
          ctx.beginPath();
          ctx.moveTo(0, artEndY);
          ctx.lineTo(rulerSize, artEndY);
          ctx.stroke();
        }
      }
    }

    // 3. Scale, Units & Adaptive Level-of-Detail (LOD)
    let unitStepPx = this.ppi; // default inch (96px)
    let majorUnitStep = 1;
    const unitLabel = this.rulerUnit || 'in';

    if (unitLabel === 'mm') {
      unitStepPx = (1 / 25.4) * this.ppi; // px per mm
      majorUnitStep = 10; // major marks every 10mm (1cm)
    } else if (unitLabel === 'cm') {
      unitStepPx = (10 / 25.4) * this.ppi; // px per cm
      majorUnitStep = 1; // major marks every 1cm
    } else {
      unitStepPx = this.ppi; // px per inch
      majorUnitStep = 1; // major marks every 1 inch
    }

    const majorStepWorldPx = majorUnitStep * unitStepPx;
    const screenMajorStep = majorStepWorldPx * this.zoom;

    // Adaptive label interval: dynamically skip labels when zoomed out so text never overlaps
    let labelInterval = 1;
    if (screenMajorStep < 30) {
      const targetDist = 55; // minimum ~55px between number labels
      const ratio = targetDist / screenMajorStep;
      if (ratio <= 2) labelInterval = 2;
      else if (ratio <= 5) labelInterval = 5;
      else if (ratio <= 10) labelInterval = 10;
      else if (ratio <= 20) labelInterval = 20;
      else if (ratio <= 50) labelInterval = 50;
      else labelInterval = 100;
    }

    // Full screen visible world boundaries
    const minWorldX = (rulerSize - this.panX) / this.zoom;
    const maxWorldX = (w - this.panX) / this.zoom;
    const minWorldY = (rulerSize - this.panY) / this.zoom;
    const maxWorldY = (h - this.panY) / this.zoom;

    const minUnitX = Math.floor(minWorldX / majorStepWorldPx) - 1;
    const maxUnitX = Math.ceil(maxWorldX / majorStepWorldPx) + 1;
    const minUnitY = Math.floor(minWorldY / majorStepWorldPx) - 1;
    const maxUnitY = Math.ceil(maxWorldY / majorStepWorldPx) + 1;

    const majorFont = '600 11px "JetBrains Mono", Inter, -apple-system, monospace';
    const originFont = '700 12px "JetBrains Mono", Inter, -apple-system, monospace';

    // 4. Horizontal Top Ruler Ticks & Numbers (Covers ALL visible grids!)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let u = minUnitX; u <= maxUnitX; u++) {
      const worldX = u * majorStepWorldPx;
      const sx = worldX * this.zoom + this.panX;

      if (sx < rulerSize - 2 || sx > w + 2) continue;

      const unitValue = u * majorUnitStep;
      const isOrigin = (unitValue === 0);
      const isLabeled = (u % labelInterval === 0);

      // Major tick mark
      ctx.beginPath();
      ctx.strokeStyle = isOrigin ? '#00FF7F' : 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = isOrigin ? 1.5 : 1;
      ctx.moveTo(sx, isOrigin ? rulerSize - 11 : rulerSize - 8);
      ctx.lineTo(sx, rulerSize);
      ctx.stroke();

      // Number Label (Larger font, high contrast, clean positioning)
      if (isLabeled && sx >= rulerSize + 12 && sx <= w - 12) {
        ctx.font = isOrigin ? originFont : majorFont;
        ctx.fillStyle = isOrigin ? '#00FF7F' : '#F1F5F9';
        ctx.fillText(`${unitValue}`, sx, 3);
      }

      // Sub-ticks between major units
      if (screenMajorStep >= 36) {
        // Half mark
        const midSx = sx + 0.5 * screenMajorStep;
        if (midSx >= rulerSize && midSx <= w) {
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.lineWidth = 1;
          ctx.moveTo(midSx, rulerSize - 5.5);
          ctx.lineTo(midSx, rulerSize);
          ctx.stroke();
        }

        // Quarter marks if room
        if (screenMajorStep >= 75) {
          const q1Sx = sx + 0.25 * screenMajorStep;
          const q3Sx = sx + 0.75 * screenMajorStep;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
          ctx.lineWidth = 1;
          if (q1Sx >= rulerSize && q1Sx <= w) {
            ctx.beginPath();
            ctx.moveTo(q1Sx, rulerSize - 3.5);
            ctx.lineTo(q1Sx, rulerSize);
            ctx.stroke();
          }
          if (q3Sx >= rulerSize && q3Sx <= w) {
            ctx.beginPath();
            ctx.moveTo(q3Sx, rulerSize - 3.5);
            ctx.lineTo(q3Sx, rulerSize);
            ctx.stroke();
          }
        }

        // Eighth marks if very zoomed in
        if (screenMajorStep >= 160) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
          for (let oct = 1; oct < 8; oct += 2) {
            const octSx = sx + (oct / 8) * screenMajorStep;
            if (octSx >= rulerSize && octSx <= w) {
              ctx.beginPath();
              ctx.moveTo(octSx, rulerSize - 2.5);
              ctx.lineTo(octSx, rulerSize);
              ctx.stroke();
            }
          }
        }
      }
    }

    // 5. Vertical Left Ruler Ticks & Numbers (Covers ALL visible grids!)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let u = minUnitY; u <= maxUnitY; u++) {
      const worldY = u * majorStepWorldPx;
      const sy = worldY * this.zoom + this.panY;

      if (sy < rulerSize - 2 || sy > h + 2) continue;

      const unitValue = u * majorUnitStep;
      const isOrigin = (unitValue === 0);
      const isLabeled = (u % labelInterval === 0);

      // Major tick mark
      ctx.beginPath();
      ctx.strokeStyle = isOrigin ? '#00FF7F' : 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = isOrigin ? 1.5 : 1;
      ctx.moveTo(isOrigin ? rulerSize - 11 : rulerSize - 8, sy);
      ctx.lineTo(rulerSize, sy);
      ctx.stroke();

      // Number Label (Larger font, high contrast, clean positioning)
      if (isLabeled && sy >= rulerSize + 10 && sy <= h - 10) {
        ctx.font = isOrigin ? originFont : majorFont;
        ctx.fillStyle = isOrigin ? '#00FF7F' : '#F1F5F9';
        ctx.fillText(`${unitValue}`, rulerSize - 9, sy);
      }

      // Sub-ticks
      if (screenMajorStep >= 36) {
        const midSy = sy + 0.5 * screenMajorStep;
        if (midSy >= rulerSize && midSy <= h) {
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.lineWidth = 1;
          ctx.moveTo(rulerSize - 5.5, midSy);
          ctx.lineTo(rulerSize, midSy);
          ctx.stroke();
        }

        if (screenMajorStep >= 75) {
          const q1Sy = sy + 0.25 * screenMajorStep;
          const q3Sy = sy + 0.75 * screenMajorStep;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
          ctx.lineWidth = 1;
          if (q1Sy >= rulerSize && q1Sy <= h) {
            ctx.beginPath();
            ctx.moveTo(rulerSize - 3.5, q1Sy);
            ctx.lineTo(rulerSize, q1Sy);
            ctx.stroke();
          }
          if (q3Sy >= rulerSize && q3Sy <= h) {
            ctx.beginPath();
            ctx.moveTo(rulerSize - 3.5, q3Sy);
            ctx.lineTo(rulerSize, q3Sy);
            ctx.stroke();
          }
        }

        if (screenMajorStep >= 160) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
          for (let oct = 1; oct < 8; oct += 2) {
            const octSy = sy + (oct / 8) * screenMajorStep;
            if (octSy >= rulerSize && octSy <= h) {
              ctx.beginPath();
              ctx.moveTo(rulerSize - 2.5, octSy);
              ctx.lineTo(rulerSize, octSy);
              ctx.stroke();
            }
          }
        }
      }
    }

    // 6. Top-Left Unit Badge Box [ IN ] / [ CM ] / [ MM ]
    ctx.fillStyle = '#1C1F2B';
    ctx.fillRect(0, 0, rulerSize, rulerSize);
    ctx.strokeStyle = 'rgba(0, 255, 127, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, rulerSize - 1, rulerSize - 1);
    ctx.font = '700 9.5px "JetBrains Mono", Inter, monospace';
    ctx.fillStyle = '#00FF7F';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(unitLabel.toUpperCase(), rulerSize / 2, rulerSize / 2);

    // 7. Real-Time Hairline Cursor Trackers (Figma Precision Blue)
    if (this.currentMouseX && this.currentMouseX >= rulerSize) {
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.currentMouseX, 0);
      ctx.lineTo(this.currentMouseX, rulerSize);
      ctx.stroke();
    }
    if (this.currentMouseY && this.currentMouseY >= rulerSize) {
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, this.currentMouseY);
      ctx.lineTo(rulerSize, this.currentMouseY);
      ctx.stroke();
    }

    ctx.restore();
  }
}
