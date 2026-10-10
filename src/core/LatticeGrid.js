/**
 * Sashiko Studio CAD - Hierarchical Main & Sub-Grid Engine (Image 4 Benchmark)
 * Implements a looping hierarchical grid across the bounded A2 artboard:
 * - Main Grid: Primary master squares with bold anchor dots and prominent line strokes.
 * - Sub-Grid: Dynamic row/column partitions (default 3×3 = 9 sub-boxes) with lighter lines & dots.
 * - Excel-style horizontal & vertical division add/less controls.
 * - Interactive magnetic anchor dots serving as discrete integer lattice vertices.
 */

export function formatCoord(n) {
  return Number(Math.round(n * 1000) / 1000).toString();
}

export function nodeKey(i, j) {
  return `${formatCoord(i)},${formatCoord(j)}`;
}

export function edgeKey(i1, j1, i2, j2) {
  const fI1 = Number(formatCoord(i1));
  const fJ1 = Number(formatCoord(j1));
  const fI2 = Number(formatCoord(i2));
  const fJ2 = Number(formatCoord(j2));

  if (fI1 < fI2 || (Math.abs(fI1 - fI2) < 1e-5 && fJ1 < fJ2)) {
    return `${formatCoord(fI1)},${formatCoord(fJ1)}--${formatCoord(fI2)},${formatCoord(fJ2)}`;
  }
  return `${formatCoord(fI2)},${formatCoord(fJ2)}--${formatCoord(fI1)},${formatCoord(fJ1)}`;
}

export class LatticeGrid {
  constructor(camera) {
    this.camera = camera;

    // Grid Visibility Flags
    this.enabled = true; // Global Master Switch
    this.mainGridEnabled = true;
    this.subGridEnabled = true;
    this.microGridEnabled = false; // Tier 3: Default HIDDEN / OFF
    this.showDots = true;
    this.snapEnabled = true;
    this.midpointSnapping = true; // Enables snapping to edge midpoints & square centers (Figma SS 4)
    this.layerManager = null; // Injected LayerManager instance

    // Unit System ('in' | 'cm' | 'mm') - Default: 'in'
    this.unit = 'in';

    // Tier 1: Master Grid Dimensions (in mm)
    // Default main pitch: 25.4mm = 1.00 in (or 30.0mm = 3.00cm in cm mode)
    this.mainPitchMm = 25.4;

    // Tier 2: Sub-Grid Divisions per Master Square
    // Default: 3 horizontal, 3 vertical -> 3×3 = 9 sub-boxes!
    // At 1.00in main, each sub-square is exactly 0.33 in (8.47mm)!
    // At 3.00cm main, each sub-square is exactly 1.00 cm (10.0mm)!
    this.subDivH = 3;
    this.subDivV = 3;

    // Tier 3: Micro-Grid Divisions per Sub-Square (Sub-Sub-Grid)
    // Default: 2 horizontal, 2 vertical -> 2×2 = 4 micro-boxes per sub-square!
    // At 0.33in sub-square, each micro-square is exactly 0.17 in (4.23mm)!
    // At 1.00cm sub-square, each micro-square is exactly 0.50 cm (5.0mm)!
    this.microDivH = 2;
    this.microDivV = 2;

    // Styling & Contrast (Figma Eye-Soothing Standard)
    this.opacity = 0.08; // Base grid opacity (3% to 25%) - non-fatiguing
    this.mainLineWidth = 0.9;
    this.subLineWidth = 0.65;
    this.microLineWidth = 0.45;
    this.mainDotRadius = 1.4;
    this.subDotRadius = 0.9;
    this.microDotRadius = 0.5;

    this.snapRadiusPx = 16; // Snap radius in canvas space
    this.ghostEdge = null; // { u: [i1, j1], v: [i2, j2], color, width, lengthMm, angleDeg }
    this.hoverNode = null; // { i, j, x, y, isMain, isSub, isMidpoint, isCellCenter, typeLabel }
  }

  setUnit(unit) {
    if (unit === this.unit) return;
    this.unit = unit; // 'in' | 'cm' | 'mm'
    if (unit === 'cm') {
      this.mainPitchMm = 30.0; // 3.00 cm
    } else if (unit === 'in') {
      this.mainPitchMm = 25.4; // 1.00 in
    } else if (unit === 'mm') {
      this.mainPitchMm = 25.0; // 25.0 mm
    }
    this.camera.rulerUnit = unit;
    this.camera.requestRender();
  }

