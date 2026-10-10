/**
 * Sashiko Studio CAD - Adobe Illustrator Style Pen, Marquee Select & Direct Select Tools (Images 2 & 5)
 * Features:
 * - Continuous Anchor Chaining: Click dot 1 -> dot 2 -> continues to dot 3 without resetting.
 * - Magnetic Anchor Snapping with '+' indicator and distance HUD badge.
 * - Direct Selection (A): Click any single dot-to-dot segment to inspect or delete.
 * - Marquee Multi-Selection (V): Drag blue selection rectangle to select multiple stitches with batch actions.
 */

import { edgeKey } from '../core/LatticeGrid.js';
import { computeConvexHull } from './SubLabManager.js';

export class StitchPen {
  constructor(canvasEl, camera, latticeGrid, subLabManager, historyManager) {
    this.canvas = canvasEl;
    this.camera = camera;
    if (this.camera) {
      this.camera.onCursorRestore = () => this.updateCursor();
    }
    this.latticeGrid = latticeGrid;
    this.subLabManager = subLabManager;
    this.historyManager = historyManager;
    this.layerManager = null; // Injected LayerManager instance
    this.smartGuides = null; // Injected Figma Smart Alignment Guides engine
    this.booleanEngine = null; // Injected Figma Boolean Operations engine

    this.activeTool = 'select'; // Default tool is Selection Tool (V), matching UI toolbar!
    this.stitches = new Map(); // key -> { u: [i1, j1], v: [i2, j2], partitionId }

    // Chained Pen State (Image 5 Benchmark)
    this.chainAnchor = null; // { i, j, x, y } - currently active chain anchor
    this.isDrawing = false;
    this.startNode = null;
    this.hasMovedPastThreshold = false;

    // Marquee Selection & Drag-to-Move State (Tool 'select' - V)
    this.isSelecting = false;
    this.marqueeStart = null; // { x, y } in world coordinates
    this.marqueeCurrent = null; // { x, y } in world coordinates
    this.selectedStitches = new Set(); // Set of stitch keys
    this.isDraggingSelection = false;
    this.dragStartNode = null;
    this.dragCurrentNode = null;
    this.hoveredStitchKey = null;

    // Custom Sub-Lab Multi-Shape Drag Creation State (Tool 'shape-rect' - M)
    this.activeShapeType = 'rect'; // 'rect' | 'triangle' | 'circle' | 'hexagon'
    this.isDrawingLab = false;
    this.labStart = null;
    this.labCurrent = null;
    this.onCustomLabCreated = null;

    // Direct Selection (A) Anchor Point Editing State
    this.hoveredAnchor = null; // { i, j, x, y, key }
    this.isDraggingAnchor = false;
    this.draggedAnchor = null; // { i, j, x, y }
    this.dragCurrentAnchor = null; // { i, j, x, y }
    this.connectedAnchorEdges = []; // [ { key, edge, isU, isV } ]

    // Selection Tool (V) Bounding Box Resize State
    this.hoveredResizeHandle = null; // 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
    this.isResizingSelection = false;
    this.activeResizeHandle = null;
    this.resizeOrigBounds = null; // { minI, maxI, minJ, maxJ, x, y, w, h }
    this.resizeCurrentBounds = null;
    this.resizeOrigStitches = [];

    // Pen Tool Line Style (Sashiko Dashed vs Normal Solid)
    this.penLineStyle = 'dashed'; // 'dashed' | 'solid'

    // Erase drag state
    this.isErasing = false;

    // Performance: Spatial Hash Grid for O(1) Proximity Lookups
    this.spatialCellSize = 64;
    this.spatialGrid = new Map();
    this.spatialGridDirty = true;

    // High-Performance Path2D Batching & Invalidation Cache (Eliminates Canvas 2D Lag)
    this.pathCacheDirty = true;
    this.cachedNormalPath = new Path2D();
    this.cachedDimmedPath = new Path2D();
    this.cachedSelectedPath = new Path2D();
    this.hasCachedNormal = false;
    this.hasCachedDimmed = false;
    this.hasCachedSelected = false;
    this.cachedSelectedPoints = [];

    // Selection Floating Contextual Action Bar HUD
    this.selectionHudBounds = null;
    this.hoveredHudButton = -1;

    // Isolation / Focus Mode (Illustrator standard: dim non-isolated artwork)
    this.isolationMode = {
      active: false,
      type: null, // 'selection' | 'layer'
      targetId: null,
      stitchKeys: new Set(),
      label: ''
    };

    // Live Quadrant & Reflection Symmetry Engine ('none' | '4way' | 'horizontal' | 'vertical')
    this.symmetryMode = 'none';

    // Callbacks
    this.onStitchesChanged = null;
    this.onSelectionChanged = null;

    this.bindEvents();
  }

  setSymmetryMode(mode) {
    this.symmetryMode = mode || 'none';
    this.updateSymmetryUI();
    this.camera.requestRender();
  }

  toggleSymmetryMode() {
    const nextMode = this.symmetryMode === 'none' ? '4way' : 'none';
    this.setSymmetryMode(nextMode);
    return this.symmetryMode;
  }

  updateSymmetryUI() {
    const badge = document.getElementById('badge-symmetry-status');
    const btn = document.getElementById('btn-toggle-symmetry');
    const isActive = this.symmetryMode !== 'none';
    if (badge) {
      badge.textContent = isActive ? `Symmetry: ${this.symmetryMode.toUpperCase()}` : 'Symmetry: OFF';
      badge.classList.toggle('active', isActive);
    }
    if (btn) {
      btn.textContent = isActive ? `4-Way Symmetry: ON` : `4-Way Symmetry: OFF`;
      btn.classList.toggle('active', isActive);
    }
  }

  setShapeType(shapeType) {
    this.activeShapeType = shapeType;
    this.camera.requestRender();
  }

  setPenLineStyle(style) {
    this.penLineStyle = style;
    this.camera.requestRender();
  }

