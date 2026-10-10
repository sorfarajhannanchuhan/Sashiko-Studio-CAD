/**
 * Sashiko Studio CAD - Floating Interactive Minimap Navigator
 * Provides a sleek, minimalist miniature radar of the cushion artboard and camera viewport.
 * Dragging or clicking within the minimap repositions the camera viewport instantly.
 */

export class MinimapNavigator {
  constructor(containerEl, camera, partitionEngine, stitchPen) {
    this.container = containerEl;
    this.camera = camera;
    this.partitionEngine = partitionEngine;
    this.stitchPen = stitchPen;

    this.canvas = containerEl ? containerEl.querySelector('#minimap-canvas') : null;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.isDragging = false;
    this.visible = false;

    this.init();
  }

  init() {
    if (!this.canvas) return;

    const btnToggle = document.getElementById('btn-toggle-minimap');
    const btnClose = document.getElementById('btn-close-minimap');

    if (btnToggle) {
      btnToggle.addEventListener('click', () => {
        this.toggle();
      });
    }

    if (btnClose) {
      btnClose.addEventListener('click', () => {
        this.hide();
      });
    }

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'M') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        this.toggle();
      }
    });

    // Pointer events for dragging viewport rect
    this.canvas.addEventListener('pointerdown', (e) => {
      this.isDragging = true;
      this.handleMinimapClick(e);
    });

    window.addEventListener('pointermove', (e) => {
      if (this.isDragging) {
        this.handleMinimapClick(e);
      }
    });

    window.addEventListener('pointerup', () => {
      this.isDragging = false;
    });

    // Subscribe to camera renders
    this.camera.subscribe(() => {
      if (this.visible) {
        this.render();
      }
    });
  }

  toggle() {
    this.visible = !this.visible;
    if (this.container) {
      this.container.classList.toggle('hidden', !this.visible);
    }
    const btnToggle = document.getElementById('btn-toggle-minimap');
    if (btnToggle) btnToggle.classList.toggle('active', this.visible);
    if (this.visible) {
      this.render();
    }
  }

  hide() {
    this.visible = false;
    if (this.container) {
      this.container.classList.add('hidden');
    }
    const btnToggle = document.getElementById('btn-toggle-minimap');
    if (btnToggle) btnToggle.classList.remove('active');
  }

  handleMinimapClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const my = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const cushionPx = this.camera.cushionPx;
    const pad = 6;
    const avail = this.canvas.width - pad * 2;
    const scale = avail / cushionPx;

    const worldTargetX = (mx - pad) / scale;
    const worldTargetY = (my - pad) / scale;

    // Center camera on clicked world coordinate
    this.camera.panX = (this.camera.screenWidth / 2) - worldTargetX * this.camera.zoom;
    this.camera.panY = (this.camera.screenHeight / 2) - worldTargetY * this.camera.zoom;
    this.camera.updateZoomHUD();
    this.camera.requestRender();
  }

  render() {
    if (!this.ctx || !this.visible) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pad = 6;
    const avail = w - pad * 2;
    const cushionPx = this.camera.cushionPx;
    const scale = avail / cushionPx;

    ctx.clearRect(0, 0, w, h);

    // 1. Background
    ctx.fillStyle = '#0B0C0E';
    ctx.fillRect(0, 0, w, h);

    // 2. Artboard Card
    ctx.fillStyle = '#141824';
    ctx.fillRect(pad, pad, avail, avail);
    ctx.strokeStyle = 'rgba(0, 255, 127, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, avail, avail);

    // 3. Partitions
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 0.8;
    for (const p of this.partitionEngine.partitions) {
      if (p.points.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(pad + p.points[0].x * scale, pad + p.points[0].y * scale);
      for (let i = 1; i < p.points.length; i++) {
        ctx.lineTo(pad + p.points[i].x * scale, pad + p.points[i].y * scale);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // 4. Stitches (Mini dots/lines)
    ctx.strokeStyle = 'rgba(0, 255, 127, 0.7)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    let count = 0;
    const stepPx = (this.camera.cushionInches * 96) / 130;
    for (const edge of this.stitchPen.stitches.values()) {
      if (count++ % 4 !== 0) continue;
      const p1x = pad + edge.u[0] * 13.2 * scale;
      const p1y = pad + edge.u[1] * 13.2 * scale;
      const p2x = pad + edge.v[0] * 13.2 * scale;
      const p2y = pad + edge.v[1] * 13.2 * scale;
      ctx.moveTo(p1x, p1y);
      ctx.lineTo(p2x, p2y);
    }
    ctx.stroke();

    // 5. Current Viewport Window (Green outline rect)
    const vp = this.camera.getViewportWorldBounds ? this.camera.getViewportWorldBounds() : { minX: 0, minY: 0, maxX: cushionPx, maxY: cushionPx };
    const vpLeft = pad + Math.max(0, vp.minX) * scale;
    const vpTop = pad + Math.max(0, vp.minY) * scale;
    const vpW = Math.min(avail, (vp.maxX - vp.minX) * scale);
    const vpH = Math.min(avail, (vp.maxY - vp.minY) * scale);

    ctx.save();
    ctx.strokeStyle = '#00FF7F';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(0, 255, 127, 0.08)';
    ctx.fillRect(vpLeft, vpTop, vpW, vpH);
    ctx.strokeRect(vpLeft, vpTop, vpW, vpH);
    ctx.restore();
  }
}
