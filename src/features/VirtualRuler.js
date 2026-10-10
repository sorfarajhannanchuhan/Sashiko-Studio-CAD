/**
 * Sashiko Studio CAD - Virtual Artisan Acrylic Ruler & Protractor Engine
 * 
 * An ultra-premium, physical-grade dual-scale precision drafting instrument:
 * 1. Physical Artisan Acrylic Glass Construction:
 *    - Smoked sapphire/graphite frosted cast-acrylic glass slab (120px height) with high refractive clarity.
 *    - Machined chamfered beveled borders (top specular highlight, bottom ambient depth shadow, 2px inset bevel).
 *    - Physical top light reflection sheen stripe simulating physical studio overhead lighting.
 *    - Subtle 10mm internal architectural alignment grid.
 * 2. Flush Central Protractor Hub (0° to 360°):
 *    - 100% INSIDE the 120px slab with generous 16px margins top & bottom (hubRadius = 44px, ZERO outer bulging).
 *    - Machined rotary bezel with 72 tactile knurled grip notches for fingertip rotary dragging.
 *    - Full 360° precision degree ticks (1°, 5°, 10°, 45° with cyan dot markers).
 *    - Exactly 8 intermediate drafting angles: 30°, 60°, 120°, 150°, 210°, 240°, 300°, 330° (0°, 90°, 180°, 270°/360° excluded).
 *    - Central pivot bushing with neat optical pinhole (see-through center at 0,0) and hairline crosshairs.
 *    - Live digital angle readout in glowing cyan/emerald.
 * 3. Continuous Edge Markings (Zero Occlusion):
 *    - Top edge: Metric (Millimeters & Centimeters) running uninterrupted across the entire ruler length,
 *      floating crisply over the frosted hub.
 *    - Bottom edge: Imperial (Inches & 1/16th fractional subdivisions) running uninterrupted across the entire ruler length.
 *    - Precision laser-etched zero diamond registration notches on top and bottom edges.
 * 4. Two Coordinate Modes:
 *    - Screen-Floating Mode: Fixed pixel scale on glass (for measuring physical screen display).
 *    - Page / Artboard Locked Mode: Anchored to CAD world coordinates (scales & zooms synchronously with artwork).
 * 5. Ultra-Fine Pinpoint Zoom Engine:
 *    - Direct percentage input + micro-nudge buttons (±0.2% and ±1.0%) for sub-millimeter alignment
 *      against a physical steel/acrylic ruler placed on top of 5mm glass + 2mm air gap.
 * 6. CAD History Integration (Undo / Redo):
 *    - Captures ruler translation, rotation, angle nudges, and mode switches in the undo/redo stack.
 * 7. VLC-Style Auto-Hiding Controls (HUD):
 *    - Floating HUD pill that fades out smoothly on inactivity (2500ms) and wakes up immediately on proximity/motion.
 */

export class VirtualRuler {
  constructor(canvas, camera, artLabManager) {
    this.canvas = canvas;
    this.camera = camera;
    this.artLabManager = artLabManager;
    this.ctx = canvas.getContext('2d');

    this.visible = false;
    this.mode = 'screen'; // 'screen' (floating screen pixels) | 'world' (locked to artboard)

    // Dimensions: Ultra-Premium Physical Artisan Acrylic Ruler
    this.lengthMm = 304.8; // Standard 12-inch / 30.5 cm artisan ruler
    this.heightPx = 120;   // 120px thick physical artisan slab
    this.hubRadius = 44;   // Central protractor hub radius (fits flush inside 120px slab with 16px margins, ZERO outer bulging!)

    // Transform (Screen coordinates or World coordinates depending on mode)
    this.x = 560;
    this.y = 280;
    this.angleDeg = 0.0;

    // Interaction State
    this.isDragging = false;
    this.isRotating = false;
    this.dragStart = { x: 0, y: 0 };
    this.startPos = { x: 0, y: 0 };
    this.initialAngle = 0;
    this.startAngleDeg = 0;
    this.isHovered = false;

    // History and State Management
    this.historyManager = null;
    this.onStateChanged = null;

    // VLC Auto-Hide HUD Timer
    this.hudEl = null;
    this.autoHideTimer = null;
    this.isHudFaded = false;

    this.init();
  }

  init() {
    this.buildHudDOM();
    this.bindEvents();

    // Subscribe to Camera render loop
    this.camera.subscribe((ctx, state) => {
      if (this.visible) {
        this.render(ctx, state);
      }
    });
  }

  // --- History & State Serialization (Undo / Redo Support) ---

  serialize() {
    return {
      visible: this.visible,
      mode: this.mode,
      x: this.x,
      y: this.y,
      angleDeg: this.angleDeg
    };
  }

