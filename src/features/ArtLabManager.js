/**
 * Sashiko Studio CAD - Art Lab & Physical Screen Tracing Manager
 * 
 * Features:
 * 1. Physical Screen Scale Calibrator (Hardware PPI calibration for 1:1 true physical tracing on laptop glass).
 * 2. 1/4 Cushion Quadrant Tracing Wizard (Q1, Q2, Q3, Q4 with auto 90° rotation and registration crosshairs).
 * 3. Fabric Light Penetration Engine (Optics presets for Raw/Light, Dark Indigo "Neon Punch", and Jet Black fabrics).
 * 4. Air-Gap Thickness Compensator (0.5" glass gap stroke weight booster).
 * 5. Fullscreen Lightbox with Screen Touch/Click Protection.
 */

export class ArtLabManager {
  constructor(camera, latticeGrid, partitionEngine, stitchPen, opticsEngine, layerManager) {
    this.camera = camera;
    this.latticeGrid = latticeGrid;
    this.partitionEngine = partitionEngine;
    this.stitchPen = stitchPen;
    this.opticsEngine = opticsEngine;
    this.layerManager = layerManager;

    // Load saved PPI or default to standard 15.6" laptop (141.2 PPI)
    const savedPPI = localStorage.getItem('sashiko_screen_ppi');
    this.calibratedPPI = savedPPI ? parseFloat(savedPPI) : 141.2;

    this.activeQuadrant = null; // null = Full View, 1 = Q1, 2 = Q2, 3 = Q3, 4 = Q4
    this.quadrantRotation = 0; // 0, 90, 180, 270 degrees
    this.showLaserCrosshair = true;
    this.strokeBoost = 1.6; // Default 1.6x stroke width for 0.5" air-gap penetration
    this.fabricMode = 'indigo'; // 'light' | 'indigo' | 'black'
    this.isLightboxActive = false;
    this.isTraceLocked = false;
    this.wakeLockSentinel = null;

    // Laser crosshair registration point in world coordinates
    this.laserPoint = { x: 0, y: 0 };

    this.init();
  }

  init() {
    this.camera.artLabManager = this;
    this.bindPanelEvents();
    this.bindLightboxEvents();
    this.updateCalibrationBar();

    // Subscribe to Camera render loop to draw laser registration crosshairs on main canvas
    this.camera.subscribe((ctx, state) => {
      if (this.showLaserCrosshair && (this.activeQuadrant !== null || this.isLightboxActive)) {
        this.renderLaserCrosshair(ctx, state);
      }
    });
  }

  // --- 1. Physical Scale & Hardware PPI Calibration ---

  setCalibratedPPI(ppi) {
    this.calibratedPPI = Math.max(72, Math.min(300, parseFloat(ppi) || 141.2));
    localStorage.setItem('sashiko_screen_ppi', this.calibratedPPI.toString());
    this.updateCalibrationBar();
  }

  updateCalibrationBar() {
    const inputPPI = document.getElementById('input-screen-ppi');
    const valPPI = document.getElementById('val-screen-ppi');
    const calibBar = document.getElementById('ruler-calib-bar');

    if (inputPPI) inputPPI.value = this.calibratedPPI;
    if (valPPI) valPPI.textContent = `${this.calibratedPPI.toFixed(1)} PPI`;

    // 3 inches in physical screen CSS pixels = (3 * 96) scaled by display
    if (calibBar) {
      // CSS width that on this screen represents 3.0 physical inches
      // Browser renders 1 CSS inch as 96 CSS px.
      // If the hardware has `calibratedPPI`, 3 real inches = (3 * 96) * (96 / calibratedPPI) px
      const pxFor3Inches = 3.0 * (96 * (96 / this.calibratedPPI));
      calibBar.style.width = `${Math.round(pxFor3Inches)}px`;
    }
  }

  lockRealScale() {
    // Zoom factor required so 1 CAD inch (96px) occupies exactly 1 real physical inch on this screen
    // On screen: 1 physical inch = calibratedPPI device pixels = (calibratedPPI / dpr) CSS px
    const dpr = window.devicePixelRatio || 1;
    const truePhysicalZoom = (this.calibratedPPI / (96 * dpr));

    this.camera.zoom = truePhysicalZoom;
    this.camera.updateZoomHUD();

    if (this.activeQuadrant) {
      this.focusQuadrant(this.activeQuadrant, false);
    } else {
      this.camera.centerCushion();
    }

    const badge = document.getElementById('badge-artlab-scale');
    if (badge) {
      badge.textContent = `1:1 Locked (${this.calibratedPPI.toFixed(0)} PPI)`;
      badge.classList.add('highlight');
    }

    this.camera.requestRender();
  }

