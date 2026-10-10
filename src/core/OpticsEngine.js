/**
 * Sashiko Studio CAD - Optics & Display Profile Engine
 * Manages fabric optics (555nm Neon Lime penetrator vs Light Paper),
 * physical artboard rendering (drop shadow, corner crosshairs, dimension tags),
 * and hardware display profiles (OLED, IPS, UHD, Auto).
 */

export class OpticsEngine {
  constructor() {
    this.preset = 'dark-555'; // 'dark-555' | 'light-paper'
    this.displayProfile = 'oled'; // 'oled' | 'ips' | 'uhd' | 'auto'

    this.isDark = true;
    this.workbenchBg = '#1E1E1E'; // Figma eye-soothing canvas background
    this.bgColor = '#242424';      // Neutral dark slate textile artboard
    this.stitchColor = '#FFFFFF';  // Authentic Crisp White Sashiko Thread
    this.stitchWidth = 2.0;
    this.lineStyle = 'dashed';     // 'dashed' | 'solid'
    this.stitchPitchMm = 3.5;
    this.showSeamAllowance = false; // Disabled by default to remove noisy yellow line
    this.seamColor = '#F59E0B';    // Safety seam allowance guide amber
    this.greenSubLabColor = '#38BDF8';

    this.autoDetectDisplay();
    this.updateColors();
  }

  autoDetectDisplay() {
    if (window.matchMedia && window.matchMedia('(dynamic-range: high)').matches) {
      this.displayProfile = 'oled';
    } else if (window.devicePixelRatio >= 2) {
      this.displayProfile = 'uhd';
    } else {
      this.displayProfile = 'ips';
    }
  }

  setPreset(preset) {
    this.preset = preset;
    if (preset === 'dark-555') {
      this.isDark = true;
      this.workbenchBg = '#1E1E1E';
      this.bgColor = '#242424';
      this.stitchColor = '#FFFFFF';
    } else if (preset === 'light-paper') {
      this.isDark = false;
      this.workbenchBg = '#F5F5F5';
      this.bgColor = '#FFFFFF';
      this.stitchColor = '#0F172A';
    }
    this.updateDomUI();
  }

  setDisplayProfile(profile) {
    this.displayProfile = profile;
    if (profile === 'auto') {
      this.autoDetectDisplay();
    }
    this.updateColors();
  }

  setCustomColors(bg, stitch) {
    this.bgColor = bg;
    this.stitchColor = stitch;
    const hex = bg.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) || 0;
    const g = parseInt(hex.substring(2, 4), 16) || 0;
    const b = parseInt(hex.substring(4, 6), 16) || 0;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    this.isDark = brightness < 128;
    this.workbenchBg = this.isDark ? '#0B0C0E' : '#E5E7EB';
  }

  setLineStyle(style) {
    this.lineStyle = style;
  }

  setStitchPitch(pitchMm) {
    this.stitchPitchMm = pitchMm;
  }

  updateColors() {
    if (this.preset === 'dark-555') {
      this.workbenchBg = '#0B0C0E';
      this.bgColor = '#131418';
      this.stitchColor = '#FFFFFF';
    }
  }

  updateDomUI() {
    const inputBg = document.getElementById('input-bg-color');
    const inputLine = document.getElementById('input-line-color');
    if (inputBg) inputBg.value = this.bgColor;
    if (inputLine) inputLine.value = this.stitchColor;

    const optDark = document.getElementById('optic-dark-555');
    const optLight = document.getElementById('optic-light-paper');
    if (optDark) optDark.classList.toggle('active', this.preset === 'dark-555');
    if (optLight) optLight.classList.toggle('active', this.preset === 'light-paper');
  }

  /**
   * Renders the distinct Cushion Textile Artboard with Figma/Illustrator-grade
   * drop shadows, outer border, corner registration crosshairs, and seam allowance.
   */
  renderCushionBackdrop(ctx, state) {
    // Completely bypass rendering the yellow dashed line to keep the canvas clean & eye-soothing
    if (!this.showSeamAllowance) return;

    const { width, height, ppi } = state;
    if (!width || !height) return;

    const zoom = state.zoom || 1;
    const seamMarginPx = 0.75 * (ppi || 96);

    ctx.save();
    ctx.strokeStyle = this.isDark ? 'rgba(245, 158, 11, 0.45)' : 'rgba(217, 119, 6, 0.50)';
    ctx.lineWidth = Math.max(1.0, 1.0 / zoom);
    ctx.setLineDash([6 / zoom, 6 / zoom]);
    ctx.strokeRect(seamMarginPx, seamMarginPx, width - seamMarginPx * 2, height - seamMarginPx * 2);
    ctx.restore();
  }

  applyStitchStroke(ctx, isSelected = false) {
    ctx.strokeStyle = isSelected ? '#00E5FF' : this.stitchColor;
    ctx.lineWidth = this.stitchWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (this.lineStyle === 'dashed') {
      // 3.5mm dash (~13px at 96ppi), 1.5mm space (~6px)
      ctx.setLineDash([12, 6]);
    } else {
      ctx.setLineDash([]);
    }
  }
}