  deserialize(state) {
    if (!state) return;
    if (typeof state.visible === 'boolean') {
      this.visible = state.visible;
      if (this.hudEl) this.hudEl.classList.toggle('hidden', !this.visible);
      const toolBtn = document.getElementById('tool-virtual-ruler');
      if (toolBtn) toolBtn.classList.toggle('active', this.visible);
      const btnPanelRuler = document.getElementById('btn-artlab-toggle-ruler');
      if (btnPanelRuler) btnPanelRuler.classList.toggle('active', this.visible);
      const btnHudRuler = document.getElementById('btn-hud-ruler');
      if (btnHudRuler) btnHudRuler.classList.toggle('active', this.visible);
    }
    if (state.mode) this.mode = state.mode;
    if (typeof state.x === 'number') this.x = state.x;
    if (typeof state.y === 'number') this.y = state.y;
    if (typeof state.angleDeg === 'number') this.angleDeg = state.angleDeg;
    this.updateHudUI();
    this.camera.requestRender();
  }

  notifyStateChanged() {
    if (typeof this.onStateChanged === 'function') {
      this.onStateChanged();
    }
  }

  // --- Dimension & Coordinate Utilities ---

  getRulerLengthPx() {
    if (this.mode === 'screen') {
      const dpr = window.devicePixelRatio || 1;
      const ppi = this.artLabManager ? this.artLabManager.calibratedPPI : 141.2;
      return (this.lengthMm / 25.4) * (ppi / dpr);
    } else {
      // In CAD World coordinates (96 CSS px = 1 inch = 25.4 mm)
      return (this.lengthMm / 25.4) * 96;
    }
  }