  computeShapePoints(shapeType, minX, minY, maxX, maxY) {
    const w = maxX - minX;
    const h = maxY - minY;
    const cx = minX + w / 2;
    const cy = minY + h / 2;
    const rx = w / 2;
    const ry = h / 2;

    switch (shapeType) {
      case 'diamond':
        return [
          { x: cx, y: minY },
          { x: maxX, y: cy },
          { x: cx, y: maxY },
          { x: minX, y: cy }
        ];
      case 'triangle':
        return [
          { x: cx, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY }
        ];
      case 'circle': {
        const pts = [];
        const steps = 32;
        for (let i = 0; i < steps; i++) {
          const theta = (i / steps) * Math.PI * 2;
          pts.push({
            x: cx + rx * Math.cos(theta),
            y: cy + ry * Math.sin(theta)
          });
        }
        return pts;
      }
      case 'hexagon': {
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const theta = (i / 6) * Math.PI * 2 - Math.PI / 2;
          pts.push({
            x: cx + rx * Math.cos(theta),
            y: cy + ry * Math.sin(theta)
          });
        }
        return pts;
      }
      case 'rect':
      default:
        return [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY }
        ];
    }
  }

  rebuildSpatialGrid() {
    this.spatialGrid.clear();
    const cellSize = this.spatialCellSize;
    for (const [k, edge] of this.stitches.entries()) {
      const p1 = this.latticeGrid.nodeToWorld(edge.u[0], edge.u[1]);
      const p2 = this.latticeGrid.nodeToWorld(edge.v[0], edge.v[1]);
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      const minCX = Math.floor(minX / cellSize);
      const maxCX = Math.floor(maxX / cellSize);
      const minCY = Math.floor(minY / cellSize);
      const maxCY = Math.floor(maxY / cellSize);
      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cy = minCY; cy <= maxCY; cy++) {
          const bucketKey = `${cx},${cy}`;
          let bucket = this.spatialGrid.get(bucketKey);
          if (!bucket) {
            bucket = new Set();
            this.spatialGrid.set(bucketKey, bucket);
          }
          bucket.add(k);
        }
      }
    }
    this.spatialGridDirty = false;
  }

  findNearestAnchor(worldPt) {
    if (this.spatialGridDirty) {
      this.rebuildSpatialGrid();
    }
    const thresholdPx = Math.max(12, 16 / (this.camera.zoom || 1));
    const cellSize = this.spatialCellSize;
    const minCX = Math.floor((worldPt.x - thresholdPx) / cellSize);
    const maxCX = Math.floor((worldPt.x + thresholdPx) / cellSize);
    const minCY = Math.floor((worldPt.y - thresholdPx) / cellSize);
    const maxCY = Math.floor((worldPt.y + thresholdPx) / cellSize);

    let nearest = null;
    let minDist = Infinity;
    const checked = new Set();

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const bucket = this.spatialGrid.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (const key of bucket) {
          if (checked.has(key)) continue;
          checked.add(key);

          const edge = this.stitches.get(key);
          if (!edge) continue;
          if (this.layerManager && this.layerManager.isLayerLocked(edge.layerId)) continue;

          const p1 = this.latticeGrid.nodeToWorld(edge.u[0], edge.u[1]);
          const d1 = Math.hypot(worldPt.x - p1.x, worldPt.y - p1.y);
          if (d1 <= thresholdPx && d1 < minDist) {
            minDist = d1;
            nearest = { i: edge.u[0], j: edge.u[1], x: p1.x, y: p1.y, key };
          }
          const p2 = this.latticeGrid.nodeToWorld(edge.v[0], edge.v[1]);
          const d2 = Math.hypot(worldPt.x - p2.x, worldPt.y - p2.y);
          if (d2 <= thresholdPx && d2 < minDist) {
            minDist = d2;
            nearest = { i: edge.v[0], j: edge.v[1], x: p2.x, y: p2.y, key };
          }
        }
      }
    }
    return nearest;
  }

  getHudButtons() {
    return [
      { id: 'fill', label: '⛩️ Fill', action: () => this.fillSelectionWithPattern() },
      { id: 'lab', label: '⚡ Lab', action: () => this.convertSelectionToLab() },
      { id: 'focus', label: '🔍 Focus', action: () => this.enterIsolationMode('selection') },
      { id: 'lock', label: '🔒 Lock', action: () => this.lockSelectedStitches() },
      { id: 'dup', label: '⎘ Dup', action: () => this.duplicateSelected() },
      { id: 'rot', label: '↻ 90°', action: () => this.rotateSelected(90) },
      { id: 'mir', label: '⇄ Flip', action: () => this.mirrorSelected() },
      { id: 'del', label: '🗑 Del', action: () => this.deleteSelected() }
    ];
  }

  computeHudBounds(bounds) {
    if (!bounds) return null;
    const zoom = this.camera.zoom || 1;
    const buttons = this.getHudButtons();
    const btnCount = buttons.length;
    const btnW = 48 / zoom;
    const hudW = btnW * btnCount;
    const hudH = 26 / zoom;
    const cx = bounds.x + bounds.w / 2;
    const x = cx - hudW / 2;
    let y = bounds.y - hudH - (10 / zoom);
    if (y < 4 / zoom) {
      y = bounds.y + bounds.h + (10 / zoom);
    }
    return { x, y, w: hudW, h: hudH, btnW, btnCount };
  }

  findHudButton(worldPt) {
    if (!this.selectionHudBounds) return -1;
    const b = this.selectionHudBounds;
    if (worldPt.x >= b.x && worldPt.x <= b.x + b.w &&
        worldPt.y >= b.y && worldPt.y <= b.y + b.h) {
      const idx = Math.floor((worldPt.x - b.x) / b.btnW);
      return Math.max(0, Math.min(b.btnCount - 1, idx));
    }
    return -1;
  }

  executeHudButton(btnIdx) {
    const buttons = this.getHudButtons();
    if (buttons[btnIdx]) {
      buttons[btnIdx].action();
    }
  }

  getSelectedBounds() {
    if (this.selectedStitches.size === 0) return null;
    let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
    for (const k of this.selectedStitches) {
      const edge = this.stitches.get(k);
      if (!edge) continue;
      minI = Math.min(minI, edge.u[0], edge.v[0]);
      maxI = Math.max(maxI, edge.u[0], edge.v[0]);
      minJ = Math.min(minJ, edge.u[1], edge.v[1]);
      maxJ = Math.max(maxJ, edge.u[1], edge.v[1]);
    }
    if (minI === Infinity) return null;
    const tl = this.latticeGrid.nodeToWorld(minI, minJ);
    const br = this.latticeGrid.nodeToWorld(maxI, maxJ);
    return {
      minI, maxI, minJ, maxJ,
      x: tl.x,
      y: tl.y,
      w: br.x - tl.x,
      h: br.y - tl.y
    };
  }

  getResizeHandles(bounds) {
    if (!bounds) return {};
    const { x, y, w, h } = bounds;
    return {
      nw: { x, y, cursor: 'nwse-resize' },
      n:  { x: x + w / 2, y, cursor: 'ns-resize' },
      ne: { x: x + w, y, cursor: 'nesw-resize' },
      e:  { x: x + w, y: y + h / 2, cursor: 'ew-resize' },
      se: { x: x + w, y: y + h, cursor: 'nwse-resize' },
      s:  { x: x + w / 2, y: y + h, cursor: 'ns-resize' },
      sw: { x, y: y + h, cursor: 'nesw-resize' },
      w:  { x, y: y + h / 2, cursor: 'ew-resize' }
    };
  }

  findResizeHandle(worldPt) {
    const bounds = this.getSelectedBounds();
    if (!bounds || (bounds.w === 0 && bounds.h === 0)) return null;
    const handleHitDist = Math.max(8, 10 / (this.camera.zoom || 1));
    const handles = this.getResizeHandles(bounds);
    for (const [name, h] of Object.entries(handles)) {
      if (Math.hypot(worldPt.x - h.x, worldPt.y - h.y) <= handleHitDist) {
        return { name, ...h };
      }
    }
    return null;
  }

  setTool(tool) {
    this.activeTool = tool;
    this.latticeGrid.ghostEdge = null;
    this.latticeGrid.hoverNode = null;
    this.marqueeStart = null;
    this.marqueeCurrent = null;
    this.isSelecting = false;
    this.isDraggingSelection = false;
    this.dragStartNode = null;
    this.dragCurrentNode = null;
    this.hoveredStitchKey = null;
    this.isDrawingLab = false;
    this.labStart = null;
    this.labCurrent = null;
    this.hoveredAnchor = null;
    this.isDraggingAnchor = false;
    this.draggedAnchor = null;
    this.dragCurrentAnchor = null;
    this.connectedAnchorEdges = [];
    this.hoveredResizeHandle = null;
    this.isResizingSelection = false;
    this.activeResizeHandle = null;
    this.resizeCurrentBounds = null;

    // Toggle Shape picker HUD when shape-rect tool is active
    const shapeHud = document.getElementById('shape-picker-hud');
    if (shapeHud) {
      shapeHud.classList.toggle('hidden', tool !== 'shape-rect');
    }

    // Toggle Curve Symmetry HUD when arc or curve tool is active
    const symmetryHud = document.getElementById('curve-symmetry-hud');
    if (symmetryHud) {
      symmetryHud.classList.toggle('hidden', tool !== 'arc' && tool !== 'curve');
    }

    // Notify CurveEngine of active mode
    if (this.curveEngine) {
      if (tool === 'arc') {
        this.curveEngine.setMode('arc');
      } else if (tool === 'curve') {
        this.curveEngine.setMode('curve');
      } else {
        this.curveEngine.cancel();
      }
    }

    // If switching away from pen, end any active chain
    if (tool !== 'pen') {
      this.chainAnchor = null;
    }

    this.updateCursor();
    this.camera.requestRender();

    // Update UI active buttons
    document.querySelectorAll('.tool-icon-btn[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  updateCursor() {
    if (this.activeTool === 'pen' || this.activeTool === 'shape-rect' || this.activeTool === 'arc' || this.activeTool === 'curve') {
      this.canvas.style.cursor = 'crosshair';
    } else if (this.activeTool === 'eraser') {
      this.canvas.style.cursor = 'crosshair';
    } else if (this.activeTool === 'select' || this.activeTool === 'direct-select') {
      this.canvas.style.cursor = 'default';
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  resetTransientState() {
    this.isDrawing = false;
    this.chainAnchor = null;
    this.startNode = null;
    this.hasMovedPastThreshold = false;
    this.isSelecting = false;
    this.marqueeStart = null;
    this.marqueeCurrent = null;
    this.isDraggingSelection = false;
    this.dragStartNode = null;
    this.dragCurrentNode = null;
    this.isDraggingAnchor = false;
    this.draggedAnchor = null;
    this.dragCurrentAnchor = null;
    this.connectedAnchorEdges = [];
    this.isResizingSelection = false;
    this.activeResizeHandle = null;
    this.resizeOrigBounds = null;
    this.resizeCurrentBounds = null;
    this.resizeOrigStitches = [];
    this.isErasing = false;
    this.isDrawingLab = false;
    this.labStart = null;
    this.labCurrent = null;
    if (this.latticeGrid) {
      this.latticeGrid.ghostEdge = null;
      this.latticeGrid.hoverNode = null;
    }
    this.smartGuides?.clearGuides?.();
    this.updateCursor();
    this.camera.requestRender();
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));

    this.canvas.addEventListener('contextmenu', (e) => {
      this.onContextMenu(e);
    });

    this.canvas.addEventListener('pointerleave', () => {
      this.latticeGrid.hoverNode = null;
      if (!this.chainAnchor && this.latticeGrid.ghostEdge) {
        this.latticeGrid.ghostEdge = null;
      }
      this.camera.requestRender();
    });

    // Double click on canvas: In Select mode, selects whole pattern/partition group; In Eraser mode, deletes stitch; In Pen mode, finishes chain
    this.canvas.addEventListener('dblclick', (e) => {
      const worldPt = this.camera.screenToWorld(e.clientX, e.clientY);
      const nearestKey = this.hoveredStitchKey || this.findNearestEdge(worldPt);
      if (nearestKey) {
        if (this.activeTool === 'select') {
          // Double-click on any stitch selects all stitches of that motif / partition!
          const targetEdge = this.stitches.get(nearestKey);
          const partId = targetEdge?.partitionId;
          const grpId = targetEdge?.groupId;
          this.selectedStitches.clear();
          for (const [k, edge] of this.stitches.entries()) {
            if ((partId && edge.partitionId === partId) || (grpId && edge.groupId === grpId)) {
              this.selectedStitches.add(k);
            }
          }
          if (this.selectedStitches.size === 0) {
            this.selectedStitches.add(nearestKey);
          }
          this.notifySelection();
          this.camera.requestRender();
          return;
        } else if (this.activeTool === 'eraser') {
          this.deleteStitch(nearestKey);
          this.hoveredStitchKey = null;
          this.chainAnchor = null;
          this.latticeGrid.ghostEdge = null;
          this.notifyChange();
          this.camera.requestRender();
          return;
        }
      }

      if (this.chainAnchor) {
        this.chainAnchor = null;
        this.latticeGrid.ghostEdge = null;
        this.camera.requestRender();
      }
    });

    // Keyboard shortcuts: V (select), A (direct-select), P (pen), E (eraser), Esc/Enter (end chain), Del (delete selected)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Handle modifier key shortcuts first (Ctrl/Cmd)
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // Ctrl+D duplicates selected stitches offset by 1 grid cell
        if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
          if (this.selectedStitches.size > 0) {
            e.preventDefault();
            this.duplicateSelected();
          }
        }
        // Ctrl+A selects all stitches in active shape / partition, or all on canvas
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault();
          this.selectAllInShapeOrCanvas();
        }
        // Do NOT trigger single-letter tool switching when modifiers are held (e.g. Ctrl+V, Ctrl+A, Ctrl+P)
        return;
      }

      if (e.key === 'p' || e.key === 'P') this.setTool('pen');
      if (e.key === 'v' || e.key === 'V') this.setTool('select');
      if (e.key === 'a' || e.key === 'A') this.setTool('direct-select');
      if (e.key === 'e' || e.key === 'E') this.setTool('eraser');
      if (e.key === 'm' || e.key === 'M') this.setTool('shape-rect');
      if (e.key === 'c' || e.key === 'C') {
        if (e.shiftKey) {
          this.setTool('curve');
        } else {
          this.setTool('arc');
        }
      }

      // Esc or Enter completes the pen chain
      if (e.key === 'Escape' || e.key === 'Enter') {
        if (this.chainAnchor) {
          this.chainAnchor = null;
          this.latticeGrid.ghostEdge = null;
          this.camera.requestRender();
        }
        if (this.selectedStitches.size > 0) {
          this.clearSelection();
        }
      }

      // Delete or Backspace deletes selected stitches
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedStitches.size > 0) {
          e.preventDefault();
          this.deleteSelected();
        }
      }
    });
  }

  onPointerDown(e) {
    if (e.button !== 0) return; // Left click only

    // Guard: Handled by CurveEngine when Arc or Curve tool is active
    if (this.activeTool === 'arc' || this.activeTool === 'curve') {
      return;
    }

    // Guard: Prevent pan dragging (Spacebar or Middle Click) from placing stitches or clearing selections
    if (this.camera && (this.camera.spacePressed || this.camera.isPanning || e.button === 1)) {
      return;
    }

    // Guard: Freeze all stitch/canvas interactions when Hardware Trace Lock is active
    if (this.camera?.artLabManager?.isTraceLocked) {
      e.preventDefault();
      return;
    }

    const worldPt = this.camera.screenToWorld(e.clientX, e.clientY);

    // Delegate to LayerManager if clicking on image handles or floating buttons
    if (this.layerManager && this.layerManager.handlePointerDown(e, worldPt)) {
      this.camera.requestRender();
      return;
    }

    // Guard 0: Never start drawing outside artboard bounds when work area framing is enabled
    if (this.camera.workAreaEnabled) {
      if (worldPt.x < -2 || worldPt.y < -2 ||
          worldPt.x > this.camera.artboardWidthPx + 2 ||
          worldPt.y > this.camera.artboardHeightPx + 2) {
        this.chainAnchor = null;
        this.latticeGrid.ghostEdge = null;
        return;
      }
    }

    // Guard 0B: When active lab constraint is ON, never draw outside active lab boundary!
    if (this.subLabManager && this.subLabManager.isGreenSubLabActive && this.subLabManager.constrainToLab) {
      const activePart = this.subLabManager.getActivePartition();
      if (activePart && activePart.points && activePart.points.length >= 3) {
        const isInside = this.subLabManager.partitionEngine.isPointInside(worldPt, activePart.points);
        if (!isInside) {
          this.chainAnchor = null;
          this.latticeGrid.ghostEdge = null;
          return;
        }
      }
    }

    // Guard 1: Never start drawing or chaining if clicking on Work Area Badge (Edit Size pill)
    if (this.camera.workAreaBadgeBounds) {
      const b = this.camera.workAreaBadgeBounds;
      const pad = 8 / (this.camera.zoom || 1);
      if (worldPt.x >= b.x - pad && worldPt.x <= b.x + b.w + pad &&
          worldPt.y >= b.y - pad && worldPt.y <= b.y + b.h + pad) {
        this.chainAnchor = null;
        this.latticeGrid.ghostEdge = null;
        return;
      }
    }

    // Guard 2: Never start drawing if clicking on Rulers
    if (this.camera.showRulers) {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (sx <= 24 || sy <= 24) {
        this.chainAnchor = null;
        this.latticeGrid.ghostEdge = null;
        return;
      }
    }

    const nearestKey = this.hoveredStitchKey || this.findNearestEdge(worldPt);

    // Double-click handler: in select mode, selects the entire pattern/partition group!
    if (e.detail >= 2) {
      if (nearestKey) {
        const targetEdge = this.stitches.get(nearestKey);
        const groupKeys = new Set();
        if (targetEdge) {
          const partId = targetEdge.partitionId;
          const grpId = targetEdge.groupId;
          for (const [k, st] of this.stitches.entries()) {
            if ((partId && st.partitionId === partId) || (grpId && st.groupId === grpId)) {
              groupKeys.add(k);
            }
          }
        }
        if (groupKeys.size > 0) {
          this.selectedStitches = groupKeys;
        } else {
          this.selectedStitches = new Set([nearestKey]);
        }
        this.notifySelection();
      }
      this.hoveredStitchKey = null;
      this.chainAnchor = null;
      this.isDrawing = false;
      this.startNode = null;
      this.latticeGrid.ghostEdge = null;
      this.camera.requestRender();
      return;
    }

    // Shift+Click deletion across all tools:
    if (e.shiftKey && nearestKey) {
      this.deleteStitch(nearestKey);
      this.hoveredStitchKey = null;
      this.chainAnchor = null;
      this.isDrawing = false;
      this.startNode = null;
      this.latticeGrid.ghostEdge = null;
      this.camera.requestRender();
      return;
    }

    const snap = this.latticeGrid.snapToNode(worldPt);

    // 1. PEN TOOL INTERACTION (Continuous Chaining & Unlimited Branching from ANY Node)
    if (this.activeTool === 'pen') {
      this.isDrawing = true;
      this.hasMovedPastThreshold = false;
      this.startNode = snap;

      if (!this.chainAnchor) {
        // Start first chain anchor on ANY node (new or already used for stitches)
        this.chainAnchor = snap;
      } else {
        // We already have an anchor: clicking any node commits the stitch (allows multiple lines meeting at same vertex!)
        if (snap.i !== this.chainAnchor.i || snap.j !== this.chainAnchor.j) {
          this.commitEdge(this.chainAnchor, snap, true);
          // Auto-chain: target node becomes the next starting anchor!
          this.chainAnchor = snap;
        }
      }
      this.camera.requestRender();
    }
    // 2. DIRECT SELECTION TOOL (A): Click anchor point to drag/re-anchor, or click segment to select
    else if (this.activeTool === 'direct-select') {
      const nearestAnchor = this.findNearestAnchor(worldPt);
      if (nearestAnchor) {
        this.isDraggingAnchor = true;
        this.draggedAnchor = nearestAnchor;
        this.dragCurrentAnchor = nearestAnchor;
        this.connectedAnchorEdges = [];
        for (const [key, edge] of this.stitches.entries()) {
          if (this.layerManager && this.layerManager.isLayerLocked(edge.layerId)) continue;
          const isU = (Math.abs(edge.u[0] - nearestAnchor.i) < 1e-4 && Math.abs(edge.u[1] - nearestAnchor.j) < 1e-4);
          const isV = (Math.abs(edge.v[0] - nearestAnchor.i) < 1e-4 && Math.abs(edge.v[1] - nearestAnchor.j) < 1e-4);
          if (isU || isV) {
            this.connectedAnchorEdges.push({ key, edge: { ...edge }, isU, isV });
          }
        }
        this.canvas.style.cursor = 'grabbing';
        this.camera.requestRender();
        return;
      }

      const nearestKey = this.findNearestEdge(worldPt);
      if (nearestKey) {
        if (e.shiftKey) {
          // Shift+Click deletes segment
          this.deleteStitch(nearestKey);
          this.hoveredStitchKey = null;
          return;
        } else {
          // Single-click SELECTS (DO NOT AUTO-DELETE!)
          this.selectedStitches = new Set([nearestKey]);
          this.notifySelection();
          this.camera.requestRender();
        }
      } else {
        this.clearSelection();
      }
    }
    // 3. MARQUEE SELECTION TOOL (V): Check Floating HUD FIRST, then resize handles, then drag-to-move selected OR Marquee box
    else if (this.activeTool === 'select') {
      const hudBtn = this.findHudButton(worldPt);
      if (hudBtn !== -1) {
        this.executeHudButton(hudBtn);
        return;
      }

      const resizeHandle = this.findResizeHandle(worldPt);
      if (resizeHandle && this.selectedStitches.size > 0) {
        this.isResizingSelection = true;
        this.activeResizeHandle = resizeHandle.name;
        const bounds = this.getSelectedBounds();
        this.resizeOrigBounds = bounds;
        this.resizeCurrentBounds = {
          newMinI: bounds.minI,
          newMaxI: bounds.maxI,
          newMinJ: bounds.minJ,
          newMaxJ: bounds.maxJ
        };
        this.resizeOrigStitches = [];
        for (const k of this.selectedStitches) {
          const edge = this.stitches.get(k);
          if (edge) {
            this.resizeOrigStitches.push({
              key: k,
              u: [...edge.u],
              v: [...edge.v],
              partitionId: edge.partitionId,
              layerId: edge.layerId,
              groupId: edge.groupId
            });
          }
        }
        this.canvas.style.cursor = resizeHandle.cursor;
        return;
      }

      const nearestKey = this.findNearestEdge(worldPt);
      if (nearestKey) {
        const edge = this.stitches.get(nearestKey);
        if (this.layerManager && this.layerManager.isLayerLocked(edge?.layerId)) {
          return; // Protected by locked layer
        }
        if (edge?.locked) {
          return; // Protected by individual line lock!
        }
        if (this.isolationMode.active && !this.isolationMode.stitchKeys.has(nearestKey)) {
          return; // Protected by isolation mode: non-isolated stitches cannot be selected or moved!
        }

        if (e.shiftKey) {
          // Shift+Click TOGGLES multi-selection (Standard Figma / Illustrator vector behavior)
          if (this.selectedStitches.has(nearestKey)) {
            this.selectedStitches.delete(nearestKey);
          } else {
            this.selectedStitches.add(nearestKey);
          }
          this.notifySelection();
          this.camera.requestRender();
          return;
        } else {
          // If clicked stitch is not already selected, select it as the active item
          if (!this.selectedStitches.has(nearestKey)) {
            this.selectedStitches = new Set([nearestKey]);
          }
          // If already selected, retain selection so entire group can be dragged together!
        }
        // Start drag-to-move of selected stitches
        this.isDraggingSelection = true;
        this.dragStartNode = snap;
        this.dragCurrentNode = snap;
        this.notifySelection();
        this.camera.requestRender();
        return;
      }

      // Click on empty space: start Marquee selection box
      this.isSelecting = true;
      this.marqueeStart = worldPt;
      this.marqueeCurrent = worldPt;
      if (!e.shiftKey) {
        this.selectedStitches.clear();
        this.notifySelection();
      }
      this.camera.requestRender();
    }
    // 4. ERASER TOOL
    else if (this.activeTool === 'eraser') {
      this.isErasing = true;
      this.eraseAtPoint(worldPt);
    }
    // 5. CUSTOM SUB-LAB MULTI-SHAPE DRAW (Tool 'shape-rect' - M)
    else if (this.activeTool === 'shape-rect') {
      this.isDrawingLab = true;
      this.labStart = snap;
      this.labCurrent = snap;
      this.camera.requestRender();
    }
  }

  onPointerMove(e) {
    // Guard: Handled by CurveEngine when Arc or Curve tool is active
    if (this.activeTool === 'arc' || this.activeTool === 'curve') {
      return;
    }

    // Guard: Ignore pen/tool movement when panning with Spacebar or middle mouse
    if (this.camera && (this.camera.spacePressed || this.camera.isPanning)) {
      return;
    }

    let worldPt = this.camera.screenToWorld(e.clientX, e.clientY);

    // Delegate to LayerManager if dragging image or handles
    if (this.layerManager && this.layerManager.handlePointerMove(e, worldPt)) {
      this.camera.requestRender();
      return;
    }

    // Guard 0: Outside artboard bounds when work area framing is enabled
    if (this.camera.workAreaEnabled) {
      if (worldPt.x < -2 || worldPt.y < -2 ||
          worldPt.x > this.camera.artboardWidthPx + 2 ||
          worldPt.y > this.camera.artboardHeightPx + 2) {
        if (this.latticeGrid.hoverNode || this.hoveredStitchKey) {
          this.latticeGrid.hoverNode = null;
          this.hoveredStitchKey = null;
          this.camera.requestRender();
        }
        return;
      }
    }

    // Guard 0B: When active lab constraint is ON, never hover or preview outside active lab boundary!
    if (this.subLabManager && this.subLabManager.isGreenSubLabActive && this.subLabManager.constrainToLab) {
      const activePart = this.subLabManager.getActivePartition();
      if (activePart && activePart.points && activePart.points.length >= 3) {
        const isInside = this.subLabManager.partitionEngine.isPointInside(worldPt, activePart.points);
        if (!isInside) {
          if (this.latticeGrid.hoverNode || this.hoveredStitchKey) {
            this.latticeGrid.hoverNode = null;
            this.hoveredStitchKey = null;
            this.camera.requestRender();
          }
          return;
        }
      }
    }

    // Guard 1: If over Work Area Badge, clear hover node and return
    if (this.camera.workAreaBadgeBounds) {
      const b = this.camera.workAreaBadgeBounds;
      const pad = 8 / (this.camera.zoom || 1);
      if (worldPt.x >= b.x - pad && worldPt.x <= b.x + b.w + pad &&
          worldPt.y >= b.y - pad && worldPt.y <= b.y + b.h + pad) {
        if (this.latticeGrid.hoverNode || this.hoveredStitchKey) {
          this.latticeGrid.hoverNode = null;
          this.hoveredStitchKey = null;
          this.camera.requestRender();
        }
        return;
      }
    }

    // 1. PEN TOOL HOVER & GHOST PREVIEW
    if (this.activeTool === 'pen') {
      const snap = this.latticeGrid.snapToNode(worldPt);
      this.latticeGrid.hoverNode = snap;
      this.smartGuides?.computeGuides(snap);

      // In Pen mode, hovering an existing stitch line highlights it with the '-' indicator
      // for both Shift+Click AND Double-Click deletion (when not actively drawing a chain)
      if (!this.chainAnchor) {
        // If close to a grid node, prioritize node snapping over segment deletion
        const distToSnap = Math.hypot(worldPt.x - snap.x, worldPt.y - snap.y);
        const nodeThreshold = Math.max(10, 14 / (this.camera.zoom || 1));
        const nearestKey = distToSnap < nodeThreshold ? null : this.findNearestEdge(worldPt);
        if (this.hoveredStitchKey !== nearestKey) {
          this.hoveredStitchKey = nearestKey;
          this.camera.requestRender();
        }
      } else if (this.hoveredStitchKey) {
        this.hoveredStitchKey = null;
        this.camera.requestRender();
      }

      if (this.chainAnchor) {
        let targetPt = snap;
        // Shift key locks to orthogonal angles (0°, 45°, 90°)
        if (e.shiftKey) {
          const dx = worldPt.x - this.chainAnchor.x;
          const dy = worldPt.y - this.chainAnchor.y;
          const angle = Math.atan2(dy, dx);
          const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          const d = Math.hypot(dx, dy);
          const orthoWorld = {
            x: this.chainAnchor.x + Math.cos(snapAngle) * d,
            y: this.chainAnchor.y + Math.sin(snapAngle) * d
          };
          targetPt = this.latticeGrid.snapToNode(orthoWorld);
        }

        const deltaX = targetPt.x - this.chainAnchor.x;
        const deltaY = targetPt.y - this.chainAnchor.y;
        const lengthMm = ((Math.hypot(deltaX, deltaY) / this.camera.ppi) * 25.4).toFixed(1);
        const angleDeg = Math.round(((Math.atan2(deltaY, deltaX) * 180 / Math.PI) + 360) % 360);

        if (targetPt.i !== this.chainAnchor.i || targetPt.j !== this.chainAnchor.j) {
          this.latticeGrid.ghostEdge = {
            u: [this.chainAnchor.i, this.chainAnchor.j],
            v: [targetPt.i, targetPt.j],
            color: '#3B82F6', // Illustrator blue
            width: 2.2,
            lengthMm,
            angleDeg
          };
        } else {
          this.latticeGrid.ghostEdge = null;
        }
      }
      this.camera.requestRender();
    }
    // 2. SELECTION TOOL (V) - RESIZING, DRAG-TO-MOVE OR MARQUEE BOX OR HOVER
    else if (this.activeTool === 'select') {
      if (this.isResizingSelection && this.resizeOrigBounds) {
        const snap = this.latticeGrid.snapToNode(worldPt);
        const orig = this.resizeOrigBounds;
        let newMinI = orig.minI;
        let newMaxI = orig.maxI;
        let newMinJ = orig.minJ;
        let newMaxJ = orig.maxJ;

        switch (this.activeResizeHandle) {
          case 'se':
            newMaxI = Math.max(orig.minI + 1, snap.i);
            newMaxJ = Math.max(orig.minJ + 1, snap.j);
            break;
          case 's':
            newMaxJ = Math.max(orig.minJ + 1, snap.j);
            break;
          case 'e':
            newMaxI = Math.max(orig.minI + 1, snap.i);
            break;
          case 'nw':
            newMinI = Math.min(orig.maxI - 1, snap.i);
            newMinJ = Math.min(orig.maxJ - 1, snap.j);
            break;
          case 'n':
            newMinJ = Math.min(orig.maxJ - 1, snap.j);
            break;
          case 'w':
            newMinI = Math.min(orig.maxI - 1, snap.i);
            break;
          case 'ne':
            newMaxI = Math.max(orig.minI + 1, snap.i);
            newMinJ = Math.min(orig.maxJ - 1, snap.j);
            break;
          case 'sw':
            newMinI = Math.min(orig.maxI - 1, snap.i);
            newMaxJ = Math.max(orig.minJ + 1, snap.j);
            break;
        }
        this.resizeCurrentBounds = { newMinI, newMaxI, newMinJ, newMaxJ };
        this.camera.requestRender();
      } else if (this.isDraggingSelection) {
        const snap = this.latticeGrid.snapToNode(worldPt);
        this.dragCurrentNode = snap;
        this.smartGuides?.computeGuides(snap);
        this.camera.requestRender();
      } else if (this.isSelecting) {
        this.marqueeCurrent = worldPt;
        this.updateMarqueeSelection(e.shiftKey);
        this.camera.requestRender();
      } else {
        const hudBtn = this.findHudButton(worldPt);
        this.hoveredHudButton = hudBtn;
        if (hudBtn !== -1) {
          this.canvas.style.cursor = 'pointer';
          this.hoveredResizeHandle = null;
          this.hoveredStitchKey = null;
        } else {
          const handle = this.findResizeHandle(worldPt);
          this.hoveredResizeHandle = handle ? handle.name : null;
          if (handle) {
            this.canvas.style.cursor = handle.cursor;
          } else {
            this.canvas.style.cursor = 'default';
            const nearestKey = this.findNearestEdge(worldPt);
            if (this.hoveredStitchKey !== nearestKey) {
              this.hoveredStitchKey = nearestKey;
            }
          }
        }
        this.camera.requestRender();
      }
    }
    // 3. DIRECT SELECT HOVER & ANCHOR DRAG (A)
    else if (this.activeTool === 'direct-select') {
      if (this.isDraggingAnchor) {
        const snap = this.latticeGrid.snapToNode(worldPt);
        this.dragCurrentAnchor = snap;
        this.smartGuides?.computeGuides(snap);
        this.camera.requestRender();
      } else {
        const nearestAnchor = this.findNearestAnchor(worldPt);
        this.hoveredAnchor = nearestAnchor;
        if (nearestAnchor) {
          this.canvas.style.cursor = 'grab';
          this.hoveredStitchKey = null;
        } else {
          this.canvas.style.cursor = 'default';
          const nearestKey = this.findNearestEdge(worldPt);
          if (this.hoveredStitchKey !== nearestKey) {
            this.hoveredStitchKey = nearestKey;
          }
        }
        this.camera.requestRender();
      }
    }
    // 4. ERASER DRAG
    else if (this.activeTool === 'eraser' && this.isErasing) {
      this.eraseAtPoint(worldPt);
    }
    // 5. CUSTOM SUB-LAB PREVIEW DRAG (M)
    else if (this.activeTool === 'shape-rect' && this.isDrawingLab) {
      const snap = this.latticeGrid.snapToNode(worldPt);
      this.labCurrent = snap;
      this.camera.requestRender();
    }
  }

  onPointerUp(e) {
    // Guard: Handled by CurveEngine when Arc or Curve tool is active
    if (this.activeTool === 'arc' || this.activeTool === 'curve') {
      return;
    }

    if (this.camera && (this.camera.spacePressed || this.camera.isPanning)) {
      return;
    }

    const worldPt = this.camera.screenToWorld(e.clientX, e.clientY);
    if (this.layerManager && this.layerManager.handlePointerUp(e, worldPt)) {
      this.camera.requestRender();
      return;
    }

    if (this.activeTool === 'pen') {
      this.isDrawing = false;
      // Natural drag-to-draw: If user clicked and dragged to a different node, commit stitch on release!
      const snap = this.latticeGrid.snapToNode(worldPt);
      if (this.startNode && (snap.i !== this.startNode.i || snap.j !== this.startNode.j)) {
        this.commitEdge(this.startNode, snap, true);
        this.chainAnchor = null;
        this.latticeGrid.ghostEdge = null;
      }
      this.camera.requestRender();
    } else if (this.activeTool === 'select') {
      if (this.isResizingSelection) {
        this.isResizingSelection = false;
        this.canvas.style.cursor = 'default';
        if (this.resizeCurrentBounds && this.resizeOrigBounds && this.resizeOrigStitches.length > 0) {
          const { newMinI, newMaxI, newMinJ, newMaxJ } = this.resizeCurrentBounds;
          const { minI: oMinI, maxI: oMaxI, minJ: oMinJ, maxJ: oMaxJ } = this.resizeOrigBounds;
          const spanI = oMaxI - oMinI || 1;
          const spanJ = oMaxJ - oMinJ || 1;
          const newSpanI = newMaxI - newMinI;
          const newSpanJ = newMaxJ - newMinJ;

          for (const item of this.resizeOrigStitches) {
            this.stitches.delete(item.key);
            this.selectedStitches.delete(item.key);
          }

          const newKeys = new Set();
          for (const item of this.resizeOrigStitches) {
            const tU_I = (item.u[0] - oMinI) / spanI;
            const tU_J = (item.u[1] - oMinJ) / spanJ;
            const tV_I = (item.v[0] - oMinI) / spanI;
            const tV_J = (item.v[1] - oMinJ) / spanJ;

            const roundCoord = (val) => Number(val.toFixed(3));
            const newU = [
              roundCoord(newMinI + tU_I * newSpanI),
              roundCoord(newMinJ + tU_J * newSpanJ)
            ];
            const newV = [
              roundCoord(newMinI + tV_I * newSpanI),
              roundCoord(newMinJ + tV_J * newSpanJ)
            ];

            if (newU[0] === newV[0] && newU[1] === newV[1]) continue;

            const nk = edgeKey(newU[0], newU[1], newV[0], newV[1]);
            this.stitches.set(nk, {
              u: newU,
              v: newV,
              partitionId: item.partitionId,
              layerId: item.layerId,
              groupId: item.groupId
            });
            newKeys.add(nk);
          }
          this.selectedStitches = newKeys;
          this.notifyChange();
          this.notifySelection();
        }
        this.activeResizeHandle = null;
        this.resizeOrigBounds = null;
        this.resizeCurrentBounds = null;
        this.resizeOrigStitches = [];
        this.camera.requestRender();
      } else if (this.isDraggingSelection) {
        this.isDraggingSelection = false;
        if (this.dragStartNode && this.dragCurrentNode) {
          const dI = this.dragCurrentNode.i - this.dragStartNode.i;
          const dJ = this.dragCurrentNode.j - this.dragStartNode.j;
          if (dI !== 0 || dJ !== 0) {
            if (e.altKey) {
              this.duplicateSelectedWithOffset(dI, dJ);
            } else {
              this.moveSelectedWithOffset(dI, dJ);
            }
          }
        }
        this.dragStartNode = null;
        this.dragCurrentNode = null;
        this.smartGuides?.clearGuides();
        this.camera.requestRender();
      }
      if (this.isSelecting) {
        this.isSelecting = false;
        this.updateMarqueeSelection(e.shiftKey);
        this.marqueeStart = null;
        this.marqueeCurrent = null;
        this.notifySelection();
        this.camera.requestRender();
      }
    } else if (this.activeTool === 'direct-select') {
      if (this.isDraggingAnchor) {
        this.isDraggingAnchor = false;
        this.canvas.style.cursor = 'default';
        if (this.draggedAnchor && this.dragCurrentAnchor) {
          const newI = this.dragCurrentAnchor.i;
          const newJ = this.dragCurrentAnchor.j;
          if (newI !== this.draggedAnchor.i || newJ !== this.draggedAnchor.j) {
            for (const item of this.connectedAnchorEdges) {
              this.stitches.delete(item.key);
              this.selectedStitches.delete(item.key);
              const u = item.isU ? [newI, newJ] : [...item.edge.u];
              const v = item.isV ? [newI, newJ] : [...item.edge.v];
              if (u[0] === v[0] && u[1] === v[1]) continue;
              const nk = edgeKey(u[0], u[1], v[0], v[1]);
              this.stitches.set(nk, {
                u,
                v,
                partitionId: item.edge.partitionId,
                layerId: item.edge.layerId,
                groupId: item.edge.groupId
              });
            }
            this.notifyChange();
          }
        }
        this.draggedAnchor = null;
        this.dragCurrentAnchor = null;
        this.connectedAnchorEdges = [];
        this.smartGuides?.clearGuides();
        this.camera.requestRender();
      }
    } else if (this.activeTool === 'eraser') {
      this.isErasing = false;
      this.notifyChange();
    } else if (this.activeTool === 'shape-rect' && this.isDrawingLab) {
      this.isDrawingLab = false;
      if (this.labStart && this.labCurrent) {
        const minX = Math.min(this.labStart.x, this.labCurrent.x);
        const maxX = Math.max(this.labStart.x, this.labCurrent.x);
        const minY = Math.min(this.labStart.y, this.labCurrent.y);
        const maxY = Math.max(this.labStart.y, this.labCurrent.y);
        const w = maxX - minX;
        const h = maxY - minY;
        if (w >= 20 && h >= 20 && typeof this.onCustomLabCreated === 'function') {
          const points = this.computeShapePoints(this.activeShapeType, minX, minY, maxX, maxY);
          this.onCustomLabCreated({
            minX, minY, maxX, maxY, w, h,
            points,
            shapeType: this.activeShapeType,
            startNode: this.labStart,
            endNode: this.labCurrent
          });
        }
      }
      this.labStart = null;
      this.labCurrent = null;
      this.camera.requestRender();
    }
  }

  onContextMenu(e) {
    e.preventDefault();
    const worldPt = this.camera.screenToWorld(e.clientX, e.clientY);

    // 1. In Pen mode with active chain: Right-click commits to magnetic snap dot & finishes chain!
    if (this.activeTool === 'pen' && this.chainAnchor) {
      const snap = this.latticeGrid.snapToNode(worldPt);
      if (snap.i !== this.chainAnchor.i || snap.j !== this.chainAnchor.j) {
        this.commitEdge(this.chainAnchor, snap, true);
      }
      this.chainAnchor = null;
      this.latticeGrid.ghostEdge = null;
      this.camera.requestRender();
      return;
    }

    // 2. If right-clicking on an image layer: trigger custom image context menu
    if (this.layerManager && this.layerManager.handleContextMenu(e, worldPt)) {
      return;
    }

    // 3. Right-click on or near stitch: ensure it is part of selection
    const nearestKey = this.hoveredStitchKey || this.findNearestEdge(worldPt);
    if (nearestKey && !this.selectedStitches.has(nearestKey)) {
      if (!e.shiftKey) {
        this.selectedStitches.clear();
      }
      this.selectedStitches.add(nearestKey);
      this.notifySelection();
      this.camera.requestRender();
    }

    // 4. Request Canvas Context Menu
    if (typeof this.onContextMenuRequested === 'function') {
      this.onContextMenuRequested(e, worldPt);
    }
  }

  updateMarqueeSelection(keepExisting = false) {
    if (!this.marqueeStart || !this.marqueeCurrent) return;

    const minX = Math.min(this.marqueeStart.x, this.marqueeCurrent.x);
    const maxX = Math.max(this.marqueeStart.x, this.marqueeCurrent.x);
    const minY = Math.min(this.marqueeStart.y, this.marqueeCurrent.y);
    const maxY = Math.max(this.marqueeStart.y, this.marqueeCurrent.y);

    if (!keepExisting) {
      this.selectedStitches.clear();
    }

    for (const [k, edge] of this.stitches.entries()) {
      if (edge.locked) {
        continue; // Protected by stitch lock
      }
      // Locked layer items cannot be selected via Marquee (Illustrator standard)
      if (this.layerManager && this.layerManager.isLayerLocked(edge.layerId)) {
        continue;
      }

      const p1 = this.latticeGrid.nodeToWorld(edge.u[0], edge.u[1]);
      const p2 = this.latticeGrid.nodeToWorld(edge.v[0], edge.v[1]);
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      // Select if midpoint OR either endpoint intersects the marquee box
      const p1In = p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY;
      const p2In = p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY;
      const midIn = midX >= minX && midX <= maxX && midY >= minY && midY <= maxY;

      if (midIn || p1In || p2In) {
        this.selectedStitches.add(k);
      }
    }
  }

  moveSelectedWithOffset(dI, dJ) {
    if (this.selectedStitches.size === 0 || (dI === 0 && dJ === 0)) return;

    const newMap = new Map();
    const newKeys = new Set();

    for (const k of this.selectedStitches) {
      const edge = this.stitches.get(k);
      if (edge) {
        this.stitches.delete(k);
        const uNew = [edge.u[0] + dI, edge.u[1] + dJ];
        const vNew = [edge.v[0] + dI, edge.v[1] + dJ];
        const newKey = edgeKey(uNew[0], uNew[1], vNew[0], vNew[1]);
        newMap.set(newKey, {
          u: uNew,
          v: vNew,
          partitionId: edge.partitionId,
          layerId: edge.layerId,
          groupId: edge.groupId
        });
        newKeys.add(newKey);
      }
    }

    for (const [k, edge] of newMap.entries()) {
      this.stitches.set(k, edge);
    }
    this.selectedStitches = newKeys;
    this.notifyChange();
    this.notifySelection();
    this.camera.requestRender();
  }

  duplicateSelectedWithOffset(dI, dJ) {
    if (this.selectedStitches.size === 0) return;

    const newMap = new Map();
    const newKeys = new Set();

    for (const k of this.selectedStitches) {
      const edge = this.stitches.get(k);
      if (edge) {
        const uNew = [edge.u[0] + dI, edge.u[1] + dJ];
        const vNew = [edge.v[0] + dI, edge.v[1] + dJ];
        const newKey = edgeKey(uNew[0], uNew[1], vNew[0], vNew[1]);
        newMap.set(newKey, {
          u: uNew,
          v: vNew,
          partitionId: edge.partitionId,
          layerId: edge.layerId,
          groupId: edge.groupId
        });
        newKeys.add(newKey);
      }
    }

    for (const [k, edge] of newMap.entries()) {
      this.stitches.set(k, edge);
    }
    this.selectedStitches = newKeys;
    this.notifyChange();
    this.notifySelection();
    this.camera.requestRender();
  }

  clearSelection() {
    this.selectedStitches.clear();
    this.notifySelection();
    this.camera.requestRender();
  }

  deleteSelected() {
    if (this.selectedStitches.size === 0) return;
    for (const k of Array.from(this.selectedStitches)) {
      const edge = this.stitches.get(k);
      if (edge?.locked) {
        continue; // Protected by individual stitch lock
      }
      if (this.layerManager && this.layerManager.isLayerLocked(edge?.layerId)) {
        continue; // Protected
      }
      this.stitches.delete(k);
      this.selectedStitches.delete(k);
    }
    this.hoveredStitchKey = null;
    this.notifyChange();
    this.notifySelection();
    this.camera.requestRender();
  }

  duplicateSelected() {
    if (this.selectedStitches.size === 0) return;
    const newKeys = new Set();
    const activePart = this.subLabManager?.getActivePartition();

    for (const k of this.selectedStitches) {
      const edge = this.stitches.get(k);
      if (edge) {
        // Offset by 1 main subdivision
        const offsetI = this.latticeGrid.subDivH || 3;
        const offsetJ = this.latticeGrid.subDivV || 3;
        const uNew = [edge.u[0] + offsetI, edge.u[1] + offsetJ];
        const vNew = [edge.v[0] + offsetI, edge.v[1] + offsetJ];
        const newKey = edgeKey(uNew[0], uNew[1], vNew[0], vNew[1]);

        this.stitches.set(newKey, {
          u: uNew,
          v: vNew,
          partitionId: activePart ? activePart.id : edge.partitionId,
          layerId: edge.layerId,
          groupId: edge.groupId
        });
        newKeys.add(newKey);
      }
    }

    this.selectedStitches = newKeys;
    this.notifyChange();
    this.notifySelection();
    this.camera.requestRender();
  }

  /**
   * Assigns all selected stitches to a target layer (e.g. Layer 1, Layer 2, Background Template)
   */
  moveSelectedToLayer(targetLayerId) {
    if (this.selectedStitches.size === 0 || !targetLayerId) return;
    for (const k of this.selectedStitches) {
      const edge = this.stitches.get(k);
      if (edge) {
        edge.layerId = targetLayerId;
      }
    }
    this.notifyChange();
    this.camera.requestRender();
  }

  fillSelectionWithPattern() {
    if (!this.subLabManager || !this.subLabManager.patternRegistry) return;
    const patId = this.subLabManager.patternRegistry.selectedPatternId;
    if (!patId) return;

    const bounds = this.getSelectedBounds();
    if (!bounds || bounds.w === 0 || bounds.h === 0) return;

    // Extract all points from selected stitches to form true boundary polygon
    const allPoints = [];
    for (const k of this.selectedStitches) {
      const edge = this.stitches.get(k);
      if (!edge) continue;
      allPoints.push(this.latticeGrid.nodeToWorld(edge.u[0], edge.u[1]));
      allPoints.push(this.latticeGrid.nodeToWorld(edge.v[0], edge.v[1]));
    }

    let polyPoints = null;
    if (allPoints.length >= 3) {
      const hull = computeConvexHull(allPoints);
      if (hull && hull.length >= 3) {
        polyPoints = hull;
      }
    }

    if (!polyPoints) {
      polyPoints = [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.w, y: bounds.y },
        { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
        { x: bounds.x, y: bounds.y + bounds.h }
      ];
    }

    const tempPart = {
      id: `sel_fill_${Date.now()}`,
      name: 'Filled Shape',
      points: polyPoints
    };

    for (const k of this.selectedStitches) {
      this.stitches.delete(k);
    }
    this.selectedStitches.clear();

    const edges = this.subLabManager.patternRegistry.generateForPartition(tempPart, patId);
    const newKeys = new Set();
    for (const [k, edge] of edges.entries()) {
      this.stitches.set(k, edge);
      newKeys.add(k);
    }
    this.selectedStitches = newKeys;
    this.notifyChange();
    this.notifySelection();
    this.camera.requestRender();
  }

  convertSelectionToLab() {
    if (this.selectedStitches.size === 0) return;
    const allPoints = [];
    for (const k of this.selectedStitches) {
      const edge = this.stitches.get(k);
      if (!edge) continue;
      allPoints.push(this.latticeGrid.nodeToWorld(edge.u[0], edge.u[1]));
      allPoints.push(this.latticeGrid.nodeToWorld(edge.v[0], edge.v[1]));
    }
    if (allPoints.length < 3) return;

    const hullPoints = computeConvexHull(allPoints);
    if (!hullPoints || hullPoints.length < 3) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of hullPoints) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }

    if (typeof this.onCustomLabCreated === 'function') {
      this.onCustomLabCreated({
        minX, minY, w: maxX - minX, h: maxY - minY,
        points: hullPoints,
        shapeType: 'custom'
      });
    }
  }

  // --- Individual Line / Stitch Locking ---

  lockSelectedStitches() {
    if (this.selectedStitches.size === 0) return 0;
    let count = 0;
    for (const k of this.selectedStitches) {
      const edge = this.stitches.get(k);
      if (edge) {
        edge.locked = true;
        count++;
      }
    }
    this.selectedStitches.clear();
    this.notifyChange();
    this.notifySelection();
    this.camera.requestRender();
    return count;
  }

  unlockAllStitches() {
    let count = 0;
    for (const edge of this.stitches.values()) {
      if (edge.locked) {
        edge.locked = false;
        count++;
      }
    }
    if (count > 0) {
      this.notifyChange();
      this.camera.requestRender();
    }
    return count;
  }

  // --- Illustrator-Style Isolation / Focus Mode ---

  enterIsolationMode(type = 'selection', target = null) {
    if (type === 'selection') {
      if (this.selectedStitches.size === 0) return false;
      this.isolationMode.active = true;
      this.isolationMode.type = 'selection';
      this.isolationMode.targetId = null;
      this.isolationMode.stitchKeys = new Set(this.selectedStitches);
      this.isolationMode.label = `Focusing: ${this.selectedStitches.size} Selected Lines`;
    } else if (type === 'layer') {
      const layerId = target || this.layerManager?.activeLayerId || 'layer_main';
      const layerName = this.layerManager?.getLayer(layerId)?.name || layerId;
      this.isolationMode.active = true;
      this.isolationMode.type = 'layer';
      this.isolationMode.targetId = layerId;
      this.isolationMode.stitchKeys = new Set();
      for (const [k, edge] of this.stitches.entries()) {
        if ((edge.layerId || 'layer_main') === layerId) {
          this.isolationMode.stitchKeys.add(k);
        }
      }
      this.isolationMode.label = `Focusing Layer: ${layerName}`;
    }

    this.updateIsolationHudUI();
    this.camera.requestRender();
    return true;
  }

  exitIsolationMode() {
    if (!this.isolationMode.active) return;
    this.isolationMode.active = false;
    this.isolationMode.type = null;
    this.isolationMode.targetId = null;
    this.isolationMode.stitchKeys.clear();
    this.isolationMode.label = '';

    this.updateIsolationHudUI();
    this.camera.requestRender();
  }

  updateIsolationHudUI() {
    const hudEl = document.getElementById('isolation-breadcrumb-hud');
    const labelEl = document.getElementById('isolation-breadcrumb-label');
    if (!hudEl) return;
    if (this.isolationMode.active) {
      hudEl.classList.remove('hidden');
      if (labelEl) labelEl.textContent = this.isolationMode.label || 'Focused Selection';
    } else {
      hudEl.classList.add('hidden');
    }
  }

  rotateSelected(deg = 90) {
    if (this.selectedStitches.size === 0) return;

    let sumI = 0, sumJ = 0, count = 0;
    for (const k of this.selectedStitches) {
      const edge = this.stitches.get(k);
      if (edge) {
        sumI += edge.u[0] + edge.v[0];
        sumJ += edge.u[1] + edge.v[1];
        count += 2;
      }
    }
    if (count === 0) return;
    const centerI = Math.round(sumI / count);
    const centerJ = Math.round(sumJ / count);

    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const newStitchesMap = new Map();
    const newKeys = new Set();

    for (const k of this.selectedStitches) {
      const edge = this.stitches.get(k);
      if (edge) {
        this.stitches.delete(k);

        const rotNode = (i, j) => {
          const di = i - centerI;
          const dj = j - centerJ;
          const ri = Math.round(di * cos - dj * sin);
          const rj = Math.round(di * sin + dj * cos);
          return [centerI + ri, centerJ + rj];
        };

        const uNew = rotNode(edge.u[0], edge.u[1]);
        const vNew = rotNode(edge.v[0], edge.v[1]);
        const newKey = edgeKey(uNew[0], uNew[1], vNew[0], vNew[1]);

        newStitchesMap.set(newKey, {
          u: uNew,
          v: vNew,
          partitionId: edge.partitionId,
          layerId: edge.layerId || 'layer_main',
          groupId: edge.groupId || null,
          lineStyle: edge.lineStyle || 'dashed',
          locked: edge.locked || false
        });
        newKeys.add(newKey);
      }
    }

    for (const [k, edge] of newStitchesMap.entries()) {
      this.stitches.set(k, edge);
    }

    this.selectedStitches = newKeys;
    this.notifyChange();
    this.notifySelection();
    this.camera.requestRender();
  }

  mirrorSelected() {
    if (this.selectedStitches.size === 0) return;

    let sumI = 0, count = 0;
    for (const k of this.selectedStitches) {
      const edge = this.stitches.get(k);
      if (edge) {
        sumI += edge.u[0] + edge.v[0];
        count += 2;
      }
    }
    if (count === 0) return;
    const centerI = Math.round(sumI / count);

    const newStitchesMap = new Map();
    const newKeys = new Set();

    for (const k of this.selectedStitches) {
      const edge = this.stitches.get(k);
      if (edge) {
        this.stitches.delete(k);

        const uNew = [2 * centerI - edge.u[0], edge.u[1]];
        const vNew = [2 * centerI - edge.v[0], edge.v[1]];
        const newKey = edgeKey(uNew[0], uNew[1], vNew[0], vNew[1]);

        newStitchesMap.set(newKey, {
          u: uNew,
          v: vNew,
          partitionId: edge.partitionId,
          layerId: edge.layerId || 'layer_main',
          groupId: edge.groupId || null,
          lineStyle: edge.lineStyle || 'dashed',
          locked: edge.locked || false
        });
        newKeys.add(newKey);
      }
    }

    for (const [k, edge] of newStitchesMap.entries()) {
      this.stitches.set(k, edge);
    }

    this.selectedStitches = newKeys;
    this.notifyChange();
    this.notifySelection();
    this.camera.requestRender();
  }

  commitEdge(nodeA, nodeB, triggerNotify = true) {
    const k = edgeKey(nodeA.i, nodeA.j, nodeB.i, nodeB.j);

    // Determine active vector layer for stitches (if active layer is an image, target vector layer)
    let activeLayerId = this.layerManager ? this.layerManager.activeLayerId : 'layer_main';
    const currentLayer = this.layerManager?.getLayer(activeLayerId);
    if (currentLayer && currentLayer.type === 'image') {
      const vectorLayer = this.layerManager.layers.find(l => l.type !== 'image' && !l.locked);
      activeLayerId = vectorLayer ? vectorLayer.id : 'layer_main';
    }

    // Active layer lock check
    if (this.layerManager && this.layerManager.isLayerLocked(activeLayerId)) {
      console.warn('Cannot draw: Active layer is locked.');
      return;
    }

    const activePart = this.subLabManager?.getActivePartition();

    const stepX = this.latticeGrid.getStepXPx();
    const stepY = this.latticeGrid.getStepYPx();
    const nAx = nodeA.x !== undefined ? nodeA.x : nodeA.i * stepX;
    const nAy = nodeA.y !== undefined ? nodeA.y : nodeA.j * stepY;
    const nBx = nodeB.x !== undefined ? nodeB.x : nodeB.i * stepX;
    const nBy = nodeB.y !== undefined ? nodeB.y : nodeB.j * stepY;

    // Bounded Lab constraint enforcement
    if (this.subLabManager?.isGreenSubLabActive && this.subLabManager?.constrainToLab && activePart && activePart.points) {
      const midX = (nAx + nBx) / 2;
      const midY = (nAy + nBy) / 2;
      const isInside = this.subLabManager.partitionEngine.isPointInside({ x: midX, y: midY }, activePart.points);
      if (!isInside) {
        console.warn('Cannot draw: Stitch outside bounded lab.');
        return;
      }
    }

    let assignedPartId = 'p_full';
    if (this.subLabManager?.isGreenSubLabActive && activePart) {
      const midX = (nAx + nBx) / 2;
      const midY = (nAy + nBy) / 2;
      if (this.subLabManager.partitionEngine.isPointInside({ x: midX, y: midY }, activePart.points)) {
        assignedPartId = activePart.id;
      }
    }

    this.stitches.set(k, {
      u: [nodeA.i, nodeA.j],
      v: [nodeB.i, nodeB.j],
      partitionId: assignedPartId,
      layerId: activeLayerId
    });

    // Live Quadrant & Reflection Symmetry (Art Lab / Cushion Tracing)
    if (this.symmetryMode && this.symmetryMode !== 'none') {
      const artW = this.camera.artboardWidthPx || this.camera.cushionPx;
      const artH = this.camera.artboardHeightPx || this.camera.cushionPx;
      const centerNode = this.latticeGrid.snapToNode({ x: artW / 2, y: artH / 2 });
      const cI = centerNode.i;
      const cJ = centerNode.j;

      const pairsToMirror = [];
      if (this.symmetryMode === '4way' || this.symmetryMode === 'quadrant') {
        // Mirror X
        pairsToMirror.push([
          { i: 2 * cI - nodeA.i, j: nodeA.j },
          { i: 2 * cI - nodeB.i, j: nodeB.j }
        ]);
        // Mirror Y
        pairsToMirror.push([
          { i: nodeA.i, j: 2 * cJ - nodeA.j },
          { i: nodeB.i, j: 2 * cJ - nodeB.j }
        ]);
        // Mirror Both XY
        pairsToMirror.push([
          { i: 2 * cI - nodeA.i, j: 2 * cJ - nodeA.j },
          { i: 2 * cI - nodeB.i, j: 2 * cJ - nodeB.j }
        ]);
      } else if (this.symmetryMode === 'horizontal') {
        pairsToMirror.push([
          { i: nodeA.i, j: 2 * cJ - nodeA.j },
          { i: nodeB.i, j: 2 * cJ - nodeB.j }
        ]);
      } else if (this.symmetryMode === 'vertical') {
        pairsToMirror.push([
          { i: 2 * cI - nodeA.i, j: nodeA.j },
          { i: 2 * cI - nodeB.i, j: nodeB.j }
        ]);
      }

      for (const [nA, nB] of pairsToMirror) {
        const symKey = edgeKey(nA.i, nA.j, nB.i, nB.j);
        this.stitches.set(symKey, {
          u: [nA.i, nA.j],
          v: [nB.i, nB.j],
          partitionId: assignedPartId,
          layerId: activeLayerId
        });
      }
    }

    if (triggerNotify) {
      this.notifyChange();
    }
    this.camera.requestRender();
    return k;
  }

  deleteStitch(k) {
    const edge = this.stitches.get(k);
    if (this.layerManager && this.layerManager.isLayerLocked(edge?.layerId)) {
      return; // Protected by locked layer
    }
    if (this.stitches.has(k)) {
      this.stitches.delete(k);
      this.selectedStitches.delete(k);
      if (this.hoveredStitchKey === k) {
        this.hoveredStitchKey = null;
      }
      this.notifyChange();
      this.notifySelection();
      this.camera.requestRender();
    }
  }

  findNearestEdge(worldPt) {
    if (this.spatialGridDirty) {
      this.rebuildSpatialGrid();
    }
    const thresholdPx = Math.max(14, 18 / (this.camera.zoom || 1));
    const cellSize = this.spatialCellSize;
    const minCX = Math.floor((worldPt.x - thresholdPx) / cellSize);
    const maxCX = Math.floor((worldPt.x + thresholdPx) / cellSize);
    const minCY = Math.floor((worldPt.y - thresholdPx) / cellSize);
    const maxCY = Math.floor((worldPt.y + thresholdPx) / cellSize);

    let nearestKey = null;
    let minDist = Infinity;
    const checked = new Set();

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const bucket = this.spatialGrid.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (const k of bucket) {
          if (checked.has(k)) continue;
          checked.add(k);

          const edge = this.stitches.get(k);
          if (!edge) continue;
          // Locked layer items cannot be targeted or selected
          if (this.layerManager && this.layerManager.isLayerLocked(edge.layerId)) {
            continue;
          }
          const p1 = this.latticeGrid.nodeToWorld(edge.u[0], edge.u[1]);
          const p2 = this.latticeGrid.nodeToWorld(edge.v[0], edge.v[1]);
          const dist = this.distToSegment(worldPt, p1, p2);
          if (dist <= thresholdPx && dist < minDist) {
            minDist = dist;
            nearestKey = k;
          }
        }
      }
    }
    return nearestKey;
  }

  eraseAtPoint(worldPt) {
    const k = this.findNearestEdge(worldPt);
    if (k) {
      this.deleteStitch(k);
    }
  }

  distToSegment(p, v, w) {
    const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
  }

  selectAllInShapeOrCanvas() {
    const activePart = this.subLabManager?.getActivePartition();
    const activePartId = activePart?.id || this.subLabManager?.activePartitionId;
    let selectedFromPart = false;

    const isEdgeLocked = (edge) => {
      if (!edge) return false;
      if (edge.locked) return true;
      if (this.layerManager && this.layerManager.isLayerLocked(edge.layerId)) return true;
      return false;
    };

    const stepX = this.latticeGrid.getStepXPx();
    const stepY = this.latticeGrid.getStepYPx();

    // 1. If an active partition is set, select all stitches belonging to it (by partitionId or geometric containment)
    if (activePart) {
      const partStitches = new Set();
      for (const [k, edge] of this.stitches.entries()) {
        if (isEdgeLocked(edge)) continue;

        let matches = edge.partitionId === activePartId;
        if (!matches && activePart.points && activePart.points.length >= 3 && this.subLabManager?.partitionEngine) {
          const midX = ((edge.u[0] + edge.v[0]) / 2) * stepX;
          const midY = ((edge.u[1] + edge.v[1]) / 2) * stepY;
          matches = this.subLabManager.partitionEngine.isPointInside({ x: midX, y: midY }, activePart.points);
        }

        if (matches) {
          partStitches.add(k);
        }
      }
      if (partStitches.size > 0) {
        this.selectedStitches = partStitches;
        selectedFromPart = true;
      }
    }

    // 2. If no active partition or partition has no stitches, check if currently selected stitches belong to a partition
    if (!selectedFromPart && this.selectedStitches.size > 0) {
      const firstKey = this.selectedStitches.values().next().value;
      const firstEdge = this.stitches.get(firstKey);
      const partId = firstEdge?.partitionId;
      if (partId && partId !== 'p_full') {
        const partStitches = new Set();
        for (const [k, edge] of this.stitches.entries()) {
          if (isEdgeLocked(edge)) continue;
          if (edge.partitionId === partId) {
            partStitches.add(k);
          }
        }
        if (partStitches.size > 0) {
          this.selectedStitches = partStitches;
          selectedFromPart = true;
        }
      }
    }

    // 3. Fallback: select all UNLOCKED stitches across the entire canvas
    if (!selectedFromPart) {
      const allUnlocked = new Set();
      for (const [k, edge] of this.stitches.entries()) {
        if (!isEdgeLocked(edge)) {
          allUnlocked.add(k);
        }
      }
      this.selectedStitches = allUnlocked;
    }

    this.setTool('select');
    this.notifySelection();
    this.camera.requestRender();
  }

  notifyChange() {
    this.spatialGridDirty = true;
    this.pathCacheDirty = true;
    if (typeof this.onStitchesChanged === 'function') {
      this.onStitchesChanged(this.stitches);
    }
  }

  notifySelection() {
    this.pathCacheDirty = true;
    if (typeof this.onSelectionChanged === 'function') {
      this.onSelectionChanged(this.selectedStitches.size, Array.from(this.selectedStitches));
    }
  }

  render(ctx, state, optics) {
    const zoom = state.zoom || 1;
    ctx.save();
    optics.applyStitchStroke(ctx);

    const isSolid = this.penLineStyle === 'solid';
    const isIsoActive = this.subLabManager?.isGreenSubLabActive;
    const activePartId = this.subLabManager?.activePartitionId;

    // High-Performance Path2D Batch Cache (Rebuilt only when stitches/selection change)
    if (this.pathCacheDirty) {
      this.cachedNormalPath = new Path2D();
      this.cachedDimmedPath = new Path2D();
      this.cachedSelectedPath = new Path2D();
      this.hasCachedNormal = false;
      this.hasCachedDimmed = false;
      this.hasCachedSelected = false;
      this.cachedSelectedPoints = [];

      const stepX = this.latticeGrid.getStepXPx();
      const stepY = this.latticeGrid.getStepYPx();

      for (const [k, edge] of this.stitches.entries()) {
        if (this.layerManager && !this.layerManager.isLayerVisible(edge.layerId || 'layer_main')) {
          continue;
        }
        const x1 = edge.u[0] * stepX;
        const y1 = edge.u[1] * stepY;
        const x2 = edge.v[0] * stepX;
        const y2 = edge.v[1] * stepY;

        const isIsolated = !this.isolationMode.active || this.isolationMode.stitchKeys.has(k);

        if (this.selectedStitches.has(k)) {
          this.cachedSelectedPath.moveTo(x1, y1);
          this.cachedSelectedPath.lineTo(x2, y2);
          this.cachedSelectedPoints.push(x1, y1, x2, y2);
          this.hasCachedSelected = true;
        } else if (!isIsolated || (isIsoActive && activePartId && edge.partitionId && edge.partitionId !== activePartId)) {
          this.cachedDimmedPath.moveTo(x1, y1);
          this.cachedDimmedPath.lineTo(x2, y2);
          this.hasCachedDimmed = true;
        } else {
          this.cachedNormalPath.moveTo(x1, y1);
          this.cachedNormalPath.lineTo(x2, y2);
          this.hasCachedNormal = true;
        }
      }
      this.pathCacheDirty = false;
    }

    // 1. Draw Normal Stitches in a SINGLE GPU Draw Call
    if (this.hasCachedNormal) {
      ctx.setLineDash(isSolid ? [] : [12, 6]);
      ctx.stroke(this.cachedNormalPath);
    }

    // 2. Draw Dimmed Stitches in a SINGLE GPU Draw Call
    if (this.hasCachedDimmed) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.setLineDash(isSolid ? [] : [12, 6]);
      ctx.stroke(this.cachedDimmedPath);
      ctx.restore();
    }

    // 3. Draw Selected Stitches in a SINGLE GPU Draw Call
    if (this.hasCachedSelected) {
      ctx.save();
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = Math.max(3.2, 4.0 / zoom);
      ctx.setLineDash(isSolid ? [] : [12, 6]);
      ctx.stroke(this.cachedSelectedPath);

      // Only draw individual vertex squares for small selections (<= 20 stitches) or direct-select mode!
      // This eliminates thousands of fillRect/strokeRect calls that previously caused heavy lag on large patterns!
      if (this.selectedStitches.size <= 20 || this.activeTool === 'direct-select') {
        const boxSz = Math.max(3.0, 3.8 / zoom);
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#0284C7';
        ctx.lineWidth = Math.max(1.2, 1.5 / zoom);
        ctx.setLineDash([]);
        const pts = this.cachedSelectedPoints;
        for (let i = 0; i < pts.length; i += 4) {
          ctx.fillRect(pts[i] - boxSz, pts[i + 1] - boxSz, boxSz * 2, boxSz * 2);
          ctx.strokeRect(pts[i] - boxSz, pts[i + 1] - boxSz, boxSz * 2, boxSz * 2);
          ctx.fillRect(pts[i + 2] - boxSz, pts[i + 3] - boxSz, boxSz * 2, boxSz * 2);
          ctx.strokeRect(pts[i + 2] - boxSz, pts[i + 3] - boxSz, boxSz * 2, boxSz * 2);
        }
      }
      ctx.restore();
    }

    // 2. Direct-Selection (A): Render Editable Anchor Point Handles & Drag Preview
    if (this.activeTool === 'direct-select') {
      ctx.save();
      const nodeR = Math.max(3.5, 4.2 / zoom);
      const anchorPath = new Path2D();
      // Draw hollow vertex dots on all visible stitches in a single batched path
      for (const [k, edge] of this.stitches.entries()) {
        if (this.layerManager && !this.layerManager.isLayerVisible(edge.layerId || 'layer_main')) continue;
        const x1 = edge.u[0] * stepX;
        const y1 = edge.u[1] * stepY;
        const x2 = edge.v[0] * stepX;
        const y2 = edge.v[1] * stepY;

        anchorPath.moveTo(x1 + nodeR, y1);
        anchorPath.arc(x1, y1, nodeR, 0, Math.PI * 2);
        anchorPath.moveTo(x2 + nodeR, y2);
        anchorPath.arc(x2, y2, nodeR, 0, Math.PI * 2);
      }

      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#0284C7';
      ctx.lineWidth = Math.max(1.2, 1.4 / zoom);
      ctx.fill(anchorPath);
      ctx.stroke(anchorPath);

      // Highlight hovered anchor
      if (this.hoveredAnchor && !this.isDraggingAnchor) {
        ctx.fillStyle = '#38BDF8';
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(1.5, 2.0 / zoom);
        ctx.beginPath();
        ctx.arc(this.hoveredAnchor.x, this.hoveredAnchor.y, Math.max(5.5, 6.5 / zoom), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Live rubberband dynamic re-anchoring preview while dragging
      if (this.isDraggingAnchor && this.dragCurrentAnchor) {
        ctx.strokeStyle = '#00FF7F'; // Bright spring green
        ctx.lineWidth = Math.max(2.5, 3.2 / zoom);
        ctx.setLineDash([5 / zoom, 3 / zoom]);

        for (const item of this.connectedAnchorEdges) {
          const otherNode = item.isU ? item.edge.v : item.edge.u;
          const pFixed = this.latticeGrid.nodeToWorld(otherNode[0], otherNode[1]);
          ctx.beginPath();
          ctx.moveTo(pFixed.x, pFixed.y);
          ctx.lineTo(this.dragCurrentAnchor.x, this.dragCurrentAnchor.y);
          ctx.stroke();
        }

        // Target snapped anchor point
        ctx.setLineDash([]);
        ctx.fillStyle = '#00FF7F';
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(1.5, 2.0 / zoom);
        ctx.beginPath();
        ctx.arc(this.dragCurrentAnchor.x, this.dragCurrentAnchor.y, Math.max(5.5, 6.5 / zoom), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Selection Tool (V): Render Bounding Box, 8 Resize Handles & Floating Contextual HUD
    if (this.activeTool === 'select' && this.selectedStitches.size > 0) {
      const bounds = this.getSelectedBounds();
      if (bounds && (bounds.w > 0 || bounds.h > 0)) {
        ctx.save();
        // Bounding box frame
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = Math.max(1.0, 1.2 / zoom);
        ctx.setLineDash([4 / zoom, 4 / zoom]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);

        // 8 Resize Handles
        const handles = this.getResizeHandles(bounds);
        const hSize = Math.max(6, 7 / zoom);
        for (const [name, h] of Object.entries(handles)) {
          const isHovered = (this.hoveredResizeHandle === name || this.activeResizeHandle === name);
          ctx.fillStyle = isHovered ? '#38BDF8' : '#FFFFFF';
          ctx.strokeStyle = '#0284C7';
          ctx.lineWidth = Math.max(1.2, 1.5 / zoom);
          ctx.setLineDash([]);
          ctx.fillRect(h.x - hSize / 2, h.y - hSize / 2, hSize, hSize);
          ctx.strokeRect(h.x - hSize / 2, h.y - hSize / 2, hSize, hSize);
        }

        // Render Floating Contextual Action Bar HUD
        const hud = this.computeHudBounds(bounds);
        this.selectionHudBounds = hud;
        if (hud) {
          const radius = 6 / zoom;
          // Backdrop pill
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
          ctx.shadowBlur = 10;
          ctx.fillStyle = '#18181B'; // Dark zinc Figma surface
          ctx.strokeStyle = '#3F3F46'; // Zinc border
          ctx.lineWidth = Math.max(1.0, 1.2 / zoom);
          ctx.setLineDash([]);

          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(hud.x, hud.y, hud.w, hud.h, radius);
          } else {
            ctx.rect(hud.x, hud.y, hud.w, hud.h);
          }
          ctx.fill();
          ctx.stroke();

          // Render buttons
          const buttons = this.getHudButtons();
          ctx.font = `600 ${Math.max(9, 10 / zoom)}px "Plus Jakarta Sans", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          for (let i = 0; i < buttons.length; i++) {
            const bx = hud.x + i * hud.btnW;
            const isHover = (this.hoveredHudButton === i);

            if (isHover) {
              ctx.fillStyle = '#27272A';
              ctx.beginPath();
              if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(bx + 2 / zoom, hud.y + 2 / zoom, hud.btnW - 4 / zoom, hud.h - 4 / zoom, 4 / zoom);
              } else {
                ctx.rect(bx, hud.y, hud.btnW, hud.h);
              }
              ctx.fill();
            }

            // Divider line between buttons
            if (i > 0) {
              ctx.strokeStyle = '#27272A';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(bx, hud.y + 4 / zoom);
              ctx.lineTo(bx, hud.y + hud.h - 4 / zoom);
              ctx.stroke();
            }

            ctx.fillStyle = isHover ? '#38BDF8' : '#D4D4D8';
            ctx.fillText(buttons[i].label, bx + hud.btnW / 2, hud.y + hud.h / 2);
          }
          ctx.restore();
        }

        ctx.restore();
      } else {
        this.selectionHudBounds = null;
      }
    } else {
      this.selectionHudBounds = null;
    }

    // 4. Render Resizing Ghost Preview with Live Scaled Stitches
    if (this.activeTool === 'select' && this.isResizingSelection && this.resizeCurrentBounds && this.resizeOrigBounds) {
      ctx.save();
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = Math.max(2.2, 2.8 / zoom);
      ctx.setLineDash([5 / zoom, 3 / zoom]);

      const { newMinI, newMaxI, newMinJ, newMaxJ } = this.resizeCurrentBounds;
      const { minI: oMinI, maxI: oMaxI, minJ: oMinJ, maxJ: oMaxJ } = this.resizeOrigBounds;
      const spanI = oMaxI - oMinI || 1;
      const spanJ = oMaxJ - oMinJ || 1;
      const newSpanI = newMaxI - newMinI;
      const newSpanJ = newMaxJ - newMinJ;

      for (const item of this.resizeOrigStitches) {
        const tU_I = (item.u[0] - oMinI) / spanI;
        const tU_J = (item.u[1] - oMinJ) / spanJ;
        const tV_I = (item.v[0] - oMinI) / spanI;
        const tV_J = (item.v[1] - oMinJ) / spanJ;

        const roundCoord = (val) => Number(val.toFixed(3));
        const p1 = this.latticeGrid.nodeToWorld(
          roundCoord(newMinI + tU_I * newSpanI),
          roundCoord(newMinJ + tU_J * newSpanJ)
        );
        const p2 = this.latticeGrid.nodeToWorld(
          roundCoord(newMinI + tV_I * newSpanI),
          roundCoord(newMinJ + tV_J * newSpanJ)
        );
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      // Outer ghost frame
      const tl = this.latticeGrid.nodeToWorld(newMinI, newMinJ);
      const br = this.latticeGrid.nodeToWorld(newMaxI, newMaxJ);
      ctx.strokeStyle = '#0284C7';
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.restore();
    }

    // 5. Render Drag-to-Move Ghost Preview
    if (this.isDraggingSelection && this.dragStartNode && this.dragCurrentNode) {
      const dI = this.dragCurrentNode.i - this.dragStartNode.i;
      const dJ = this.dragCurrentNode.j - this.dragStartNode.j;
      if (dI !== 0 || dJ !== 0) {
        ctx.save();
        ctx.strokeStyle = '#60A5FA';
        ctx.lineWidth = Math.max(2.5, 3.2 / zoom);
        ctx.setLineDash([5 / zoom, 3 / zoom]);
        for (const k of this.selectedStitches) {
          const edge = this.stitches.get(k);
          if (edge) {
            const p1 = this.latticeGrid.nodeToWorld(edge.u[0] + dI, edge.u[1] + dJ);
            const p2 = this.latticeGrid.nodeToWorld(edge.v[0] + dI, edge.v[1] + dJ);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // 6. Render Hover Delete Indicator (Illustrator Style Minus Badge - ss 3)
    if (this.hoveredStitchKey) {
      const edge = this.stitches.get(this.hoveredStitchKey);
      if (edge) {
        const p1 = this.latticeGrid.nodeToWorld(edge.u[0], edge.u[1]);
        const p2 = this.latticeGrid.nodeToWorld(edge.v[0], edge.v[1]);
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const r = Math.max(6, 8 / zoom);

        ctx.save();
        ctx.strokeStyle = '#EF4444';
        ctx.lineWidth = Math.max(2.8, 3.8 / zoom);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.arc(midX, midY, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(midX - (3.5 / zoom), midY - (0.8 / zoom), 7 / zoom, 1.6 / zoom);

        ctx.font = `600 ${Math.max(9, 10 / zoom)}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#FCA5A5';
        ctx.fillText('Shift+Click / Double-Click', midX + r + (4 / zoom), midY + (3 / zoom));
        ctx.restore();
      }
    }

    // 7. Render Marquee Drag Box (Tool 'select' - V)
    if (this.isSelecting && this.marqueeStart && this.marqueeCurrent) {
      ctx.save();
      const minX = Math.min(this.marqueeStart.x, this.marqueeCurrent.x);
      const maxX = Math.max(this.marqueeStart.x, this.marqueeCurrent.x);
      const minY = Math.min(this.marqueeStart.y, this.marqueeCurrent.y);
      const maxY = Math.max(this.marqueeStart.y, this.marqueeCurrent.y);

      // Translucent blue fill
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

      // Dashed blue stroke
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = Math.max(1.0, 1.2 / zoom);
      ctx.setLineDash([5 / zoom, 3 / zoom]);
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      ctx.restore();
    }

    // 8. Render Active Chain Start Anchor (Figma Electric Blue precision anchor)
    if (this.chainAnchor) {
      ctx.save();
      ctx.fillStyle = '#0D99FF';
      ctx.beginPath();
      ctx.arc(this.chainAnchor.x, this.chainAnchor.y, Math.max(3.2, 4.0 / zoom), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(this.chainAnchor.x, this.chainAnchor.y, Math.max(1.2, 1.5 / zoom), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 9. Render Custom Sub-Lab Multi-Shape Drag Preview (Tool 'shape-rect' - M)
    if (this.isDrawingLab && this.labStart && this.labCurrent) {
      ctx.save();
      const minX = Math.min(this.labStart.x, this.labCurrent.x);
      const maxX = Math.max(this.labStart.x, this.labCurrent.x);
      const minY = Math.min(this.labStart.y, this.labCurrent.y);
      const maxY = Math.max(this.labStart.y, this.labCurrent.y);
      const w = maxX - minX;
      const h = maxY - minY;

      const pts = this.computeShapePoints(this.activeShapeType, minX, minY, maxX, maxY);
      if (pts.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();

        // Translucent Emerald Green Fill
        ctx.fillStyle = 'rgba(0, 255, 127, 0.15)';
        ctx.fill();

        // High-contrast emerald dashed border
        ctx.strokeStyle = '#00FF7F';
        ctx.lineWidth = Math.max(1.8, 2.2 / zoom);
        ctx.setLineDash([8 / zoom, 4 / zoom]);
        ctx.stroke();

        const shapeLabels = { rect: 'Box', triangle: 'Triangle', circle: 'Circle', hexagon: 'Hexagon' };
        const label = shapeLabels[this.activeShapeType] || 'Shape';
        const wIn = (w / this.camera.ppi).toFixed(1);
        const hIn = (h / this.camera.ppi).toFixed(1);
        const tagFont = Math.max(10, 12 / zoom);
        ctx.setLineDash([]);
        ctx.font = `700 ${tagFont}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#00FF7F';
        ctx.fillText(`📐 Custom ${label} Lab: ${wIn}" × ${hIn}"`, minX + 6 / zoom, minY - 6 / zoom);
      }
      ctx.restore();
    }

    // 10. Figma Smart Alignment Guides & Crosshairs (SS 1)
    if (this.smartGuides) {
      this.smartGuides.render(ctx, state);
    }

    ctx.restore();
  }
}