  getMainSizeFormatted() {
    if (this.unit === 'in') {
      return `${(this.mainPitchMm / 25.4).toFixed(2)} in`;
    } else if (this.unit === 'cm') {
      return `${(this.mainPitchMm / 10.0).toFixed(2)} cm`;
    } else {
      return `${this.mainPitchMm.toFixed(1)} mm`;
    }
  }

  getSubSizeFormatted() {
    const subMm = this.mainPitchMm / Math.max(1, this.subDivH);
    if (this.unit === 'in') {
      return `${(subMm / 25.4).toFixed(2)} in`;
    } else if (this.unit === 'cm') {
      return `${(subMm / 10.0).toFixed(2)} cm`;
    } else {
      return `${subMm.toFixed(1)} mm`;
    }
  }

  getMicroSizeFormatted() {
    const microMm = this.mainPitchMm / (Math.max(1, this.subDivH) * Math.max(1, this.microDivH));
    if (this.unit === 'in') {
      return `${(microMm / 25.4).toFixed(2)} in`;
    } else if (this.unit === 'cm') {
      return `${(microMm / 10.0).toFixed(2)} cm`;
    } else {
      return `${microMm.toFixed(1)} mm`;
    }
  }

  // Pitch in Millimeters for single sub-division stitch length
  get pitchMm() {
    return this.mainPitchMm / this.subDivH;
  }

  set pitchMm(val) {
    if (val > 0) {
      this.mainPitchMm = val * this.subDivH;
    }
  }

  getStepXPx() {
    const mmPerDivX = this.mainPitchMm / (Math.max(1, this.subDivH) * Math.max(1, this.microDivH));
    return (mmPerDivX / 25.4) * this.camera.ppi;
  }

  getStepYPx() {
    const mmPerDivY = this.mainPitchMm / (Math.max(1, this.subDivV) * Math.max(1, this.microDivV));
    return (mmPerDivY / 25.4) * this.camera.ppi;
  }

  getStepPx() {
    return this.getStepXPx();
  }

  /**
   * Snaps a world point to the nearest discrete anchor dot, edge midpoint, or cell center.
   * - Corner Vertices: integer sub-grid intersections (e.g. 1, 2, 3)
   * - Edge Midpoints: halfway along grid edges (e.g. 1.5, 2.0 or 633.5 in Figma Image 4)
   * - Cell Centroids: center of grid squares (e.g. 1.5, 2.5)
   */
  snapToNode(worldPt) {
    const stepX = this.getStepXPx();
    const stepY = this.getStepYPx();

    // Active base step: if micro-grid is OFF, base step is sub-grid (step * microDiv)
    const baseStepX = this.microGridEnabled ? stepX : (stepX * this.microDivH);
    const baseStepY = this.microGridEnabled ? stepY : (stepY * this.microDivV);

    // Midpoint snapping: allows half-step intervals (0.5 * baseStep)
    const snapQuantumX = this.midpointSnapping ? (baseStepX * 0.5) : baseStepX;
    const snapQuantumY = this.midpointSnapping ? (baseStepY * 0.5) : baseStepY;

    const snappedWorldX = Math.round(worldPt.x / snapQuantumX) * snapQuantumX;
    const snappedWorldY = Math.round(worldPt.y / snapQuantumY) * snapQuantumY;

    // Convert back to coordinate index relative to stepX, stepY
    const rawI = Number(formatCoord(snappedWorldX / stepX));
    const rawJ = Number(formatCoord(snappedWorldY / stepY));

    const dist = Math.hypot(worldPt.x - snappedWorldX, worldPt.y - snappedWorldY);

    const effSubH = this.microDivH;
    const effSubV = this.microDivV;
    const effMainH = this.subDivH * effSubH;
    const effMainV = this.subDivV * effSubV;

    // Node classification
    const isCorner = (rawI % effSubH === 0) && (rawJ % effSubV === 0);
    const isMain = isCorner && (rawI % effMainH === 0) && (rawJ % effMainV === 0);
    const isSub = isCorner && !isMain;
    const isCellCenter = (rawI % effSubH !== 0) && (rawJ % effSubV !== 0);
    const isMidpoint = !isCorner;

    let typeLabel = 'Corner';
    if (isMain) typeLabel = 'Master';
    else if (isSub) typeLabel = 'Sub-Grid';
    else if (isCellCenter) typeLabel = 'Center';
    else if (isMidpoint) typeLabel = 'Midpoint';

    const activeMinStep = Math.min(snapQuantumX, snapQuantumY);
    const maxSnapDist = this.snapEnabled
      ? Math.max(this.snapRadiusPx / (this.camera.zoom || 1), activeMinStep * 0.52)
      : (this.snapRadiusPx / (this.camera.zoom || 1));

    if (dist <= maxSnapDist) {
      return {
        i: rawI,
        j: rawJ,
        x: snappedWorldX,
        y: snappedWorldY,
        isMain,
        isSub,
        isMidpoint,
        isCellCenter,
        typeLabel,
        snapped: true
      };
    }

    return {
      i: rawI,
      j: rawJ,
      x: worldPt.x,
      y: worldPt.y,
      isMain: false,
      isSub: false,
      isMidpoint: false,
      isCellCenter: false,
      typeLabel: null,
      snapped: false
    };
  }