  getLocalCoords(clientX, clientY) {
    let px, py;
    if (this.mode === 'world') {
      const world = this.camera.screenToWorld(clientX, clientY);
      px = world.x;
      py = world.y;
    } else {
      const rect = this.canvas.getBoundingClientRect();
      px = clientX - rect.left;
      py = clientY - rect.top;
    }

    const dx = px - this.x;
    const dy = py - this.y;
    const rad = (this.angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    return {
      u: dx * cos + dy * sin,
      v: -dx * sin + dy * cos
    };
  }

  hitTest(clientX, clientY) {
    const { u, v } = this.getLocalCoords(clientX, clientY);
    const halfL = this.getRulerLengthPx() / 2;
    const halfH = this.heightPx / 2;

    const distHub = Math.sqrt(u * u + v * v);
    if (distHub <= this.hubRadius + 3) {
      return 'protractor';
    }
    if (Math.abs(u) <= halfL && Math.abs(v) <= halfH) {
      return 'body';
    }
    return null;
  }

  // --- Mode Switching (Seamless Screen vs Artboard Lock) ---

  setMode(targetMode) {
    if (this.mode === targetMode) return;

    if (targetMode === 'world') {
      // Screen -> World: convert center screen position to world coordinates
      // Since this.x and this.y are in canvas-relative CSS pixels, apply camera inverse transform
      this.x = (this.x - this.camera.panX) / this.camera.zoom;
      this.y = (this.y - this.camera.panY) / this.camera.zoom;
      this.mode = 'world';
    } else {
      // World -> Screen: convert center world position to screen coordinates
      const screenPt = this.camera.worldToScreen(this.x, this.y);
      this.x = screenPt.x;
      this.y = screenPt.y;
      this.mode = 'screen';
    }

    this.updateHudUI();
    this.camera.requestRender();
    this.notifyStateChanged();
  }

  setVisible(show) {
    const prev = this.visible;
    this.visible = !!show;

    if (this.visible && !prev) {
      // Auto-center gracefully within canvas if at default position
      if (this.mode === 'screen') {
        const stageW = this.camera.screenWidth || window.innerWidth;
        const stageH = this.camera.screenHeight || window.innerHeight;
        if (this.x === 560 && this.y === 280) {
          this.x = Math.round(stageW / 2);
          this.y = Math.round(stageH / 2);
        }
      }
    }

    if (this.hudEl) {
      this.hudEl.classList.toggle('hidden', !this.visible);
      if (this.visible) {
        this.resetAutoHideTimer();
        this.updateHudUI();
      }
    }

    // Sync button visual state across toolbars
    const toolBtn = document.getElementById('tool-virtual-ruler');
    if (toolBtn) toolBtn.classList.toggle('active', this.visible);

    const btnPanelRuler = document.getElementById('btn-artlab-toggle-ruler');
    if (btnPanelRuler) btnPanelRuler.classList.toggle('active', this.visible);

    const btnHudRuler = document.getElementById('btn-hud-ruler');
    if (btnHudRuler) btnHudRuler.classList.toggle('active', this.visible);

    this.camera.requestRender();
    if (prev !== this.visible) {
      this.notifyStateChanged();
    }
  }

  toggleVisible() {
    this.setVisible(!this.visible);
  }

  setAngle(deg, notify = false) {
    this.angleDeg = (deg % 360 + 360) % 360;
    const input = document.getElementById('input-ruler-angle');
    if (input && document.activeElement !== input) {
      input.value = this.angleDeg.toFixed(1);
    }
    this.camera.requestRender();
    if (notify) {
      this.notifyStateChanged();
    }
  }

  // --- Ultra-Fine Pinpoint Zoom Calibration ---

  nudgeZoom(percentageDelta) {
    const currentZoom = this.camera.zoom;
    const newZoom = Math.max(0.05, Math.min(currentZoom * (1 + percentageDelta / 100), 5.0));

    // Zoom anchored at viewport center
    const centerX = this.camera.screenWidth / 2;
    const centerY = this.camera.screenHeight / 2;

    this.camera.panX = centerX - (centerX - this.camera.panX) * (newZoom / currentZoom);
    this.camera.panY = centerY - (centerY - this.camera.panY) * (newZoom / currentZoom);
    this.camera.zoom = newZoom;

    this.camera.updateZoomHUD();
    this.updateHudUI();
    this.camera.requestRender();
  }

  setZoomPercentage(percent) {
    const val = parseFloat(percent);
    if (isNaN(val) || val <= 0) return;
    const targetZoom = val / 100;
    const currentZoom = this.camera.zoom;

    const centerX = this.camera.screenWidth / 2;
    const centerY = this.camera.screenHeight / 2;

    this.camera.panX = centerX - (centerX - this.camera.panX) * (targetZoom / currentZoom);
    this.camera.panY = centerY - (centerY - this.camera.panY) * (targetZoom / currentZoom);
    this.camera.zoom = targetZoom;

    this.camera.updateZoomHUD();
    this.updateHudUI();
    this.camera.requestRender();
  }

  // --- Rendering Pipeline ---

  render(ctx, cameraState) {
    if (!this.visible) return;

    ctx.save();
    if (this.mode === 'world') {
      // World coordinates: camera transform is already applied on ctx
      ctx.translate(this.x, this.y);
      ctx.rotate((this.angleDeg * Math.PI) / 180);
      this.drawRulerBody(ctx, 1.0);
    } else {
      // Screen coordinates: reset matrix to pure CSS pixel viewport
      const dpr = cameraState.dpr || window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.translate(this.x, this.y);
      ctx.rotate((this.angleDeg * Math.PI) / 180);
      this.drawRulerBody(ctx, dpr);
    }
    ctx.restore();
  }

  drawRulerBody(ctx, dpr) {
    const len = this.getRulerLengthPx();
    const halfL = len / 2;
    const halfH = this.heightPx / 2; // 60px

    // 1. Physical Cast Acrylic Drop Shadow (Multi-stage soft ambient shadow)
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    ctx.shadowOffsetX = 0;

    // 2. Acrylic Slab Base Gradient (Ultra-clean smoked sapphire/graphite frosted glass)
    const bgGrad = ctx.createLinearGradient(0, -halfH, 0, halfH);
    bgGrad.addColorStop(0.00, 'rgba(15, 23, 42, 0.90)');   // Upper polished bevel edge
    bgGrad.addColorStop(0.08, 'rgba(28, 42, 65, 0.76)');   // Refraction index highlight
    bgGrad.addColorStop(0.25, 'rgba(15, 23, 42, 0.68)');   // Optical see-through acrylic body
    bgGrad.addColorStop(0.75, 'rgba(15, 23, 42, 0.68)');   // Optical see-through acrylic body
    bgGrad.addColorStop(0.92, 'rgba(28, 42, 65, 0.78)');   // Lower refraction band
    bgGrad.addColorStop(1.00, 'rgba(15, 23, 42, 0.92)');   // Lower edge bevel

    ctx.fillStyle = bgGrad;
    ctx.strokeStyle = this.mode === 'world' ? 'rgba(56, 189, 248, 0.85)' : 'rgba(56, 189, 248, 0.50)';
    ctx.lineWidth = this.mode === 'world' ? 1.6 : 1.2;

    const cornerRadius = 8;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(-halfL, -halfH, len, this.heightPx, cornerRadius);
    } else {
      ctx.rect(-halfL, -halfH, len, this.heightPx);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 3. Physical Polished Beveled Borders (Top chamfer highlight & bottom depth shadow)
    ctx.save();
    // Top highlight bevel line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(-halfL + cornerRadius, -halfH + 0.5);
    ctx.lineTo(halfL - cornerRadius, -halfH + 0.5);
    ctx.stroke();

    // Bottom depth shadow line
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.70)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-halfL + cornerRadius, halfH - 0.5);
    ctx.lineTo(halfL - cornerRadius, halfH - 0.5);
    ctx.stroke();