  // --- 2. 1/4 Cushion Quadrant Tracing Wizard ---

  focusQuadrant(quadNum, adjustZoom = true) {
    this.activeQuadrant = quadNum;
    const artW = this.camera.artboardWidthPx;
    const artH = this.camera.artboardHeightPx;
    const halfW = artW / 2;
    const halfH = artH / 2;

    let centerX = artW / 2;
    let centerY = artH / 2;

    if (quadNum === 1) { // Top-Left
      centerX = halfW / 2;
      centerY = halfH / 2;
      this.laserPoint = { x: halfW, y: halfH };
    } else if (quadNum === 2) { // Top-Right
      centerX = halfW + halfW / 2;
      centerY = halfH / 2;
      this.laserPoint = { x: halfW, y: halfH };
    } else if (quadNum === 3) { // Bottom-Left
      centerX = halfW / 2;
      centerY = halfH + halfH / 2;
      this.laserPoint = { x: halfW, y: halfH };
    } else if (quadNum === 4) { // Bottom-Right
      centerX = halfW + halfW / 2;
      centerY = halfH + halfH / 2;
      this.laserPoint = { x: halfW, y: halfH };
    } else {
      // Full view
      this.activeQuadrant = null;
      this.laserPoint = { x: artW / 2, y: artH / 2 };
      this.camera.centerCushion();
      this.updateQuadrantUI();
      return;
    }

    if (adjustZoom) {
      // Fit quadrant to screen with comfortable margins
      const stageW = this.camera.screenWidth;
      const stageH = this.camera.screenHeight;
      const maxW = stageW * 0.82;
      const maxH = stageH * 0.82;
      this.camera.zoom = Math.min(maxW / halfW, maxH / halfH);
    }

    this.camera.panX = (this.camera.screenWidth / 2) - centerX * this.camera.zoom;
    this.camera.panY = (this.camera.screenHeight / 2) - centerY * this.camera.zoom;
    this.camera.updateZoomHUD();
    this.camera.requestRender();

    this.updateQuadrantUI();
    if (this.isLightboxActive) {
      this.renderLightboxView();
    }
  }

  rotateQuadrant(deltaDeg = 90) {
    this.quadrantRotation = (this.quadrantRotation + deltaDeg) % 360;
    this.camera.requestRender();
    if (this.isLightboxActive) {
      this.renderLightboxView();
    }
  }

  updateQuadrantUI() {
    document.querySelectorAll('.btn-quadrant').forEach(btn => {
      const q = parseInt(btn.dataset.quad, 10);
      btn.classList.toggle('active', q === this.activeQuadrant);
    });
    document.querySelectorAll('.btn-hud-quad').forEach(btn => {
      const q = btn.dataset.quad === 'full' ? null : parseInt(btn.dataset.quad, 10);
      btn.classList.toggle('active', q === this.activeQuadrant);
    });
  }

  // --- 3. Fabric Light Penetration & Optics Presets ---