  nodeToWorld(i, j) {
    return {
      x: i * this.getStepXPx(),
      y: j * this.getStepYPx()
    };
  }

  adjustSubDivH(delta) {
    this.subDivH = Math.max(1, Math.min(12, this.subDivH + delta));
    this.camera.requestRender();
  }

  adjustSubDivV(delta) {
    this.subDivV = Math.max(1, Math.min(12, this.subDivV + delta));
    this.camera.requestRender();
  }

  adjustMicroDivH(delta) {
    this.microDivH = Math.max(1, Math.min(8, this.microDivH + delta));
    this.camera.requestRender();
  }

  adjustMicroDivV(delta) {
    this.microDivV = Math.max(1, Math.min(8, this.microDivV + delta));
    this.camera.requestRender();
  }

  /**
   * Renders the looping 3-tier hierarchical grid across the artboard.
   */
  render(ctx, state, optics) {
    if (!this.enabled) return;
    if (this.layerManager && !this.layerManager.isLayerVisible('layer_grid')) return;

    const stepX = this.getStepXPx();
    const stepY = this.getStepYPx();

    ctx.save();

    // Infinite / Full-Viewport Culling: calculate min/max coordinates visible in camera
    const vp = this.camera.getViewportWorldBounds
      ? this.camera.getViewportWorldBounds()
      : { minX: -2000, minY: -2000, maxX: 4000, maxY: 4000 };

    // Seamless full-screen tiling across entire window
    const startX = Math.floor(vp.minX / stepX) * stepX;
    const endX = Math.ceil(vp.maxX / stepX) * stepX;
    const startY = Math.floor(vp.minY / stepY) * stepY;
    const endY = Math.ceil(vp.maxY / stepY) * stepY;

    if (startX > endX || startY > endY) {
      ctx.restore();
      return;
    }

    const zoom = state.zoom || 1;
    const isDark = optics.isDark;
    const effMainH = this.subDivH * this.microDivH;
    const effMainV = this.subDivV * this.microDivV;

    // 1. Render Micro-Grid Lines (Tier 3 - Sub-Sub-Grid: Faint dashed lines, LOD: zoom >= 0.35)
    if (this.microGridEnabled && zoom >= 0.35) {
      const microAlpha = (this.opacity * 0.40).toFixed(3);
      ctx.strokeStyle = isDark
        ? `rgba(255, 255, 255, ${microAlpha})`
        : `rgba(0, 0, 0, ${(microAlpha * 1.4).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.45, this.microLineWidth / zoom);
      ctx.setLineDash([2 / zoom, 2 / zoom]);

      ctx.beginPath();
      // Vertical micro lines
      for (let x = startX; x <= endX; x += stepX) {
        const colIdx = Math.round(x / stepX);
        if (colIdx % this.microDivH !== 0) {
          ctx.moveTo(x, startY);
          ctx.lineTo(x, endY);
        }
      }
      // Horizontal micro lines
      for (let y = startY; y <= endY; y += stepY) {
        const rowIdx = Math.round(y / stepY);
        if (rowIdx % this.microDivV !== 0) {
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Render Sub-Grid Lines (Tier 2 - Light, Slim Solid lines, LOD: zoom >= 0.12)
    if (this.subGridEnabled && zoom >= 0.12) {
      const subAlpha = (this.opacity * 0.65).toFixed(3);
      ctx.strokeStyle = isDark
        ? `rgba(255, 255, 255, ${subAlpha})`
        : `rgba(0, 0, 0, ${(subAlpha * 1.5).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.65, this.subLineWidth / zoom);

      ctx.beginPath();
      // Vertical sub lines
      for (let x = startX; x <= endX; x += stepX) {
        const colIdx = Math.round(x / stepX);
        if (colIdx % this.microDivH === 0 && colIdx % effMainH !== 0) {
          ctx.moveTo(x, startY);
          ctx.lineTo(x, endY);
        }
      }
      // Horizontal sub lines
      for (let y = startY; y <= endY; y += stepY) {
        const rowIdx = Math.round(y / stepY);
        if (rowIdx % this.microDivV === 0 && rowIdx % effMainV !== 0) {
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
        }
      }
      ctx.stroke();
    }

    // 3. Render Main Grid Lines (Tier 1 - Master Squares: Darker, Thicker)
    if (this.mainGridEnabled) {
      const mainAlpha = (this.opacity * 1.8).toFixed(3);
      ctx.strokeStyle = isDark
        ? `rgba(255, 255, 255, ${mainAlpha})`
        : `rgba(0, 0, 0, ${(mainAlpha * 1.6).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.9, this.mainLineWidth / zoom);

      ctx.beginPath();
      // Vertical main lines
      for (let x = startX; x <= endX; x += stepX) {
        const colIdx = Math.round(x / stepX);
        if (colIdx % effMainH === 0) {
          ctx.moveTo(x, startY);
          ctx.lineTo(x, endY);
        }
      }
      // Horizontal main lines
      for (let y = startY; y <= endY; y += stepY) {
        const rowIdx = Math.round(y / stepY);
        if (rowIdx % effMainV === 0) {
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
        }
      }
      ctx.stroke();
    }

    // 4. Render Interactive Anchor Dots at Intersections
    if (this.showDots) {
      // 4a. Micro-Grid Anchor Dots (Tier 3 - Only when Micro-Grid is ON & zoom >= 0.40)
      if (this.microGridEnabled && zoom >= 0.40) {
        const microDotR = Math.max(0.5, this.microDotRadius / zoom);
        ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.10)';
        ctx.beginPath();
        for (let x = startX; x <= endX; x += stepX) {
          const colIdx = Math.round(x / stepX);
          if (colIdx % this.microDivH !== 0) {
            for (let y = startY; y <= endY; y += stepY) {
              const rowIdx = Math.round(y / stepY);
              if (rowIdx % this.microDivV !== 0) {
                ctx.rect(x - microDotR, y - microDotR, microDotR * 2, microDotR * 2);
              }
            }
          }
        }
        ctx.fill();
      }

      // 4b. Sub-Grid Anchor Dots (Tier 2 - LOD: zoom >= 0.20)
      if (this.subGridEnabled && zoom >= 0.20) {
        const subDotR = Math.max(0.7, this.subDotRadius / zoom);
        ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.18)';
        ctx.beginPath();
        for (let x = startX; x <= endX; x += stepX) {
          const colIdx = Math.round(x / stepX);
          if (colIdx % this.microDivH === 0) {
            for (let y = startY; y <= endY; y += stepY) {
              const rowIdx = Math.round(y / stepY);
              if (rowIdx % this.microDivV === 0 && (colIdx % effMainH !== 0 || rowIdx % effMainV !== 0)) {
                ctx.rect(x - subDotR, y - subDotR, subDotR * 2, subDotR * 2);
              }
            }
          }
        }
        ctx.fill();
      }

      // 4c. Main Grid Anchor Dots (Tier 1 - Bold master corners)
      if (this.mainGridEnabled) {
        const mainDotR = Math.max(1.2, this.mainDotRadius / zoom);
        ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.50)';
        ctx.beginPath();
        for (let x = startX; x <= endX; x += stepX) {
          const colIdx = Math.round(x / stepX);
          if (colIdx % effMainH === 0) {
            for (let y = startY; y <= endY; y += stepY) {
              const rowIdx = Math.round(y / stepY);
              if (rowIdx % effMainV === 0) {
                ctx.rect(x - mainDotR, y - mainDotR, mainDotR * 2, mainDotR * 2);
              }
            }
          }
        }
        ctx.fill();
      }
    }

    // 5. Highlight Currently Hovered Node with Figma Precision Magnetic Reticle
    if (this.hoverNode) {
      const hn = this.nodeToWorld(this.hoverNode.i, this.hoverNode.j);
      const isCenter = this.hoverNode.isCellCenter;
      const isMid = this.hoverNode.isMidpoint;
      const typeLabel = this.hoverNode.typeLabel || 'Anchor';

      ctx.save();

      // Precision Magnetic Reticle (Figma Electric Blue #0D99FF)
      const reticleColor = '#0D99FF';
      ctx.strokeStyle = reticleColor;
      ctx.lineWidth = Math.max(1.0, 1.2 / zoom);

      if (isCenter) {
        // Diamond reticle for cell centroids
        const sz = Math.max(3.2, 4.0 / zoom);
        ctx.beginPath();
        ctx.moveTo(hn.x, hn.y - sz);
        ctx.lineTo(hn.x + sz, hn.y);
        ctx.lineTo(hn.x, hn.y + sz);
        ctx.lineTo(hn.x - sz, hn.y);
        ctx.closePath();
        ctx.stroke();
      } else if (isMid) {
        // Clean small ring for edge midpoints
        const r = Math.max(2.2, 3.0 / zoom);
        ctx.beginPath();
        ctx.arc(hn.x, hn.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Corner anchor: outer ring with centered dot
        const r = Math.max(2.8, 3.6 / zoom);
        ctx.beginPath();
        ctx.arc(hn.x, hn.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#0D99FF';
        ctx.beginPath();
        ctx.arc(hn.x, hn.y, Math.max(1.0, 1.3 / zoom), 0, Math.PI * 2);
        ctx.fill();
      }

      // Figma-Style Translucent Floating Pill Badge - Only show when NOT actively drawing a line to avoid clutter
      if (!this.ghostEdge) {
        const badgeText = `${typeLabel} · (${this.hoverNode.i}, ${this.hoverNode.j})`;
        const fontSz = Math.max(8.5, 9.5 / zoom);
        ctx.font = `500 ${fontSz}px "JetBrains Mono", Consolas, monospace`;
        const metrics = ctx.measureText(badgeText);
        const padX = 5 / zoom;
        const padY = 3 / zoom;
        const bW = metrics.width + padX * 2;
        const bH = fontSz + padY * 2;
        const bX = hn.x + 12 / zoom;
        const bY = hn.y - bH - 8 / zoom;

        // Dark frosted pill background
        ctx.fillStyle = 'rgba(24, 24, 28, 0.88)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = Math.max(0.75, 1.0 / zoom);
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(bX, bY, bW, bH, 3 / zoom);
        } else {
          ctx.rect(bX, bY, bW, bH);
        }
        ctx.fill();
        ctx.stroke();

        // Non-glare off-white text
        ctx.fillStyle = '#EDEDED';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, bX + padX, bY + bH / 2);
      }

      ctx.restore();
    }

    // 6. Render Ghost Stitch Preview with Magnetic Snap Target
    if (this.ghostEdge) {
      const p1 = this.nodeToWorld(this.ghostEdge.u[0], this.ghostEdge.u[1]);
      const p2 = this.nodeToWorld(this.ghostEdge.v[0], this.ghostEdge.v[1]);

      ctx.save();
      ctx.strokeStyle = this.ghostEdge.color || '#0D99FF';
      ctx.lineWidth = Math.max(1.6, 2.2 / zoom);
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      // Magnetic Target Dot at P2 (Crisp Electric Blue with White Core)
      ctx.fillStyle = '#0D99FF';
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, Math.max(2.5, 3.4 / zoom), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, Math.max(1.0, 1.4 / zoom), 0, Math.PI * 2);
      ctx.fill();

      if (this.ghostEdge.lengthMm) {
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const fontSz = Math.max(8.5, 9.5 / zoom);
        ctx.font = `600 ${fontSz}px "JetBrains Mono", Consolas, monospace`;
        const displayLen = this.unit === 'in'
          ? `${(this.ghostEdge.lengthMm / 25.4).toFixed(2)}" (${this.ghostEdge.angleDeg}°)`
          : (this.unit === 'cm'
            ? `${(this.ghostEdge.lengthMm / 10).toFixed(1)}cm (${this.ghostEdge.angleDeg}°)`
            : `${this.ghostEdge.lengthMm.toFixed(1)}mm (${this.ghostEdge.angleDeg}°)`);

        const tm = ctx.measureText(displayLen);
        const pillPadX = 6 / zoom;
        const pillPadY = 3 / zoom;
        const pillW = tm.width + pillPadX * 2;
        const pillH = fontSz + pillPadY * 2;
        const pillX = midX + 12 / zoom;
        const pillY = midY - pillH - 6 / zoom;

        ctx.fillStyle = 'rgba(24, 24, 28, 0.90)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = Math.max(0.75, 1.0 / zoom);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(pillX, pillY, pillW, pillH, 3 / zoom);
        else ctx.rect(pillX, pillY, pillW, pillH);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#EDEDED';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayLen, pillX + pillPadX, pillY + pillH / 2);
      }
      ctx.restore();
    }

    ctx.restore();
  }
}