    // Inset precision perimeter bevel hairline (2px inset)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(-halfL + 2, -halfH + 2, len - 4, this.heightPx - 4, cornerRadius - 2);
    } else {
      ctx.rect(-halfL + 2, -halfH + 2, len - 4, this.heightPx - 4);
    }
    ctx.stroke();

    // 4. Subtle Top Light Reflection Stripe (Physical acrylic specular sheen)
    const glintGrad = ctx.createLinearGradient(0, -halfH + 2, 0, -halfH + 24);
    glintGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0.16)');
    glintGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.08)');
    glintGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.00)');
    ctx.fillStyle = glintGrad;
    ctx.fillRect(-halfL + 4, -halfH + 2, len - 8, 22);

    // Subtle faint internal architectural alignment grid lines (10mm interval grid inside acrylic body)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.06)';
    ctx.lineWidth = 0.5;
    const mmStep = len / this.lengthMm;
    const totalCm = Math.floor(this.lengthMm / 10);
    ctx.beginPath();
    for (let c = 1; c < totalCm; c++) {
      const gx = -halfL + c * 10 * mmStep;
      // Skip lines inside the protractor hub area to keep hub pristine
      if (Math.abs(gx) > this.hubRadius + 2) {
        ctx.moveTo(gx, -halfH + 18);
        ctx.lineTo(gx, halfH - 22);
      }
    }
    // Horizontal center alignment guide
    ctx.moveTo(-halfL + 12, 0);
    ctx.lineTo(-this.hubRadius - 4, 0);
    ctx.moveTo(this.hubRadius + 4, 0);
    ctx.lineTo(halfL - 12, 0);
    ctx.stroke();
    ctx.restore();

    // 5. Central Protractor Hub (Drawn first so metric/imperial edge markings blend continuously over it!)
    this.drawProtractorHub(ctx);

    // 6. Metric Scale (Top Edge, v = -halfH) - Runs continuously across entire length!
    this.drawMetricScale(ctx, halfL, halfH);

    // 7. Imperial Scale (Bottom Edge, v = +halfH) - Runs continuously across entire length!
    this.drawImperialScale(ctx, halfL, halfH);

    // 8. Center Zero Registration Marks & Alignment Indicators
    ctx.save();
    // Top edge zero alignment diamond notch
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.moveTo(0, -halfH);
    ctx.lineTo(3.5, -halfH + 4);
    ctx.lineTo(0, -halfH + 8);
    ctx.lineTo(-3.5, -halfH + 4);
    ctx.closePath();
    ctx.fill();

    // Bottom edge zero alignment diamond notch
    ctx.beginPath();
    ctx.moveTo(0, halfH);
    ctx.lineTo(3.5, halfH - 4);
    ctx.lineTo(0, halfH - 8);
    ctx.lineTo(-3.5, halfH - 4);
    ctx.closePath();
    ctx.fill();

    // Registration hairline along Y axis connecting to hub
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -halfH + 8); ctx.lineTo(0, -this.hubRadius);
    ctx.moveTo(0, this.hubRadius); ctx.lineTo(0, halfH - 8);
    ctx.stroke();
    ctx.restore();
  }

  drawMetricScale(ctx, halfL, halfH) {
    const mmStep = this.getRulerLengthPx() / this.lengthMm;
    const totalMm = Math.floor(this.lengthMm);

    ctx.save();
    ctx.font = '700 9px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Markings run continuously across the entire ruler length!
    for (let mm = 0; mm <= totalMm; mm++) {
      const u = -halfL + mm * mmStep;
      if (u > halfL) break;

      const isCm = (mm % 10 === 0);
      const is5Mm = (mm % 5 === 0);

      const tickLen = isCm ? 17 : (is5Mm ? 11 : 6.0);
      const tickColor = isCm ? '#38BDF8' : (is5Mm ? 'rgba(241, 245, 249, 0.88)' : 'rgba(148, 163, 184, 0.50)');

      ctx.strokeStyle = tickColor;
      ctx.lineWidth = isCm ? 1.5 : (is5Mm ? 1.0 : 0.75);

      ctx.beginPath();
      ctx.moveTo(u, -halfH);
      ctx.lineTo(u, -halfH + tickLen);
      ctx.stroke();

      if (isCm && mm > 0 && mm < totalMm) {
        ctx.fillStyle = '#F8FAFC';
        ctx.fillText(`${mm / 10}`, u, -halfH + 19);
      }
    }

    // Metric Label Badge on left corner
    ctx.font = '800 8.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#38BDF8';
    ctx.textAlign = 'left';
    ctx.fillText('METRIC (cm/mm)', -halfL + 8, -halfH + 20);
    ctx.restore();
  }

  drawImperialScale(ctx, halfL, halfH) {
    const totalInches = this.lengthMm / 25.4;
    const inchStep = (this.getRulerLengthPx() / this.lengthMm) * 25.4;
    const step16 = inchStep / 16;
    const total16th = Math.floor(totalInches * 16);

    ctx.save();
    ctx.font = '800 9.5px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Markings run continuously across the entire ruler length!
    for (let i = 0; i <= total16th; i++) {
      const u = -halfL + i * step16;
      if (u > halfL) break;

      let tickLen = 4.5;
      let tickColor = 'rgba(148, 163, 184, 0.40)';
      let width = 0.65;
      const isInch = (i % 16 === 0);

      if (isInch) {
        tickLen = 18;
        tickColor = '#38BDF8';
        width = 1.6;
      } else if (i % 8 === 0) {
        tickLen = 14;
        tickColor = 'rgba(241, 245, 249, 0.90)';
        width = 1.2;
      } else if (i % 4 === 0) {
        tickLen = 10;
        tickColor = 'rgba(226, 232, 240, 0.75)';
        width = 1.0;
      } else if (i % 2 === 0) {
        tickLen = 7;
        tickColor = 'rgba(148, 163, 184, 0.55)';
        width = 0.8;
      }

      ctx.strokeStyle = tickColor;
      ctx.lineWidth = width;

      ctx.beginPath();
      ctx.moveTo(u, halfH);
      ctx.lineTo(u, halfH - tickLen);
      ctx.stroke();

      if (isInch && i > 0 && u <= halfL - 14) {
        ctx.fillStyle = '#F8FAFC';
        ctx.fillText(`${i / 16}"`, u, halfH - 21);
      }
    }

    // Imperial Label Badge on left corner
    ctx.font = '800 8.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#38BDF8';
    ctx.textAlign = 'left';
    ctx.fillText('INCHES (1/16)', -halfL + 8, halfH - 9);
    ctx.restore();
  }

  drawProtractorHub(ctx) {
    const r = this.hubRadius; // 44px
    ctx.save();

    // 1. Frosted Translucent Rotary Dial Plate
    const hubGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, r);
    hubGrad.addColorStop(0.0, 'rgba(15, 23, 42, 0.78)');
    hubGrad.addColorStop(0.55, 'rgba(28, 42, 65, 0.62)');
    hubGrad.addColorStop(0.88, 'rgba(30, 41, 59, 0.48)');
    hubGrad.addColorStop(1.0, 'rgba(56, 189, 248, 0.22)');

    ctx.fillStyle = hubGrad;
    ctx.strokeStyle = this.isRotating ? '#00FF7F' : 'rgba(56, 189, 248, 0.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 2. Machined Rotary Bezel with Tactile Knurled Grip Notches
    // 72 radial knurling teeth around the outer perimeter (r = 41.5 to 44)
    const knurlCount = 72;
    ctx.save();
    for (let k = 0; k < knurlCount; k++) {
      const rad = (k * 2 * Math.PI) / knurlCount;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rInner = r - 2.8;
      const rOuter = r - 0.5;

      ctx.strokeStyle = (k % 2 === 0) 
        ? 'rgba(255, 255, 255, 0.38)' 
        : 'rgba(10, 16, 26, 0.75)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(cos * rInner, sin * rInner);
      ctx.lineTo(cos * rOuter, sin * rOuter);
      ctx.stroke();
    }
    ctx.restore();

    // Inner concentric guide track (degree base line)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, r - 3.5, 0, Math.PI * 2);
    ctx.stroke();

    // Second concentric track for angle label baseline
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.stroke();

    // 3. Crosshair Guide Lines along Cardinal Axes (with gap around center pinhole)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-r + 4, 0); ctx.lineTo(-14, 0);
    ctx.moveTo(14, 0); ctx.lineTo(r - 4, 0);
    ctx.moveTo(0, -r + 4); ctx.lineTo(0, -14);
    ctx.moveTo(0, 14); ctx.lineTo(0, r - 4);
    ctx.stroke();

    // 4. Protractor Degree Markings (Full 360° precision)
    const tickBaseR = r - 3.5;
    for (let deg = 0; deg < 360; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      const isCardinal = (deg % 90 === 0);
      const is45 = (deg % 45 === 0);
      const is30 = (deg % 30 === 0);
      const is10 = (deg % 10 === 0);

      let tickLen = 2.8;
      let tickColor = 'rgba(255, 255, 255, 0.25)';
      let width = 0.65;

      if (isCardinal) {
        tickLen = 7.0;
        tickColor = '#38BDF8';
        width = 1.4;
      } else if (is45) {
        tickLen = 5.8;
        tickColor = '#38BDF8';
        width = 1.2;
      } else if (is30) {
        tickLen = 5.0;
        tickColor = 'rgba(241, 245, 249, 0.92)';
        width = 1.0;
      } else if (is10) {
        tickLen = 3.8;
        tickColor = 'rgba(148, 163, 184, 0.70)';
        width = 0.8;
      }

      const cos = Math.cos(rad);
      const sin = -Math.sin(rad); // Standard polar coordinate: 0° East, 90° North
      const x1 = cos * (tickBaseR - tickLen);
      const y1 = sin * (tickBaseR - tickLen);
      const x2 = cos * tickBaseR;
      const y2 = sin * tickBaseR;

      ctx.strokeStyle = tickColor;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Subtle cyan dot marker at each 45° diagonal
      if (is45 && !isCardinal) {
        ctx.fillStyle = '#38BDF8';
        ctx.beginPath();
        ctx.arc(cos * (tickBaseR - 8.5), sin * (tickBaseR - 8.5), 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 5. Exactly 8 Intermediate Drafting Angles (Excluding 0°, 90°, 180°, 270°/360°)
    // Symmetrical 30°/60° industrial drafting set (2 per quadrant, perfectly balanced):
    // Q1: 30°, 60° | Q2: 120°, 150° | Q3: 210°, 240° | Q4: 300°, 330°
    const intermediateAngles = [30, 60, 120, 150, 210, 240, 300, 330];
    ctx.font = '700 7px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textRadius = 26.5;
    for (const deg of intermediateAngles) {
      const rad = (deg * Math.PI) / 180;
      const tx = Math.cos(rad) * textRadius;
      const ty = -Math.sin(rad) * textRadius;

      ctx.fillStyle = (deg % 60 === 0) ? '#38BDF8' : 'rgba(241, 245, 249, 0.95)';
      ctx.fillText(`${deg}°`, tx, ty);
    }

    // 6. Central Rotary Pivot Bushing & Neat Optical Pinhole
    const pivotR = 13.5;
    const pinholeR = 4.0;

    // Dark graphite metallic pivot bushing ring
    const bushingGrad = ctx.createRadialGradient(0, 0, pinholeR, 0, 0, pivotR);
    bushingGrad.addColorStop(0.0, 'rgba(10, 16, 26, 0.95)');
    bushingGrad.addColorStop(0.7, 'rgba(20, 30, 48, 0.95)');
    bushingGrad.addColorStop(1.0, 'rgba(15, 23, 42, 0.98)');

    ctx.fillStyle = bushingGrad;
    ctx.strokeStyle = this.isRotating ? '#00FF7F' : 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, 0, pivotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Central Live Angle Readout in glowing Cyan / Emerald
    ctx.font = '700 8.5px "JetBrains Mono", monospace';
    ctx.fillStyle = this.isRotating ? '#00FF7F' : '#38BDF8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${this.angleDeg.toFixed(1)}°`, 0, -0.5);

    // Neat Central Optical Pinhole (Cutout circle with precision bezel ring at 0,0)
    ctx.strokeStyle = this.isRotating ? '#00FF7F' : 'rgba(56, 189, 248, 0.95)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.arc(0, 0, pinholeR, 0, Math.PI * 2);
    ctx.stroke();

    // Hairline crosshairs inside the pinhole
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-pinholeR - 2.5, 0); ctx.lineTo(-pinholeR, 0);
    ctx.moveTo(pinholeR, 0); ctx.lineTo(pinholeR + 2.5, 0);
    ctx.moveTo(0, -pinholeR - 2.5); ctx.lineTo(0, -pinholeR);
    ctx.moveTo(0, pinholeR); ctx.lineTo(0, pinholeR + 2.5);
    ctx.stroke();

    // 7. Rotary Drag Accent & Active Dragging Needle
    if (this.isRotating) {
      // Outer active emerald knurling glow
      ctx.strokeStyle = 'rgba(0, 255, 127, 0.65)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // Sleek dashed outer accent
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  // --- VLC-Style Auto-Hiding Controls HUD ---

  buildHudDOM() {
    const existing = document.getElementById('virtual-ruler-hud');
    if (existing) existing.remove();

    const hud = document.createElement('div');
    hud.className = 'virtual-ruler-hud hidden';
    hud.id = 'virtual-ruler-hud';
    hud.innerHTML = `
      <div class="ruler-hud-pill">
        <span class="hud-pill-title">📐 ARTISAN RULER</span>
        
        <div class="hud-divider"></div>
        
        <!-- Mode Switch: Screen vs World -->
        <div class="pill-group sm" title="Ruler Coordinate Mode">
          <button class="pill-btn sm active" id="btn-ruler-mode-screen" title="Screen Mode (Fixed pixel scale on glass)">Screen</button>
          <button class="pill-btn sm" id="btn-ruler-mode-world" title="Locked Mode (Zooms and scales with CAD artboard)">Locked</button>
        </div>

        <div class="hud-divider"></div>

        <!-- Angle Input & Nudge -->
        <div class="ruler-angle-box" title="Rotate Ruler Angle (Ctrl + Wheel on ruler)">
          <span class="hud-label">∠</span>
          <input type="number" id="input-ruler-angle" class="ruler-num-input" value="0.0" step="0.5" min="0" max="360" title="Type exact angle">
          <span class="hud-unit">°</span>
          <button class="btn-micro-nudge" id="btn-ruler-rot-zero" title="Reset angle to 0°">0°</button>
          <button class="btn-micro-nudge" id="btn-ruler-rot-45" title="Rotate +45°">+45°</button>
          <button class="btn-micro-nudge" id="btn-ruler-rot-90" title="Rotate +90°">+90°</button>
        </div>

        <div class="hud-divider"></div>

        <!-- Ultra-Fine Pinpoint Zoom Calibration -->
        <div class="ruler-zoom-box" title="Micro-nudge canvas zoom to match physical ruler">
          <span class="hud-label">Zoom:</span>
          <input type="text" id="input-pinpoint-zoom" class="ruler-num-input" value="100.0%" title="Type exact zoom percentage">
          <button class="btn-micro-nudge" id="btn-zoom-micro-minus" title="Micro Nudge -0.2%">▼ 0.2%</button>
          <button class="btn-micro-nudge" id="btn-zoom-micro-plus" title="Micro Nudge +0.2%">▲ 0.2%</button>
          <button class="btn-micro-nudge" id="btn-zoom-step-minus" title="Step -1.0%">−1%</button>
          <button class="btn-micro-nudge" id="btn-zoom-step-plus" title="Step +1.0%">+1%</button>
          <button class="btn-micro-nudge highlight" id="btn-ruler-lock-scale" title="Lock 1:1 Scale to Physical Screen">🔒 1:1</button>
        </div>

        <div class="hud-divider"></div>

        <button class="btn-ruler-close" id="btn-close-ruler" title="Hide Artisan Ruler (R)">✕</button>
      </div>
    `;

    document.getElementById('canvas-stage')?.appendChild(hud);
    this.hudEl = hud;
  }

  resetAutoHideTimer() {
    if (!this.hudEl || !this.visible) return;

    this.hudEl.classList.remove('faded');
    clearTimeout(this.autoHideTimer);

    this.autoHideTimer = setTimeout(() => {
      // Auto-hide if mouse is not hovering directly over the HUD, not dragging, and not rotating
      if (!this.hudEl.matches(':hover') && !this.isDragging && !this.isRotating) {
        this.hudEl.classList.add('faded');
      }
    }, 2500);
  }

  updateHudUI() {
    if (!this.hudEl) return;

    // Mode buttons
    const btnScreen = document.getElementById('btn-ruler-mode-screen');
    const btnWorld = document.getElementById('btn-ruler-mode-world');
    if (btnScreen) btnScreen.classList.toggle('active', this.mode === 'screen');
    if (btnWorld) btnWorld.classList.toggle('active', this.mode === 'world');

    // Angle input
    const inputAngle = document.getElementById('input-ruler-angle');
    if (inputAngle && document.activeElement !== inputAngle) {
      inputAngle.value = this.angleDeg.toFixed(1);
    }

    // Zoom input
    const inputZoom = document.getElementById('input-pinpoint-zoom');
    if (inputZoom && document.activeElement !== inputZoom) {
      inputZoom.value = `${(this.camera.zoom * 100).toFixed(1)}%`;
    }
  }

  // --- Interaction & Event Binding ---

  bindEvents() {
    const stage = document.getElementById('canvas-stage');
    if (!stage) return;

    // Pointer down on canvas for ruler dragging and rotary knob
    stage.addEventListener('pointerdown', (e) => {
      if (!this.visible || e.button !== 0) return;
      const hit = this.hitTest(e.clientX, e.clientY);
      if (!hit) return;

      e.stopPropagation();
      e.preventDefault();
      this.resetAutoHideTimer();

      if (hit === 'protractor') {
        this.isRotating = true;
        let px, py;
        if (this.mode === 'world') {
          const world = this.camera.screenToWorld(e.clientX, e.clientY);
          px = world.x;
          py = world.y;
        } else {
          const rect = this.canvas.getBoundingClientRect();
          px = e.clientX - rect.left;
          py = e.clientY - rect.top;
        }
        // Calculate pointer angle in unrotated stage space relative to ruler pivot
        this.initialPointerAngle = Math.atan2(py - this.y, px - this.x) * (180 / Math.PI);
        this.startAngleDeg = this.angleDeg;
      } else {
        this.isDragging = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.startPos = { x: this.x, y: this.y };
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.visible) return;

      const hit = this.hitTest(e.clientX, e.clientY);
      this.isHovered = !!hit;
      if (hit) this.resetAutoHideTimer();

      // Dynamic cursor affordance
      if (this.isRotating || hit === 'protractor') {
        this.canvas.style.cursor = 'crosshair';
      } else if (this.isDragging) {
        this.canvas.style.cursor = 'grabbing';
      } else if (hit === 'body') {
        this.canvas.style.cursor = 'grab';
      } else if (!this.camera.spacePressed && !this.camera.isPanning) {
        this.canvas.style.cursor = 'default';
      }

      if (this.isDragging) {
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        if (this.mode === 'world') {
          this.x = this.startPos.x + dx / this.camera.zoom;
          this.y = this.startPos.y + dy / this.camera.zoom;
        } else {
          let newX = this.startPos.x + dx;
          let newY = this.startPos.y + dy;
          // Clamp to screen bounds so ruler is never permanently lost off-screen
          const dpr = window.devicePixelRatio || 1;
          const maxW = this.canvas.width / dpr;
          const maxH = this.canvas.height / dpr;
          this.x = Math.max(40, Math.min(newX, maxW - 40));
          this.y = Math.max(30, Math.min(newY, maxH - 30));
        }
        this.camera.requestRender();
      } else if (this.isRotating) {
        let px, py;
        if (this.mode === 'world') {
          const world = this.camera.screenToWorld(e.clientX, e.clientY);
          px = world.x;
          py = world.y;
        } else {
          const rect = this.canvas.getBoundingClientRect();
          px = e.clientX - rect.left;
          py = e.clientY - rect.top;
        }
        const currentPointerAngle = Math.atan2(py - this.y, px - this.x) * (180 / Math.PI);
        let delta = currentPointerAngle - this.initialPointerAngle;
        // Normalize delta to [-180, 180] to eliminate atan2 branch-cut 360° spin flip
        delta = ((delta + 180) % 360 + 360) % 360 - 180;
        let newAngle = ((this.startAngleDeg + delta) % 360 + 360) % 360;

        if (e.shiftKey) {
          // Snap to 15° intervals
          newAngle = Math.round(newAngle / 15) * 15;
        }
        this.setAngle(newAngle);
      }
    });

    window.addEventListener('pointerup', () => {
      if (this.isDragging || this.isRotating) {
        const moved = Math.hypot(this.x - this.startPos.x, this.y - this.startPos.y) > 0.5;
        const rotated = Math.abs(this.angleDeg - this.startAngleDeg) > 0.05;
        this.isDragging = false;
        this.isRotating = false;
        if (this.canvas && !this.camera.spacePressed && !this.camera.isPanning) {
          this.canvas.style.cursor = 'default';
        }
        this.resetAutoHideTimer();
        if (moved || rotated) {
          this.notifyStateChanged();
        }
      }
    });

    // Ctrl + MouseWheel rotation when cursor is over ruler (Captured before camera zooms)
    let wheelDebounce = null;
    stage.addEventListener('wheel', (e) => {
      if (!this.visible) return;
      const hit = this.hitTest(e.clientX, e.clientY);
      if (hit && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.resetAutoHideTimer();
        const step = e.shiftKey ? 15.0 : (e.altKey ? 0.1 : 0.5);
        const dir = e.deltaY > 0 ? 1 : -1;
        this.setAngle(this.angleDeg + dir * step);
        clearTimeout(wheelDebounce);
        wheelDebounce = setTimeout(() => {
          this.notifyStateChanged();
        }, 300);
      }
    }, { capture: true, passive: false });

    // Cursor proximity detection to wake up HUD (VLC player style)
    window.addEventListener('mousemove', (e) => {
      if (!this.visible || !this.hudEl) return;
      // Proximity to top where HUD lives (top 100px of screen)
      if (e.clientY <= 90) {
        this.resetAutoHideTimer();
      }
    });

    // Wire HUD Elements
    document.getElementById('btn-ruler-mode-screen')?.addEventListener('click', () => {
      this.setMode('screen');
    });

    document.getElementById('btn-ruler-mode-world')?.addEventListener('click', () => {
      this.setMode('world');
    });

    // Angle quick buttons
    document.getElementById('btn-ruler-rot-zero')?.addEventListener('click', () => this.setAngle(0, true));
    document.getElementById('btn-ruler-rot-45')?.addEventListener('click', () => this.setAngle(this.angleDeg + 45, true));
    document.getElementById('btn-ruler-rot-90')?.addEventListener('click', () => this.setAngle(this.angleDeg + 90, true));

    // Direct angle input
    const inputAngle = document.getElementById('input-ruler-angle');
    if (inputAngle) {
      inputAngle.addEventListener('change', (e) => {
        this.setAngle(parseFloat(e.target.value) || 0, true);
      });
      inputAngle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.setAngle(parseFloat(e.target.value) || 0, true);
          inputAngle.blur();
        }
      });
    }

    // Micro-nudge zoom buttons
    document.getElementById('btn-zoom-micro-minus')?.addEventListener('click', () => this.nudgeZoom(-0.2));
    document.getElementById('btn-zoom-micro-plus')?.addEventListener('click', () => this.nudgeZoom(0.2));
    document.getElementById('btn-zoom-step-minus')?.addEventListener('click', () => this.nudgeZoom(-1.0));
    document.getElementById('btn-zoom-step-plus')?.addEventListener('click', () => this.nudgeZoom(1.0));

    // Direct zoom input
    const inputZoom = document.getElementById('input-pinpoint-zoom');
    if (inputZoom) {
      inputZoom.addEventListener('change', (e) => {
        this.setZoomPercentage(e.target.value);
      });
      inputZoom.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.setZoomPercentage(e.target.value);
          inputZoom.blur();
        }
      });
    }

    // 1:1 Scale Lock from ruler
    document.getElementById('btn-ruler-lock-scale')?.addEventListener('click', () => {
      if (this.artLabManager) {
        this.artLabManager.lockRealScale();
        this.updateHudUI();
      }
    });

    // Close button
    document.getElementById('btn-close-ruler')?.addEventListener('click', () => {
      this.setVisible(false);
    });
  }
}