  applyFabricPreset(presetKey) {
    this.fabricMode = presetKey;

    if (presetKey === 'light') {
      // White / Raw Cotton: Crisp black stitches on pure white illuminated paper
      this.opticsEngine.setCustomColors('#FFFFFF', '#090A0D');
      this.camera.artboardBg = '#FFFFFF';
      this.opticsEngine.stitchWidth = 2.0 * this.strokeBoost;
      this.opticsEngine.neonGlow = false;
    } else if (presetKey === 'indigo') {
      // Traditional Indigo Denim: Pitch Black background (zero glare) + Ultra-luminous Neon Cyan stitches
      this.opticsEngine.setCustomColors('#000000', '#00FFFF');
      this.camera.artboardBg = '#000000';
      this.opticsEngine.stitchWidth = 2.4 * this.strokeBoost;
      this.opticsEngine.neonGlow = true;
    } else if (presetKey === 'photopic-lime') {
      // 555nm Peak Photopic Lime: Maximum eye sensitivity & photon penetration through dense indigo denim
      this.opticsEngine.setCustomColors('#000000', '#39FF14');
      this.camera.artboardBg = '#000000';
      this.opticsEngine.stitchWidth = 2.6 * this.strokeBoost;
      this.opticsEngine.neonGlow = true;
    } else if (presetKey === 'black') {
      // Jet Black Cloth: Pitch Black background + Pure White High-Lumens Stitches
      this.opticsEngine.setCustomColors('#000000', '#FFFFFF');
      this.camera.artboardBg = '#000000';
      this.opticsEngine.stitchWidth = 2.8 * this.strokeBoost;
      this.opticsEngine.neonGlow = true;
    }

    // Sync UI swatch visuals if swatches exist
    const swatchFill = document.getElementById('swatch-fill-box');
    const swatchStroke = document.getElementById('swatch-stroke-box');
    if (swatchFill) swatchFill.style.background = this.camera.artboardBg;
    if (swatchStroke) swatchStroke.style.background = this.opticsEngine.stitchColor;

    document.querySelectorAll('.btn-fabric-preset').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === presetKey);
    });
    document.querySelectorAll('.btn-hud-fabric').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === presetKey);
    });

    this.camera.requestRender();
    if (this.isLightboxActive) {
      this.renderLightboxView();
    }
  }

  // --- Hardware-Grade Trace Lock (Palm & Glass Rejection) ---
  async toggleTraceLock() {
    if (this.isTraceLocked) {
      await this.disableTraceLock();
    } else {
      await this.enableTraceLock();
    }
  }

  async enableTraceLock() {
    this.isTraceLocked = true;
    this.updateTraceLockUI();
    try {
      if ('wakeLock' in navigator) {
        this.wakeLockSentinel = await navigator.wakeLock.request('screen');
      }
    } catch (e) {
      console.warn('Screen WakeLock not granted:', e);
    }
  }

  async disableTraceLock() {
    this.isTraceLocked = false;
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch (e) {}
      this.wakeLockSentinel = null;
    }
    this.updateTraceLockUI();
  }

  updateTraceLockUI() {
    const banner = document.getElementById('trace-lock-banner');
    const btn = document.getElementById('btn-artlab-trace-lock');
    const badge = document.getElementById('badge-trace-lock-state');

    if (banner) {
      banner.classList.toggle('hidden', !this.isTraceLocked);
    }
    if (btn) {
      btn.classList.toggle('active', this.isTraceLocked);
      btn.textContent = this.isTraceLocked ? '🔒 Trace Lock: ON (Screen Frozen)' : '🔒 Trace Lock: OFF';
    }
    if (badge) {
      badge.textContent = this.isTraceLocked ? 'Locked (Frozen)' : 'Touch Active';
      badge.classList.toggle('highlight', this.isTraceLocked);
    }
  }

  setStrokeBoost(val) {
    this.strokeBoost = Math.max(1.0, Math.min(4.0, parseFloat(val) || 1.6));
    const baseW = this.fabricMode === 'light' ? 2.0 : 2.4;
    this.opticsEngine.stitchWidth = baseW * this.strokeBoost;

    const valBadge = document.getElementById('val-airgap-boost');
    if (valBadge) valBadge.textContent = `${this.strokeBoost.toFixed(1)}× Boost`;
    const inputBoost = document.getElementById('input-airgap-boost');
    if (inputBoost) inputBoost.value = this.strokeBoost;

    this.camera.requestRender();
    if (this.isLightboxActive) {
      this.renderLightboxView();
    }
  }

  // --- 4. Vernier Parallax Sightline Reticle & Crosshair Rendering ---

  renderLaserCrosshair(ctx, state) {
    if (!this.showLaserCrosshair) return;

    const px = this.laserPoint.x;
    const py = this.laserPoint.y;
    const zoom = state.zoom || 1;
    const armLen = 32 / zoom;
    const innerRing = 9 / zoom;
    const outerRing = 22 / zoom;

    ctx.save();
    // High-visibility crisp cyan & neon laser styling
    const laserColor = this.opticsEngine.isDark ? '#38BDF8' : '#DC2626';
    ctx.strokeStyle = laserColor;
    ctx.lineWidth = Math.max(1.2, 1.6 / zoom);
    ctx.shadowColor = laserColor;
    ctx.shadowBlur = this.opticsEngine.isDark ? 8 : 0;

    // Vernier Sightline concentric bullseye rings (eliminates parallax tilt)
    ctx.beginPath();
    ctx.arc(px, py, innerRing, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(px, py, outerRing, 0, Math.PI * 2);
    ctx.stroke();

    // 4 Cardinal Sightline Ticks
    ctx.beginPath();
    ctx.moveTo(px - armLen, py); ctx.lineTo(px - outerRing - 2 / zoom, py);
    ctx.moveTo(px + outerRing + 2 / zoom, py); ctx.lineTo(px + armLen, py);
    ctx.moveTo(px, py - armLen); ctx.lineTo(px, py - outerRing - 2 / zoom);
    ctx.moveTo(px, py + outerRing + 2 / zoom); ctx.lineTo(px, py + armLen);
    ctx.stroke();

    // Solid center bullseye dot
    ctx.fillStyle = '#00FF7F';
    ctx.beginPath();
    ctx.arc(px, py, 2.5 / zoom, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // --- 5. Fullscreen Lightbox Mode ---

  async enterLightbox() {
    this.isLightboxActive = true;
    document.body.classList.add('in-lightbox');
    const rulerHud = document.getElementById('virtual-ruler-hud');
    if (rulerHud) rulerHud.classList.add('hidden');

    const overlay = document.getElementById('lightbox-overlay');
    if (!overlay) return;

    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';

    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }

    // Auto-enable Hardware Trace Lock (screen wake lock & touch gesture freeze)
    await this.enableTraceLock();
    this.renderLightboxView();
  }

  async exitLightbox() {
    this.isLightboxActive = false;
    document.body.classList.remove('in-lightbox');
    if (this.virtualRuler && this.virtualRuler.visible) {
      const rulerHud = document.getElementById('virtual-ruler-hud');
      if (rulerHud) rulerHud.classList.remove('hidden');
    }

    const overlay = document.getElementById('lightbox-overlay');
    if (!overlay) return;

    overlay.classList.add('hidden');
    overlay.style.display = 'none';

    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }

    // Auto-release Trace Lock upon exiting lightbox
    await this.disableTraceLock();
    this.camera.requestRender();
  }

  renderLightboxView() {
    const lightboxCanvas = document.getElementById('lightbox-canvas');
    if (!lightboxCanvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    lightboxCanvas.width = Math.round(w * dpr);
    lightboxCanvas.height = Math.round(h * dpr);
    lightboxCanvas.style.width = `${w}px`;
    lightboxCanvas.style.height = `${h}px`;

    const ctx = lightboxCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Background matching fabric mode
    const bg = this.fabricMode === 'light' ? '#FFFFFF' : '#000000';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, lightboxCanvas.width, lightboxCanvas.height);

    ctx.save();
    ctx.scale(dpr, dpr);

    const artW = this.camera.artboardWidthPx;
    const artH = this.camera.artboardHeightPx;
    const halfW = artW / 2;
    const halfH = artH / 2;

    let subW = artW;
    let subH = artH;
    let subX = 0;
    let subY = 0;

    if (this.activeQuadrant === 1) { subW = halfW; subH = halfH; subX = 0; subY = 0; }
    else if (this.activeQuadrant === 2) { subW = halfW; subH = halfH; subX = halfW; subY = 0; }
    else if (this.activeQuadrant === 3) { subW = halfW; subH = halfH; subX = 0; subY = halfH; }
    else if (this.activeQuadrant === 4) { subW = halfW; subH = halfH; subX = halfW; subY = halfH; }

    const zoom = Math.min((w - 40) / subW, (h - 90) / subH);
    const panX = (w - subW * zoom) / 2 - subX * zoom;
    const panY = (h - subH * zoom) / 2 - subY * zoom + 10;

    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Apply quadrant rotation around quadrant center if specified
    if (this.quadrantRotation !== 0 && this.activeQuadrant !== null) {
      const qCenterX = subX + subW / 2;
      const qCenterY = subY + subH / 2;
      ctx.translate(qCenterX, qCenterY);
      ctx.rotate((this.quadrantRotation * Math.PI) / 180);
      ctx.translate(-qCenterX, -qCenterY);
    }

    // 1. Draw Reference Image Layers if active
    if (this.layerManager) {
      for (const layer of this.layerManager.layers) {
        if (layer.type === 'image' && layer.visible && layer.imgEl) {
          ctx.save();
          ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 0.6;
          ctx.drawImage(layer.imgEl, layer.x || 0, layer.y || 0, layer.width || artW, layer.height || artH);
          ctx.restore();
        }
      }
    }

    // 2. Sub-Lab Partition Guides
    for (const p of this.partitionEngine.partitions) {
      const pts = p.points;
      if (pts.length < 3) continue;
      ctx.strokeStyle = this.fabricMode === 'light' ? 'rgba(0, 0, 0, 0.15)' : 'rgba(0, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.stroke();
    }

    // 3. Stitches with Optical Penetration Boost
    const stitchColor = this.fabricMode === 'light'
      ? '#090A0D'
      : (this.fabricMode === 'photopic-lime' ? '#39FF14' : (this.fabricMode === 'indigo' ? '#00FFFF' : '#FFFFFF'));

    ctx.save();
    ctx.strokeStyle = stitchColor;
    ctx.lineWidth = (this.fabricMode === 'light' ? 2.2 : 2.8) * this.strokeBoost;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (this.opticsEngine.neonGlow) {
      ctx.shadowColor = stitchColor;
      ctx.shadowBlur = 8;
    } else {
      ctx.shadowBlur = 0;
    }

    if (this.opticsEngine.lineStyle === 'dashed') {
      ctx.setLineDash([12, 6]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    for (const edge of this.stitchPen.stitches.values()) {
      const p1 = this.latticeGrid.nodeToWorld(edge.u[0], edge.u[1]);
      const p2 = this.latticeGrid.nodeToWorld(edge.v[0], edge.v[1]);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();
    ctx.restore();

    // 4. Laser Registration Crosshair
    if (this.showLaserCrosshair) {
      this.renderLaserCrosshair(ctx, { zoom: 1 });
    }

    // 5. Virtual Artisan Ruler in Lightbox
    if (this.virtualRuler && this.virtualRuler.visible) {
      this.virtualRuler.render(ctx, { dpr, zoom });
    }

    ctx.restore();
  }

  setVirtualRuler(virtualRuler) {
    this.virtualRuler = virtualRuler;
  }

  // --- UI Event Listeners ---

  bindPanelEvents() {
    // PPI slider & input
    const inputPPI = document.getElementById('input-screen-ppi');
    if (inputPPI) {
      inputPPI.addEventListener('input', (e) => {
        this.setCalibratedPPI(e.target.value);
      });
    }

    // PPI quick presets
    document.querySelectorAll('.btn-preset-ppi').forEach(btn => {
      btn.addEventListener('click', () => {
        const ppi = btn.dataset.ppi;
        if (ppi) this.setCalibratedPPI(ppi);
      });
    });

    // Lock 1:1 scale button
    document.getElementById('btn-lock-real-scale')?.addEventListener('click', () => {
      this.lockRealScale();
    });

    // Quadrant selector buttons (Q1..Q4)
    document.querySelectorAll('.btn-quadrant').forEach(btn => {
      btn.addEventListener('click', () => {
        const q = parseInt(btn.dataset.quad, 10);
        this.focusQuadrant(q);
      });
    });

    // Quadrant full view & rotate buttons
    document.getElementById('btn-quad-full')?.addEventListener('click', () => {
      this.focusQuadrant(null);
    });
    document.getElementById('btn-quad-rotate')?.addEventListener('click', () => {
      this.rotateQuadrant(90);
    });

    // Laser crosshair toggle
    document.getElementById('btn-crosshair-on')?.addEventListener('click', () => {
      this.showLaserCrosshair = true;
      document.getElementById('btn-crosshair-on')?.classList.add('active');
      document.getElementById('btn-crosshair-off')?.classList.remove('active');
      this.camera.requestRender();
      if (this.isLightboxActive) this.renderLightboxView();
    });
    document.getElementById('btn-crosshair-off')?.addEventListener('click', () => {
      this.showLaserCrosshair = false;
      document.getElementById('btn-crosshair-off')?.classList.add('active');
      document.getElementById('btn-crosshair-on')?.classList.remove('active');
      this.camera.requestRender();
      if (this.isLightboxActive) this.renderLightboxView();
    });

    // Fabric optical presets
    document.querySelectorAll('.btn-fabric-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        if (preset) this.applyFabricPreset(preset);
      });
    });

    // Air-gap thickness booster
    const inputBoost = document.getElementById('input-airgap-boost');
    if (inputBoost) {
      inputBoost.addEventListener('input', (e) => {
        this.setStrokeBoost(e.target.value);
      });
    }

    // Toggle Virtual Artisan Ruler from panel
    document.getElementById('btn-artlab-toggle-ruler')?.addEventListener('click', () => {
      if (this.virtualRuler) {
        this.virtualRuler.toggleVisible();
        const btn = document.getElementById('btn-artlab-toggle-ruler');
        if (btn) btn.classList.toggle('active', this.virtualRuler.visible);
      }
    });

    // Pinpoint micro-zoom buttons in panel
    document.getElementById('btn-artlab-zoom-minus')?.addEventListener('click', () => {
      this.virtualRuler?.nudgeZoom(-0.2);
    });
    document.getElementById('btn-artlab-zoom-plus')?.addEventListener('click', () => {
      this.virtualRuler?.nudgeZoom(0.2);
    });
    document.getElementById('btn-artlab-zoom-step-minus')?.addEventListener('click', () => {
      this.virtualRuler?.nudgeZoom(-1.0);
    });
    document.getElementById('btn-artlab-zoom-step-plus')?.addEventListener('click', () => {
      this.virtualRuler?.nudgeZoom(1.0);
    });

    // Live 4-Way & Radial Symmetry Toggle Button
    document.getElementById('btn-toggle-symmetry')?.addEventListener('click', () => {
      if (this.stitchPen) {
        this.stitchPen.toggleSymmetryMode();
      }
    });

    // Hardware Trace Lock Toggle & Banner Unlock Buttons
    document.getElementById('btn-artlab-trace-lock')?.addEventListener('click', () => {
      this.toggleTraceLock();
    });
    document.getElementById('btn-banner-unlock')?.addEventListener('click', () => {
      this.disableTraceLock();
    });

    // Escape exits Trace Lock if active
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isTraceLocked) {
        this.disableTraceLock();
      }
    });

    // Launch Lightbox button from panel
    document.getElementById('btn-launch-lightbox-mode')?.addEventListener('click', () => {
      this.enterLightbox();
    });
  }

  bindLightboxEvents() {
    // Topbar launch button
    document.getElementById('btn-enter-artlab')?.addEventListener('click', () => {
      // Switch right inspector to Art Lab tab
      document.querySelector('.insp-tab[data-tab="artlab"]')?.click();
    });

    // Lightbox Exit button
    document.getElementById('btn-exit-lightbox')?.addEventListener('click', () => {
      this.exitLightbox();
    });

    // Lightbox HUD buttons
    document.querySelectorAll('.btn-hud-quad').forEach(btn => {
      btn.addEventListener('click', () => {
        const q = btn.dataset.quad === 'full' ? null : parseInt(btn.dataset.quad, 10);
        this.focusQuadrant(q);
      });
    });

    document.getElementById('btn-hud-rotate')?.addEventListener('click', () => {
      this.rotateQuadrant(90);
    });

    document.querySelectorAll('.btn-hud-fabric').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        if (preset) this.applyFabricPreset(preset);
      });
    });

    document.getElementById('btn-hud-crosshair')?.addEventListener('click', () => {
      this.showLaserCrosshair = !this.showLaserCrosshair;
      document.getElementById('btn-hud-crosshair')?.classList.toggle('active', this.showLaserCrosshair);
      this.renderLightboxView();
    });

    document.getElementById('btn-hud-ruler')?.addEventListener('click', () => {
      if (this.virtualRuler) {
        this.virtualRuler.toggleVisible();
        document.getElementById('btn-hud-ruler')?.classList.toggle('active', this.virtualRuler.visible);
        this.renderLightboxView();
      }
    });

    // Window keyboard ESC handler
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (this.isLightboxActive) {
          this.exitLightbox();
        }
      }
    });

    // Window resize in lightbox
    window.addEventListener('resize', () => {
      if (this.isLightboxActive) {
        this.renderLightboxView();
      }
    });
  }
}
