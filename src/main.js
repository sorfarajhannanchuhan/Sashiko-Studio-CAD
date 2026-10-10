/**
 * Sashiko Studio CAD - Main Bootstrap Application
 * Adobe Illustrator Industrial Workspace with Bounded A2 Artboard,
 * Hierarchical Looping 3x3 Grid Engine, Magnetic Chained Pen & Direct Selection.
 */

import { Camera } from './core/Camera.js';
import { LatticeGrid } from './core/LatticeGrid.js';
import { PartitionEngine } from './core/PartitionEngine.js';
import { OpticsEngine } from './core/OpticsEngine.js';
import { HistoryManager } from './core/HistoryManager.js';
import { PatternRegistry } from './patterns/PatternRegistry.js';
import { SubLabManager } from './features/SubLabManager.js';
import { StitchPen } from './features/StitchPen.js';
import { CustomSlicer } from './features/CustomSlicer.js';
import { MultiProjectTabs } from './features/MultiProjectTabs.js';
import { BlueprintSpecs } from './features/BlueprintSpecs.js';
import { Exporters } from './features/Exporters.js';
import { MinimapNavigator } from './features/MinimapNavigator.js';
import { LayerManager } from './features/LayerManager.js';
import { SmartGuides } from './core/SmartGuides.js';
import { BooleanEngine } from './features/BooleanEngine.js';
import { ArtLabManager } from './features/ArtLabManager.js';
import { VirtualRuler } from './features/VirtualRuler.js';
import { ProjectFileManager } from './features/ProjectFileManager.js';
import { CurveEngine } from './features/CurveEngine.js';

window.addEventListener('DOMContentLoaded', () => {
  // 1. Core Canvas & Stage
  const canvasEl = document.getElementById('main-cad-canvas');
  const stageEl = document.getElementById('canvas-stage');

  if (!canvasEl || !stageEl) {
    console.error('Fatal: Canvas or Stage element not found in DOM.');
    return;
  }

  // 2. Initialize Engines
  const camera = new Camera(canvasEl, stageEl);
  const latticeGrid = new LatticeGrid(camera);
  const partitionEngine = new PartitionEngine(camera);
  const opticsEngine = new OpticsEngine();
  camera.workbenchBg = opticsEngine.workbenchBg;
  camera.artboardBg = opticsEngine.bgColor;
  const historyManager = new HistoryManager();
  let projectFileManager = null;
  let artLabManager = null;

  // 3. Initialize Layers & Hierarchy (Illustrator Standard)
  const layerManager = new LayerManager({
    onLayersChanged: () => {
      layerManager.renderLayerListUI(document.getElementById('layers-container-box'), stitchPen.stitches);
      camera.requestRender();
    },
    onActiveLayerChanged: () => {
      layerManager.renderLayerListUI(document.getElementById('layers-container-box'), stitchPen.stitches);
      camera.requestRender();
    }
  });
  layerManager.camera = camera;
  layerManager.canvas = canvasEl;

  // 4. Initialize Patterns & 3x3 Sub-Labs
  const patternRegistry = new PatternRegistry(partitionEngine, latticeGrid);
  const subLabManager = new SubLabManager(partitionEngine, camera, patternRegistry);

  // 5. Initialize Tools
  const stitchPen = new StitchPen(canvasEl, camera, latticeGrid, subLabManager, historyManager);
  stitchPen.layerManager = layerManager;
  layerManager.stitchPen = stitchPen;
  latticeGrid.layerManager = layerManager;
  stitchPen.setTool('select');

  const smartGuides = new SmartGuides(camera, latticeGrid, stitchPen);
  stitchPen.smartGuides = smartGuides;

  const booleanEngine = new BooleanEngine(stitchPen, partitionEngine, latticeGrid, camera, historyManager);
  stitchPen.booleanEngine = booleanEngine;

  const customSlicer = new CustomSlicer(canvasEl, camera, partitionEngine, subLabManager, historyManager, stitchPen, latticeGrid);

  const curveEngine = new CurveEngine(canvasEl, camera, latticeGrid, stitchPen, historyManager);
  stitchPen.curveEngine = curveEngine;

  // 6. Initialize Specs, Tabs & Exporters
  const blueprintSpecs = new BlueprintSpecs(camera, latticeGrid, stitchPen, subLabManager);

  window.cad = { camera, latticeGrid, partitionEngine, opticsEngine, historyManager, layerManager, subLabManager, stitchPen, customSlicer, smartGuides, booleanEngine, patternRegistry, curveEngine };

  function updateArtboardHUD() {
    const dimEl = document.getElementById('hud-dimension');
    if (dimEl) {
      if (camera.workAreaEnabled) {
        dimEl.textContent = `${Math.round(camera.activeWidthMm)} × ${Math.round(camera.activeHeightMm)} mm (${camera.artboardPreset.toUpperCase()})`;
      } else {
        dimEl.textContent = 'Free Canvas (Infinite)';
      }
    }
    const cutEl = document.getElementById('spec-cut-size');
    if (cutEl) {
      cutEl.textContent = camera.workAreaEnabled ? camera.artboardPreset.toUpperCase() : 'FREE CANVAS';
    }
  }

  let multiProjectTabs = null;
  multiProjectTabs = new MultiProjectTabs({
    layerManager,
    camera,
    partitionEngine,
    subLabManager,
    stitchPen,
    onTabSwitched: (tab) => {
      if (stitchPen) {
        stitchPen.resetTransientState();
      }
      if (customSlicer) {
        customSlicer.cancelSlice();
      }
      if (tab.artboardPreset) {
        camera.setArtboard(tab.artboardPreset, tab.orientation || 'portrait');
      } else if (tab.cushionInches) {
        camera.setCushionSize(tab.cushionInches);
      }
      if (tab.partitions) {
        partitionEngine.partitions = JSON.parse(JSON.stringify(tab.partitions));
      } else {
        subLabManager.initNineSquareBlocks();
      }
      subLabManager.activePartitionId = tab.activePartitionId || 'B2';
      subLabManager.renderPartitionListUI();

      stitchPen.stitches = new Map(tab.stitches || []);
      stitchPen.spatialGridDirty = true;
      stitchPen.clearSelection();
      if (tab.layers) {
        layerManager.deserialize(tab.layers);
      }
      if (blueprintSpecs) {
        blueprintSpecs.updateMetrics();
      }
      if (artLabManager && artLabManager.isLightboxActive) {
        artLabManager.renderLightboxView();
      }
      updateArtboardHUD();
      camera.requestRender();
    },
    onStateChanged: (tab, mgr) => {
      const tabs = mgr || multiProjectTabs;
      if (tabs && historyManager) {
        historyManager.pushState(tabs.serializeAll());
      }
    }
  });

  multiProjectTabs.camera = camera;
  multiProjectTabs.partitionEngine = partitionEngine;
  multiProjectTabs.subLabManager = subLabManager;
  multiProjectTabs.stitchPen = stitchPen;

  layerManager.multiProjectTabs = multiProjectTabs;
  layerManager.historyManager = historyManager;

  const exporters = new Exporters(camera, latticeGrid, partitionEngine, stitchPen, opticsEngine, multiProjectTabs);
  const minimapCard = document.getElementById('canvas-minimap-card');
  const minimapNav = new MinimapNavigator(minimapCard, camera, partitionEngine, stitchPen);

  // 6. Hook Stitch & Partition Changes to History & Metrics
  stitchPen.onStitchesChanged = (stitches) => {
    const activeTab = multiProjectTabs.getActiveTab();
    if (activeTab) {
      activeTab.stitches = new Map(stitches);
      activeTab.layers = layerManager.serialize();
    }
    layerManager.renderLayerListUI(document.getElementById('layers-container-box'), stitches);
    blueprintSpecs.updateMetrics();
    historyManager.pushState(multiProjectTabs.serializeAll());
  };

  // Wire Layer Action Buttons
  document.getElementById('btn-add-layer')?.addEventListener('click', () => {
    layerManager.addLayer();
    layerManager.renderLayerListUI(document.getElementById('layers-container-box'), stitchPen.stitches);
  });
  document.getElementById('btn-dup-layer')?.addEventListener('click', () => {
    layerManager.duplicateLayer(layerManager.activeLayerId, stitchPen.stitches);
    layerManager.renderLayerListUI(document.getElementById('layers-container-box'), stitchPen.stitches);
    stitchPen.notifyChange();
  });
  document.getElementById('btn-del-layer')?.addEventListener('click', () => {
    layerManager.deleteLayer(layerManager.activeLayerId, stitchPen.stitches);
    layerManager.renderLayerListUI(document.getElementById('layers-container-box'), stitchPen.stitches);
    stitchPen.notifyChange();
  });

  // Reference Image Layer Importing & Drag-and-Drop Tracing (Illustrator Template Standard)
  function loadReferenceImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target.result;
      const img = new Image();
      img.onload = () => {
        layerManager.addImageLayer(file.name || 'Reference Image', img, src, camera);
        layerManager.renderLayerListUI(document.getElementById('layers-container-box'), stitchPen.stitches);
        // Switch to layers tab to show the new layer with opacity slider
        document.querySelector('.insp-tab[data-tab="layers"]')?.click();
        camera.requestRender();
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  const inputFileImg = document.getElementById('input-file-image');
  document.getElementById('btn-insert-image')?.addEventListener('click', () => {
    inputFileImg?.click();
  });
  document.getElementById('tool-insert-image')?.addEventListener('click', () => {
    inputFileImg?.click();
  });
  inputFileImg?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      loadReferenceImageFile(file);
      e.target.value = '';
    }
  });

  // Central Pattern Applicator: fills partition, dropped shape, or artboard, and auto-selects with 8-handle transform box
  function applyPatternToPartitionOrCanvas(patternId, dropWorldPt = null) {
    if (!patternId) return;

    // 1. Determine target partition / shape
    let targetPart = null;

    // Case A: If dropWorldPt provided (from drag & drop):
    if (dropWorldPt) {
      for (const p of partitionEngine.partitions) {
        if (p.points && partitionEngine.isPointInside(dropWorldPt, p.points)) {
          targetPart = p;
          break;
        }
      }
      // If dropped on empty canvas, create a compact placed block using repeatX/repeatY dimensions
      if (!targetPart) {
        const step = latticeGrid.getStepPx() || 10;
        const repX = patternRegistry.repeatX || 2;
        const repY = patternRegistry.repeatY || 2;
        // Asanoha unit cell: width = 6 * step, height = 6 * sqrt(3) * step per tile
        const spanW = repX * 6 * step;
        const spanH = repY * (6 * Math.sqrt(3)) * step;
        const halfW = spanW / 2;
        const halfH = spanH / 2;

        // Cleanup: remove stale motif_drop partitions with 0 stitches to prevent unbounded growth
        const dropParts = partitionEngine.partitions.filter(p => p.id.startsWith('motif_drop_'));
        for (const dp of dropParts) {
          const hasStitches = [...stitchPen.stitches.values()].some(e => e.partitionId === dp.id);
          if (!hasStitches) {
            const idx = partitionEngine.partitions.indexOf(dp);
            if (idx >= 0) partitionEngine.partitions.splice(idx, 1);
          }
        }

        const newPartId = `motif_drop_${Date.now()}`;
        targetPart = {
          id: newPartId,
          name: `Dropped Motif`,
          label: 'MOTIF',
          type: 'square',
          points: [
            { x: dropWorldPt.x - halfW, y: dropWorldPt.y - halfH },
            { x: dropWorldPt.x + halfW, y: dropWorldPt.y - halfH },
            { x: dropWorldPt.x + halfW, y: dropWorldPt.y + halfH },
            { x: dropWorldPt.x - halfW, y: dropWorldPt.y + halfH }
          ]
        };
        partitionEngine.partitions.push(targetPart);
        subLabManager.activePartitionId = newPartId;
        subLabManager.renderPartitionListUI();
      }
    }

    // Case B: If no dropWorldPt, look for active partition
    if (!targetPart) {
      targetPart = subLabManager.getActivePartition();
    }

    // Case C: If still null, check if any partitions exist in partitionEngine
    if (!targetPart && partitionEngine.partitions.length > 0) {
      targetPart = partitionEngine.partitions[0];
      subLabManager.activePartitionId = targetPart.id;
    }

    // Case D: If still null (e.g. Free Canvas mode or partitions cleared), create master canvas partition!
    if (!targetPart) {
      const w = (camera && camera.artboardWidthPx) || (camera && camera.cushionPx) || 1587.4;
      const h = (camera && camera.artboardHeightPx) || (camera && camera.cushionPx) || 2245.0;
      targetPart = {
        id: 'Canvas-Master',
        name: 'Full Artboard',
        label: 'CANVAS',
        type: 'square',
        points: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h }
        ]
      };
      partitionEngine.partitions.push(targetPart);
      subLabManager.activePartitionId = targetPart.id;
      subLabManager.renderPartitionListUI();
    }

    // 2. Generate edges for target partition
    const edges = patternRegistry.generateForPartition(targetPart, patternId);
    if (!edges || edges.size === 0) {
      console.warn('Pattern generation produced 0 stitches for partition:', targetPart.id);
      return;
    }

    // 3. Clear any existing stitches belonging to this partition
    for (const [k, edge] of Array.from(stitchPen.stitches.entries())) {
      if (edge.partitionId === targetPart.id) {
        stitchPen.stitches.delete(k);
      }
    }

    // 4. Insert newly generated stitches
    const newKeys = new Set();
    for (const [k, edge] of edges.entries()) {
      stitchPen.stitches.set(k, edge);
      newKeys.add(k);
    }

    // 5. Automatically select the newly placed stitches so the 8-handle transform bounding box appears!
    stitchPen.selectedStitches = newKeys;
    stitchPen.setTool('select');
    stitchPen.notifySelection();
    stitchPen.notifyChange();
    camera.requestRender();
  }

  // Canvas Drag & Drop Image Tracing, Project Files, AND Library Patterns
  // Wire BOTH stageEl and canvasEl to prevent the forbidden cursor on the child <canvas>
  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    // Update drop-hover partition glow
    const patternId = e.dataTransfer.types.includes('text/sashiko-pattern-id') ? 'pending' : null;
    if (patternId && subLabManager) {
      const worldPt = camera.screenToWorld(e.clientX, e.clientY);
      let hovered = null;
      for (const p of partitionEngine.partitions) {
        if (p.points && partitionEngine.isPointInside(worldPt, p.points)) {
          hovered = p;
          break;
        }
      }
      if (subLabManager.hoveredDropPartition !== hovered) {
        subLabManager.hoveredDropPartition = hovered;
        camera.requestRender();
      }
    }
  }

  function handleDragLeave(e) {
    if (subLabManager && subLabManager.hoveredDropPartition) {
      subLabManager.hoveredDropPartition = null;
      camera.requestRender();
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    // Clear drop hover
    if (subLabManager) {
      subLabManager.hoveredDropPartition = null;
    }

    // 1. Check for Pattern Dragged from Library
    const patternId = e.dataTransfer.getData('text/sashiko-pattern-id') || e.dataTransfer.getData('text/plain');
    if (patternId && patternRegistry.patterns.some(p => p.id === patternId)) {
      const worldPt = camera.screenToWorld(e.clientX, e.clientY);
      applyPatternToPartitionOrCanvas(patternId, worldPt);
      return;
    }

    // 2. Check for Dropped Files (.sashiko project file or image)
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.name.endsWith('.sashiko') || file.name.endsWith('.json')) {
      if (projectFileManager) {
        projectFileManager.loadFromFile(file);
      }
    } else if (file.type.startsWith('image/')) {
      loadReferenceImageFile(file);
    }
  }

  stageEl.addEventListener('dragover', handleDragOver);
  stageEl.addEventListener('dragleave', handleDragLeave);
  stageEl.addEventListener('drop', handleDrop);
  canvasEl.addEventListener('dragover', handleDragOver);
  canvasEl.addEventListener('dragleave', handleDragLeave);
  canvasEl.addEventListener('drop', handleDrop);

  subLabManager.onPatternPasted = (patternEdges, activePartition) => {
    const newKeys = new Set();
    for (const [k, edge] of patternEdges.entries()) {
      stitchPen.stitches.set(k, edge);
      newKeys.add(k);
    }
    stitchPen.selectedStitches = newKeys;
    stitchPen.setTool('select');
    stitchPen.notifySelection();
    stitchPen.notifyChange();
    camera.requestRender();
  };

  // 1-Click Instant Pattern Switching or Re-placing from Library
  patternRegistry.onPatternSelected = (patternId) => {
    applyPatternToPartitionOrCanvas(patternId);
  };

  const btnFillAll = document.getElementById('btn-fill-all-shapes');
  if (btnFillAll) {
    btnFillAll.addEventListener('click', () => {
      if (!patternRegistry.selectedPatternId || patternRegistry.patterns.length === 0) {
        console.warn('Sashiko CAD: No authentic pattern currently selected in library.');
        return;
      }
      stitchPen.stitches.clear();
      for (const p of partitionEngine.partitions) {
        const edges = patternRegistry.generateForPartition(p, patternRegistry.selectedPatternId);
        for (const [k, edge] of edges.entries()) {
          stitchPen.stitches.set(k, edge);
        }
      }
      stitchPen.notifyChange();
      camera.requestRender();
    });
  }

  const btnClearActive = document.getElementById('btn-clear-active-shape');
  if (btnClearActive) {
    btnClearActive.addEventListener('click', () => {
      const active = subLabManager.getActivePartition();
      if (!active) return;
      for (const [k, edge] of Array.from(stitchPen.stitches.entries())) {
        if (edge.partitionId === active.id) {
          stitchPen.stitches.delete(k);
        }
      }
      stitchPen.notifyChange();
      camera.requestRender();
    });
  }

  customSlicer.onSliced = () => {
    const activeTab = multiProjectTabs.getActiveTab();
    if (activeTab) {
      activeTab.partitions = JSON.parse(JSON.stringify(partitionEngine.partitions));
    }
    historyManager.pushState(multiProjectTabs.serializeAll());
    camera.requestRender();
  };

  // 7. Master Render Pipeline
  camera.subscribe((ctx, state) => {
    // 1. Physical Fabric / Artboard Backdrop
    opticsEngine.renderCushionBackdrop(ctx, state);

    // 2. Reference Image Tracing Layers (Illustrator Template Standard - stacked under grids & stitches)
    layerManager.renderImageLayers(ctx, state);

    // 3. Partitions & 3x3 Sub-Labs (Image 3 Green Focus)
    subLabManager.renderPartitions(ctx, state, opticsEngine);

    // 4. Hierarchical Looping Grid & Discrete Anchor Dots (Image 4)
    latticeGrid.render(ctx, state, opticsEngine);

    // 5. Sashiko Stitches & Chained Pen (Image 5)
    stitchPen.render(ctx, state, opticsEngine);

    // 6. Knife / Slicer Guides
    customSlicer.render(ctx);

    // 7. Master Curve & Arc Engine Live Preview
    curveEngine.render(ctx, state);
  });

  // 8. BIND UI CONTROLS

  // --- Common Canvas Size Dropdown Popover (Top Header: 16*16, 18*18, 20*20, Custom 16*20) ---
  const btnSizeTrigger = document.getElementById('btn-size-dropdown-trigger');
  const sizeMenu = document.getElementById('canvas-size-menu');
  const sizeWrapper = document.getElementById('canvas-size-wrapper');
  const currentSizeDisplay = document.getElementById('current-size-display');

  function applyCanvasSize(wInches, hInches, label) {
    if (label === 'Free Canvas' || !wInches || !hInches) {
      camera.setWorkAreaEnabled(false);
      if (currentSizeDisplay) {
        currentSizeDisplay.textContent = 'Free Canvas';
      }
      updateArtboardHUD();
      camera.requestRender();
      return;
    }

    camera.setWorkAreaEnabled(true);
    camera.setCustomArtboard(wInches, hInches, label);
    camera.centerCushion();
    subLabManager.initNineSquareBlocks();
    subLabManager.renderPartitionListUI();

    if (currentSizeDisplay) {
      currentSizeDisplay.textContent = label;
    }
    updateArtboardHUD();
    blueprintSpecs.updateMetrics();

    // Update active tab title
    const activeTab = multiProjectTabs.getActiveTab();
    if (activeTab) {
      multiProjectTabs.renameTab(activeTab.id, `${activeTab.title.split(' (')[0]} (${label})`);
    }

    // Synchronize select dropdown in Properties pane if exists
    if (selectArtboardSize) {
      const match = Array.from(selectArtboardSize.options).find(o => o.text.includes(`${wInches}"`) || o.value === label);
      if (match) selectArtboardSize.value = match.value;
    }

    camera.requestRender();
  }

  if (btnSizeTrigger && sizeMenu) {
    btnSizeTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = sizeMenu.classList.toggle('hidden');
      btnSizeTrigger.classList.toggle('active', !isHidden);
    });

    // Close popover when clicking outside
    document.addEventListener('click', (e) => {
      if (sizeWrapper && !sizeWrapper.contains(e.target)) {
        sizeMenu.classList.add('hidden');
        btnSizeTrigger.classList.remove('active');
      }
    });

    // Preset buttons (Free Canvas, 16x16, 18x18, 20x20, A2)
    document.querySelectorAll('.size-preset-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.size-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (btn.dataset.size === 'free') {
          applyCanvasSize(null, null, 'Free Canvas');
        } else {
          const w = parseFloat(btn.dataset.w);
          const h = parseFloat(btn.dataset.h);
          const label = btn.dataset.label;
          applyCanvasSize(w, h, label);
        }

        sizeMenu.classList.add('hidden');
        btnSizeTrigger.classList.remove('active');
      });
    });

    // Custom Size Apply Button (e.g. 16*20)
    const btnApplyCustom = document.getElementById('btn-apply-custom-size');
    const inputCustomW = document.getElementById('input-custom-w');
    const inputCustomH = document.getElementById('input-custom-h');

    if (btnApplyCustom && inputCustomW && inputCustomH) {
      const handleCustomApply = (e) => {
        e.stopPropagation();
        const w = parseFloat(inputCustomW.value) || 16;
        const h = parseFloat(inputCustomH.value) || 20;
        const label = `${w}" × ${h}"`;

        document.querySelectorAll('.size-preset-btn').forEach(b => b.classList.remove('active'));
        applyCanvasSize(w, h, label);

        sizeMenu.classList.add('hidden');
        btnSizeTrigger.classList.remove('active');
      };

      btnApplyCustom.addEventListener('click', handleCustomApply);
      inputCustomW.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleCustomApply(e); });
      inputCustomH.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleCustomApply(e); });
    }
  }

  const btnUnitIn = document.getElementById('btn-unit-in');
  const btnUnitCm = document.getElementById('btn-unit-cm');
  const btnUnitMm = document.getElementById('btn-unit-mm');
  const unitButtons = [btnUnitIn, btnUnitCm, btnUnitMm];

  function updateGridUI() {
    const valPitch = document.getElementById('val-main-pitch');
    if (valPitch) valPitch.textContent = latticeGrid.getMainSizeFormatted();

    const badgeSub = document.getElementById('val-subgrid-calc-size');
    if (badgeSub) badgeSub.textContent = latticeGrid.getSubSizeFormatted();

    const badgeMicro = document.getElementById('val-microgrid-calc-size');
    if (badgeMicro) badgeMicro.textContent = latticeGrid.getMicroSizeFormatted();

    const valH = document.getElementById('val-subdiv-h');
    const valV = document.getElementById('val-subdiv-v');
    const note = document.getElementById('subgrid-note');
    if (valH) valH.textContent = latticeGrid.subDivH;
    if (valV) valV.textContent = latticeGrid.subDivV;
    if (note) {
      note.textContent = `${latticeGrid.subDivH}×${latticeGrid.subDivV} = ${latticeGrid.subDivH * latticeGrid.subDivV} sub-boxes (${latticeGrid.getSubSizeFormatted()} each)`;
    }

    const valMicroH = document.getElementById('val-microdiv-h');
    const valMicroV = document.getElementById('val-microdiv-v');
    const microNote = document.getElementById('microgrid-note');
    if (valMicroH) valMicroH.textContent = latticeGrid.microDivH;
    if (valMicroV) valMicroV.textContent = latticeGrid.microDivV;
    if (microNote) {
      microNote.textContent = `${latticeGrid.microDivH}×${latticeGrid.microDivV} = ${latticeGrid.microDivH * latticeGrid.microDivV} micro-boxes (${latticeGrid.getMicroSizeFormatted()} each)`;
    }
  }

  const PITCH_PRESETS = {
    in: [
      { label: '1.00"', mm: 25.4, val: 1.0 },
      { label: '1.50"', mm: 38.1, val: 1.5 },
      { label: '2.00"', mm: 50.8, val: 2.0 },
      { label: '3.00"', mm: 76.2, val: 3.0 }
    ],
    cm: [
      { label: '2.0 cm', mm: 20.0, val: 2.0 },
      { label: '3.0 cm', mm: 30.0, val: 3.0 },
      { label: '4.0 cm', mm: 40.0, val: 4.0 },
      { label: '5.0 cm', mm: 50.0, val: 5.0 }
    ],
    mm: [
      { label: '20 mm', mm: 20.0, val: 20.0 },
      { label: '25 mm', mm: 25.0, val: 25.0 },
      { label: '30 mm', mm: 30.0, val: 30.0 },
      { label: '50 mm', mm: 50.0, val: 50.0 }
    ]
  };

  function updatePitchPresetsUI() {
    const container = document.getElementById('pitch-presets-row');
    if (!container) return;
    const presets = PITCH_PRESETS[latticeGrid.unit] || PITCH_PRESETS.in;
    container.innerHTML = '';

    presets.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'pitch-preset-pill';
      btn.textContent = p.label;
      const isMatch = Math.abs(latticeGrid.mainPitchMm - p.mm) < 0.25;
      if (isMatch) btn.classList.add('active');

      btn.addEventListener('click', () => {
        latticeGrid.mainPitchMm = p.mm;
        const input = document.getElementById('input-main-pitch');
        if (input) input.value = p.val;
        updatePitchPresetsUI();
        updateGridUI();
        blueprintSpecs.updateMetrics();
        camera.requestRender();
      });

      container.appendChild(btn);
    });
  }

  function initCollapsibleSections() {
    // 1. Top-level accordion section headers (Document Setup, Ruler & Grids, Selection Inspector)
    document.querySelectorAll('.collapsible-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('select, input:not(.swatch-input)')) return;
        const targetId = header.getAttribute('data-target');
        if (!targetId) return;
        const target = document.getElementById(targetId);
        if (!target) return;

        const isCollapsed = target.classList.contains('collapsed');
        target.classList.toggle('collapsed', !isCollapsed);
        header.classList.toggle('is-collapsed', !isCollapsed);
      });
    });

    // 2. Nested card triggers (Sub-Grid Tier 2, Micro-Grid Tier 3)
    document.querySelectorAll('.collapsible-trigger').forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select')) return;
        const targetId = trigger.getAttribute('data-target');
        if (!targetId) return;
        const target = document.getElementById(targetId);
        if (!target) return;

        const isCollapsed = target.classList.contains('collapsed');
        target.classList.toggle('collapsed', !isCollapsed);
        trigger.classList.toggle('is-collapsed', !isCollapsed);
      });
    });
  }

  function syncUnitSlider() {
    const inputMainPitch = document.getElementById('input-main-pitch');
    if (!inputMainPitch) return;
    if (latticeGrid.unit === 'in') {
      inputMainPitch.min = '0.5';
      inputMainPitch.max = '3.0';
      inputMainPitch.step = '0.05';
      inputMainPitch.value = (latticeGrid.mainPitchMm / 25.4).toFixed(2);
    } else if (latticeGrid.unit === 'cm') {
      inputMainPitch.min = '1.0';
      inputMainPitch.max = '8.0';
      inputMainPitch.step = '0.1';
      inputMainPitch.value = (latticeGrid.mainPitchMm / 10.0).toFixed(1);
    } else {
      inputMainPitch.min = '10.0';
      inputMainPitch.max = '80.0';
      inputMainPitch.step = '1.0';
      inputMainPitch.value = latticeGrid.mainPitchMm.toFixed(1);
    }
    updatePitchPresetsUI();
    updateGridUI();
  }

  unitButtons.forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      unitButtons.forEach(b => b?.classList.remove('active'));
      btn.classList.add('active');
      const u = btn.id.replace('btn-unit-', '');
      camera.rulerUnit = u;
      latticeGrid.setUnit(u);
      syncUnitSlider();
      blueprintSpecs.updateMetrics();
      camera.requestRender();
    });
  });

  camera.onRulerUnitChanged = (u) => {
    latticeGrid.setUnit(u);
    syncUnitSlider();
    unitButtons.forEach(btn => {
      btn?.classList.toggle('active', btn.id === `btn-unit-${u}`);
    });
    blueprintSpecs.updateMetrics();
  };

  const btnFitArtboardScreen = document.getElementById('btn-fit-artboard-screen');
  if (btnFitArtboardScreen) {
    btnFitArtboardScreen.addEventListener('click', () => {
      camera.centerCushion();
    });
  }

  // --- 3-Tier Hierarchical Grid Controls ---
  const btnToggleMainGrid = document.getElementById('btn-toggle-main-grid');
  if (btnToggleMainGrid) {
    btnToggleMainGrid.addEventListener('click', () => {
      latticeGrid.mainGridEnabled = !latticeGrid.mainGridEnabled;
      btnToggleMainGrid.classList.toggle('active', latticeGrid.mainGridEnabled);
      btnToggleMainGrid.textContent = `Main: ${latticeGrid.mainGridEnabled ? 'ON' : 'OFF'}`;
      camera.requestRender();
    });
  }

  const btnToggleSubGrid = document.getElementById('btn-toggle-sub-grid');
  if (btnToggleSubGrid) {
    btnToggleSubGrid.addEventListener('click', () => {
      latticeGrid.subGridEnabled = !latticeGrid.subGridEnabled;
      btnToggleSubGrid.classList.toggle('active', latticeGrid.subGridEnabled);
      btnToggleSubGrid.textContent = `Sub: ${latticeGrid.subGridEnabled ? 'ON' : 'OFF'}`;
      camera.requestRender();
    });
  }

  const btnToggleMicroGrid = document.getElementById('btn-toggle-micro-grid');
  if (btnToggleMicroGrid) {
    btnToggleMicroGrid.addEventListener('click', () => {
      latticeGrid.microGridEnabled = !latticeGrid.microGridEnabled;
      btnToggleMicroGrid.classList.toggle('active', latticeGrid.microGridEnabled);
      btnToggleMicroGrid.textContent = `Micro: ${latticeGrid.microGridEnabled ? 'ON' : 'OFF'}`;
      updateGridUI();
      camera.requestRender();
    });
  }

  const inputMainPitch = document.getElementById('input-main-pitch');
  if (inputMainPitch) {
    inputMainPitch.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (latticeGrid.unit === 'in') {
        latticeGrid.mainPitchMm = val * 25.4;
      } else if (latticeGrid.unit === 'cm') {
        latticeGrid.mainPitchMm = val * 10.0;
      } else {
        latticeGrid.mainPitchMm = val;
      }
      updatePitchPresetsUI();
      updateGridUI();
      blueprintSpecs.updateMetrics();
      camera.requestRender();
    });
  }

  // Tier 2: Sub-Grid row/column subdivision counters
  document.getElementById('btn-subdiv-h-minus')?.addEventListener('click', () => {
    latticeGrid.adjustSubDivH(-1);
    updateGridUI();
    blueprintSpecs.updateMetrics();
  });
  document.getElementById('btn-subdiv-h-plus')?.addEventListener('click', () => {
    latticeGrid.adjustSubDivH(1);
    updateGridUI();
    blueprintSpecs.updateMetrics();
  });
  document.getElementById('btn-subdiv-v-minus')?.addEventListener('click', () => {
    latticeGrid.adjustSubDivV(-1);
    updateGridUI();
    blueprintSpecs.updateMetrics();
  });
  document.getElementById('btn-subdiv-v-plus')?.addEventListener('click', () => {
    latticeGrid.adjustSubDivV(1);
    updateGridUI();
    blueprintSpecs.updateMetrics();
  });

  // Tier 3: Micro-Grid subdivision counters
  document.getElementById('btn-microdiv-h-minus')?.addEventListener('click', () => {
    latticeGrid.adjustMicroDivH(-1);
    updateGridUI();
  });
  document.getElementById('btn-microdiv-h-plus')?.addEventListener('click', () => {
    latticeGrid.adjustMicroDivH(1);
    updateGridUI();
  });
  document.getElementById('btn-microdiv-v-minus')?.addEventListener('click', () => {
    latticeGrid.adjustMicroDivV(-1);
    updateGridUI();
  });
  document.getElementById('btn-microdiv-v-plus')?.addEventListener('click', () => {
    latticeGrid.adjustMicroDivV(1);
    updateGridUI();
  });

  // Cushion Patchwork Template Selector
  const selectCushionTemplate = document.getElementById('select-cushion-template');
  if (selectCushionTemplate) {
    selectCushionTemplate.addEventListener('change', (e) => {
      const t = e.target.value;
      subLabManager.applyTemplate(t);
      const badge = document.getElementById('shape-count-badge');
      if (badge) badge.textContent = `${subLabManager.partitions.length} Blocks`;
      blueprintSpecs.updateMetrics();
      camera.requestRender();
    });
  }

  const inputGridOpacity = document.getElementById('input-grid-opacity');
  const valGridOpacity = document.getElementById('val-grid-opacity');
  if (inputGridOpacity && valGridOpacity) {
    inputGridOpacity.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      latticeGrid.opacity = val;
      valGridOpacity.textContent = `${Math.round(val * 100)}%`;
      camera.requestRender();
    });
  }

  const btnDotsShow = document.getElementById('btn-dots-show');
  const btnDotsHide = document.getElementById('btn-dots-hide');
  if (btnDotsShow && btnDotsHide) {
    btnDotsShow.addEventListener('click', () => {
      btnDotsShow.classList.add('active');
      btnDotsHide.classList.remove('active');
      latticeGrid.showDots = true;
      camera.requestRender();
    });
    btnDotsHide.addEventListener('click', () => {
      btnDotsHide.classList.add('active');
      btnDotsShow.classList.remove('active');
      latticeGrid.showDots = false;
      camera.requestRender();
    });
  }

  // --- Selection Inspector Controls (Marquee V & Direct Select A) ---
  const badgeSel = document.getElementById('selection-count-badge');
  const btnSelDup = document.getElementById('btn-sel-duplicate');
  const btnSelRot45 = document.getElementById('btn-sel-rot-45');
  const btnSelRot90 = document.getElementById('btn-sel-rot-90');
  const btnSelRot180 = document.getElementById('btn-sel-rot-180');
  const btnSelMirror = document.getElementById('btn-sel-mirror');
  const btnSelDel = document.getElementById('btn-sel-delete');

  const btnInspUnion = document.getElementById('btn-insp-bool-union');
  const btnInspSubtract = document.getElementById('btn-insp-bool-subtract');
  const btnInspIntersect = document.getElementById('btn-insp-bool-intersect');
  const btnInspExclude = document.getElementById('btn-insp-bool-exclude');
  const btnInspFlatten = document.getElementById('btn-insp-bool-flatten');

  const btnSelGroup = document.getElementById('btn-sel-group');
  const btnSelUngroup = document.getElementById('btn-sel-ungroup');
  const selectSelLayer = document.getElementById('select-selection-layer');
  const btnApplyMoveLayer = document.getElementById('btn-apply-move-layer');

  function updateSelectionLayerDropdown() {
    if (!selectSelLayer) return;
    const currentVal = selectSelLayer.value;
    selectSelLayer.innerHTML = '';
    for (const l of layerManager.layers) {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = `${l.locked ? '🔒 ' : ''}${l.name}`;
      selectSelLayer.appendChild(opt);
    }
    if (currentVal && selectSelLayer.querySelector(`option[value="${currentVal}"]`)) {
      selectSelLayer.value = currentVal;
    }
  }

  const btnSelConvertLab = document.getElementById('btn-sel-convert-lab');
  const btnSelToggleConstraint = document.getElementById('btn-sel-toggle-constraint');

  stitchPen.onSelectionChanged = (count, keys) => {
    if (badgeSel) {
      badgeSel.textContent = count > 0 ? `${count} Selected` : 'No Selection';
    }
    const hasSelection = count > 0;
    const hasMulti = count >= 2;

    if (btnSelDup) btnSelDup.disabled = !hasSelection;
    if (btnSelRot45) btnSelRot45.disabled = !hasSelection;
    if (btnSelRot90) btnSelRot90.disabled = !hasSelection;
    if (btnSelRot180) btnSelRot180.disabled = !hasSelection;
    if (btnSelMirror) btnSelMirror.disabled = !hasSelection;
    if (btnSelDel) btnSelDel.disabled = !hasSelection;

    if (btnInspUnion) btnInspUnion.disabled = !hasMulti;
    if (btnInspSubtract) btnInspSubtract.disabled = !hasMulti;
    if (btnInspIntersect) btnInspIntersect.disabled = !hasMulti;
    if (btnInspExclude) btnInspExclude.disabled = !hasMulti;
    if (btnInspFlatten) btnInspFlatten.disabled = !hasSelection;

    if (btnSelGroup) btnSelGroup.disabled = !hasMulti;
    if (btnSelUngroup) btnSelUngroup.disabled = !hasSelection;
    if (selectSelLayer) selectSelLayer.disabled = !hasSelection;
    if (btnApplyMoveLayer) btnApplyMoveLayer.disabled = !hasSelection;

    if (btnSelConvertLab) btnSelConvertLab.disabled = count < 1 && stitchPen.stitches.size === 0;
    if (btnSelToggleConstraint) {
      btnSelToggleConstraint.disabled = !subLabManager.partitions.some(p => p.isCustom);
      btnSelToggleConstraint.textContent = subLabManager.constrainToLab
        ? '🔒 Constrain Drawing to Lab: ON'
        : '🔓 Constrain Drawing to Lab: OFF';
    }

    updateSelectionLayerDropdown();
  };

  btnSelDup?.addEventListener('click', () => stitchPen.duplicateSelected());
  btnSelRot45?.addEventListener('click', () => stitchPen.rotateSelected(45));
  btnSelRot90?.addEventListener('click', () => stitchPen.rotateSelected(90));
  btnSelRot180?.addEventListener('click', () => stitchPen.rotateSelected(180));
  btnSelMirror?.addEventListener('click', () => stitchPen.mirrorSelected());
  btnSelDel?.addEventListener('click', () => stitchPen.deleteSelected());

  btnSelConvertLab?.addEventListener('click', () => {
    if (stitchPen.selectedStitches.size === 0 && stitchPen.stitches.size > 0) {
      stitchPen.selectAllInShapeOrCanvas();
    }
    const customPart = subLabManager.createLabFromStitches(stitchPen.selectedStitches, stitchPen.stitches, latticeGrid);
    if (customPart) {
      document.querySelector('.insp-tab[data-tab="shapes"]')?.click();
      stitchPen.notifySelection();
      camera.requestRender();
    }
  });

  btnSelToggleConstraint?.addEventListener('click', () => {
    const c = subLabManager.toggleConstraint();
    if (btnSelToggleConstraint) {
      btnSelToggleConstraint.textContent = c
        ? '🔒 Constrain Drawing to Lab: ON'
        : '🔓 Constrain Drawing to Lab: OFF';
    }
    stitchPen.notifySelection();
  });

  btnInspUnion?.addEventListener('click', () => booleanEngine.union());
  btnInspSubtract?.addEventListener('click', () => booleanEngine.subtract());
  btnInspIntersect?.addEventListener('click', () => booleanEngine.intersect());
  btnInspExclude?.addEventListener('click', () => booleanEngine.exclude());
  btnInspFlatten?.addEventListener('click', () => booleanEngine.flatten());

  btnSelGroup?.addEventListener('click', () => booleanEngine.group());
  btnSelUngroup?.addEventListener('click', () => booleanEngine.ungroup());

  // --- Canvas & Stitch Context Menu (Right-Click Menu) ---
  const canvasContextMenu = document.getElementById('canvas-context-menu');

  stitchPen.onContextMenuRequested = (e, worldPt) => {
    if (!canvasContextMenu) return;
    const count = stitchPen.selectedStitches.size;
    const convertItem = document.getElementById('ctx-convert-to-lab');
    if (convertItem) {
      convertItem.style.opacity = count >= 3 ? '1' : '0.5';
      convertItem.style.pointerEvents = count >= 3 ? 'auto' : 'none';
    }

    const constraintLabel = document.getElementById('ctx-constraint-label');
    if (constraintLabel) {
      constraintLabel.textContent = subLabManager.constrainToLab ? 'Unlock Drawing from Lab' : 'Lock Drawing Inside Lab';
    }

    canvasContextMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 230)}px`;
    canvasContextMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 250)}px`;
    canvasContextMenu.classList.remove('hidden');
  };

  document.addEventListener('click', (e) => {
    if (canvasContextMenu && !canvasContextMenu.contains(e.target)) {
      canvasContextMenu.classList.add('hidden');
    }
  });

  document.getElementById('ctx-convert-to-lab')?.addEventListener('click', () => {
    canvasContextMenu.classList.add('hidden');
    const customPart = subLabManager.createLabFromStitches(stitchPen.selectedStitches, stitchPen.stitches, latticeGrid);
    if (customPart) {
      document.querySelector('.insp-tab[data-tab="shapes"]')?.click();
      stitchPen.notifySelection();
    }
  });

  document.getElementById('ctx-toggle-constraint')?.addEventListener('click', () => {
    canvasContextMenu.classList.add('hidden');
    subLabManager.toggleConstraint();
    stitchPen.notifySelection();
  });

  document.getElementById('ctx-copy-selection')?.addEventListener('click', () => {
    canvasContextMenu.classList.add('hidden');
    booleanEngine.copy();
  });

  document.getElementById('ctx-paste-selection')?.addEventListener('click', () => {
    canvasContextMenu.classList.add('hidden');
    booleanEngine.paste();
  });

  document.getElementById('ctx-group-selection')?.addEventListener('click', () => {
    canvasContextMenu.classList.add('hidden');
    booleanEngine.group();
  });

  document.getElementById('ctx-delete-selection')?.addEventListener('click', () => {
    canvasContextMenu.classList.add('hidden');
    stitchPen.deleteSelected();
  });

  // Illustrator / Figma Focus Mode (Isolation) & Line Locking
  document.getElementById('ctx-isolate-selection')?.addEventListener('click', () => {
    canvasContextMenu.classList.add('hidden');
    stitchPen.enterIsolationMode('selection');
  });

  document.getElementById('ctx-lock-stitches')?.addEventListener('click', () => {
    canvasContextMenu.classList.add('hidden');
    stitchPen.lockSelectedStitches();
  });

  document.getElementById('ctx-unlock-all-stitches')?.addEventListener('click', () => {
    canvasContextMenu.classList.add('hidden');
    stitchPen.unlockAllStitches();
  });

  document.getElementById('btn-exit-isolation')?.addEventListener('click', () => {
    stitchPen.exitIsolationMode();
  });

  const applyMoveSelectionToLayer = () => {
    if (selectSelLayer && selectSelLayer.value) {
      stitchPen.moveSelectedToLayer(selectSelLayer.value);
      layerManager.renderLayerListUI(document.getElementById('layers-container-box'), stitchPen.stitches);
    }
  };

  selectSelLayer?.addEventListener('change', applyMoveSelectionToLayer);
  btnApplyMoveLayer?.addEventListener('click', applyMoveSelectionToLayer);

  // Custom Sub-Lab Multi-Shape Drag Creation Handler
  stitchPen.onCustomLabCreated = ({ minX, minY, w, h, points, shapeType }) => {
    const labIndex = partitionEngine.partitions.length + 1;
    const wIn = (w / camera.ppi).toFixed(1);
    const hIn = (h / camera.ppi).toFixed(1);
    const customId = `Lab_${labIndex}`;
    const shapeLabels = { rect: 'Box', triangle: 'Triangle', circle: 'Circle', hexagon: 'Hexagon' };
    const shapeLabel = shapeLabels[shapeType] || 'Lab';
    const newPartition = {
      id: customId,
      label: `L${labIndex}`,
      name: `Custom ${shapeLabel} ${labIndex} (${wIn}" × ${hIn}")`,
      type: shapeType || 'rect',
      isCustom: true,
      rotation: 0,
      points: points || [
        { x: minX, y: minY },
        { x: minX + w, y: minY },
        { x: minX + w, y: minY + h },
        { x: minX, y: minY + h }
      ]
    };

    partitionEngine.partitions.push(newPartition);
    subLabManager.activePartitionId = customId;
    subLabManager.isGreenSubLabActive = true;
    const btnGreen = document.getElementById('btn-toggle-green-sublab');
    if (btnGreen) btnGreen.classList.add('active');
    subLabManager.renderPartitionListUI();

    const activeTab = multiProjectTabs.getActiveTab();
    if (activeTab) {
      activeTab.partitions = JSON.parse(JSON.stringify(partitionEngine.partitions));
      activeTab.activePartitionId = customId;
    }
    if (historyManager) {
      historyManager.pushState(multiProjectTabs.serializeAll());
    }

    camera.requestRender();

    // Auto-switch to select so user can immediately transform or fill the new lab
    stitchPen.setTool('select');
  };

  // Wire Floating Shape Picker HUD
  document.querySelectorAll('#shape-picker-hud .shape-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#shape-picker-hud .shape-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      stitchPen.setShapeType(btn.dataset.shape);
    });
  });

  // Wire Floating Radial Symmetry HUD for Curve & Arc Engine
  document.querySelectorAll('#curve-symmetry-hud .shape-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#curve-symmetry-hud .shape-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const order = parseInt(btn.dataset.symmetry, 10) || 1;
      curveEngine.setRadialSymmetry(order);
    });
  });

  // Wire Pen Line Style Toggle Pills (Sashiko Dashed vs Solid)
  const btnStyleSashiko = document.getElementById('btn-line-style-sashiko');
  const btnStyleSolid = document.getElementById('btn-line-style-solid');

  btnStyleSashiko?.addEventListener('click', () => {
    stitchPen.setPenLineStyle('dashed');
    opticsEngine.setLineStyle('dashed');
    btnStyleSashiko.classList.add('active');
    btnStyleSolid?.classList.remove('active');
    camera.requestRender();
  });

  btnStyleSolid?.addEventListener('click', () => {
    stitchPen.setPenLineStyle('solid');
    opticsEngine.setLineStyle('solid');
    btnStyleSolid.classList.add('active');
    btnStyleSashiko?.classList.remove('active');
    camera.requestRender();
  });

  // --- Left Vertical Toolbar (Illustrator Standard - Image 2) ---
  let toolbarRotIndex = 0;
  const toolbarRotAngles = [45, 90, 180, 360];

  document.querySelectorAll('.tool-icon-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;

      if (tool === 'shape-rect') {
        subLabManager.isGreenSubLabActive = true;
        const btnGreen = document.getElementById('btn-toggle-green-sublab');
        if (btnGreen) btnGreen.classList.add('active');
        subLabManager.renderPartitionListUI();
        customSlicer.setEnabled(false);
        stitchPen.setTool('shape-rect');
        return;
      }
      if (tool === 'rotate') {
        const deg = toolbarRotAngles[toolbarRotIndex % toolbarRotAngles.length];
        toolbarRotIndex++;
        stitchPen.rotateSelected(deg);
        return;
      }
      if (tool === 'mirror') {
        stitchPen.mirrorSelected();
        return;
      }
      if (tool === 'hand') {
        stitchPen.setTool('hand');
        return;
      }
      if (tool === 'zoom') {
        camera.zoom = Math.min(camera.zoom * 1.5, 4.0);
        camera.updateZoomHUD();
        camera.requestRender();
        return;
      }
      if (tool === 'virtual-ruler') {
        virtualRuler.toggleVisible();
        return;
      }

      customSlicer.setEnabled(tool === 'slicer');
      stitchPen.setTool(tool);
    });
  });

  // Overlapping Color Swatches (Illustrator Style - Image 2)
  const inputToolStitchColor = document.getElementById('input-tool-stitch-color');
  const inputToolBgColor = document.getElementById('input-tool-bg-color');
  const btnSwatchDefault = document.getElementById('btn-swatch-default');
  const swatchStrokeBox = document.getElementById('swatch-stroke-box');
  const swatchFillBox = document.getElementById('swatch-fill-box');

  function updateSwatchVisuals(bg, stitch) {
    if (swatchStrokeBox) swatchStrokeBox.style.background = stitch;
    if (swatchFillBox) swatchFillBox.style.background = bg;
    if (inputToolStitchColor) inputToolStitchColor.value = stitch;
    if (inputToolBgColor) inputToolBgColor.value = bg;
    document.querySelectorAll('.swatch-preset-dot').forEach(dot => {
      const dotBg = dot.getAttribute('data-bg');
      if (dotBg) {
        dot.classList.toggle('active', dotBg.toLowerCase() === bg.toLowerCase());
      }
    });
  }

  function setCanvasColors(bg, stitch, saveHistory = true) {
    opticsEngine.setCustomColors(bg, stitch);
    camera.artboardBg = bg;
    updateSwatchVisuals(bg, stitch);

    const activeTab = multiProjectTabs.getActiveTab();
    if (activeTab) {
      activeTab.bgColor = bg;
      activeTab.stitchColor = stitch;
    }

    camera.requestRender();

    if (saveHistory) {
      historyManager.pushState(multiProjectTabs.serializeAll());
    }
  }

  function resetColorsToDefault(saveHistory = true) {
    const defStitch = '#FFFFFF';
    const defBg = opticsEngine.isDark ? '#121316' : '#FFFFFF';
    setCanvasColors(defBg, defStitch, saveHistory);
  }

  if (inputToolStitchColor) {
    inputToolStitchColor.addEventListener('input', (e) => {
      setCanvasColors(opticsEngine.bgColor, e.target.value, false);
    });
    inputToolStitchColor.addEventListener('change', (e) => {
      setCanvasColors(opticsEngine.bgColor, e.target.value, true);
    });
  }
  if (inputToolBgColor) {
    inputToolBgColor.addEventListener('input', (e) => {
      setCanvasColors(e.target.value, opticsEngine.stitchColor, false);
    });
    inputToolBgColor.addEventListener('change', (e) => {
      setCanvasColors(e.target.value, opticsEngine.stitchColor, true);
    });
  }
  if (btnSwatchDefault) {
    btnSwatchDefault.addEventListener('click', () => {
      resetColorsToDefault(true);
    });
  }

  // Quick Fabric Presets Row
  document.querySelectorAll('.swatch-preset-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const bg = dot.getAttribute('data-bg');
      const stitch = dot.getAttribute('data-stitch') || '#FFFFFF';
      setCanvasColors(bg, stitch, true);
    });
  });

  // Dedicated Reset Canvas Settings to Default (Document Setup)
  const btnResetCanvasSettings = document.getElementById('btn-reset-canvas-settings');
  if (btnResetCanvasSettings) {
    btnResetCanvasSettings.addEventListener('click', () => {
      // 1. Reset Colors to Obsidian / Dark Default
      resetColorsToDefault(false);

      // 2. Reset Master Pitch (Tier 1) to 1.00 in (or 3.00 cm)
      const isInch = camera.rulerUnit === 'in';
      const defPitch = isInch ? 1.0 : 3.0;
      latticeGrid.masterPitch = defPitch;
      const inputMainPitch = document.getElementById('input-main-pitch');
      const valMainPitch = document.getElementById('val-main-pitch');
      if (inputMainPitch) inputMainPitch.value = defPitch;
      if (valMainPitch) valMainPitch.textContent = `${defPitch.toFixed(2)} ${camera.rulerUnit}`;

      // 3. Reset Grid Opacity to 12%
      latticeGrid.opacity = 0.12;
      const inputGridOpacity = document.getElementById('input-grid-opacity');
      const valGridOpacity = document.getElementById('val-grid-opacity');
      if (inputGridOpacity) inputGridOpacity.value = 0.12;
      if (valGridOpacity) valGridOpacity.textContent = '12%';

      // 4. Reset Anchor Dots to ON
      latticeGrid.showDots = true;
      const btnDotsShow = document.getElementById('btn-dots-show');
      const btnDotsHide = document.getElementById('btn-dots-hide');
      if (btnDotsShow) btnDotsShow.classList.add('active');
      if (btnDotsHide) btnDotsHide.classList.remove('active');

      // 5. Reset Sub-Grid to 3x3
      latticeGrid.subDivH = 3;
      latticeGrid.subDivV = 3;
      updateGridUI();

      // 6. Reset Grids visibility
      latticeGrid.enabled = true;
      latticeGrid.subGridEnabled = true;

      camera.requestRender();
      historyManager.pushState(multiProjectTabs.serializeAll());
    });
  }

  // Clear Canvas Button
  const btnClear = document.getElementById('btn-clear-canvas');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (confirm('Clear all stitches on this canvas?')) {
        stitchPen.stitches.clear();
        stitchPen.selectedStitches.clear();
        stitchPen.chainAnchor = null;
        stitchPen.hoveredStitchKey = null;
        latticeGrid.ghostEdge = null;
        stitchPen.notifyChange();
        camera.requestRender();
      }
    });
  }

  // --- Dark / Light Mode Switch (Smooth Transition) ---
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  const themeModeText = document.getElementById('theme-mode-text');
  const themeIcon = document.querySelector('.theme-icon-indicator');

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      document.body.classList.toggle('light-theme');
      const isLight = document.body.classList.contains('light-theme');
      opticsEngine.isDark = !isLight;
      camera.artboardBg = isLight ? '#FFFFFF' : '#121316';
      camera.workbenchBg = isLight ? '#E5E7EB' : '#1A1C23';
      opticsEngine.bgColor = camera.artboardBg;
      opticsEngine.stitchColor = isLight ? '#0F172A' : '#00FF44';

      if (themeModeText) {
        themeModeText.textContent = isLight ? 'Light Mode' : 'Dark Mode';
      }
      if (themeIcon) {
        themeIcon.textContent = isLight ? '☀️' : '🌙';
      }
      const themeModeBadge = document.getElementById('theme-mode-badge');
      if (themeModeBadge) {
        themeModeBadge.textContent = isLight ? 'Clean Paper' : 'Obsidian';
      }
      if (inputToolBgColor) inputToolBgColor.value = camera.artboardBg;
      if (inputToolStitchColor) inputToolStitchColor.value = opticsEngine.stitchColor;
      camera.requestRender();
    });
  }

  // --- Zoom HUD Controls ---
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');
  const btnFit = document.getElementById('btn-fit-screen');

  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => {
      camera.zoom = Math.min(camera.zoom * 1.25, 4.0);
      camera.updateZoomHUD();
      camera.requestRender();
    });
  }
  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => {
      camera.zoom = Math.max(camera.zoom / 1.25, 0.08);
      camera.updateZoomHUD();
      camera.requestRender();
    });
  }
  if (btnZoomReset) {
    btnZoomReset.addEventListener('click', () => {
      camera.centerCushion();
    });
  }
  if (btnFit) {
    btnFit.addEventListener('click', () => {
      camera.centerCushion();
    });
  }

  // --- Right Inspector Tabs Switching ---
  document.querySelectorAll('.inspector-tabs .insp-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.inspector-tabs .insp-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.inspector-body .insp-pane').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const pane = document.getElementById(`pane-${tab.dataset.tab}`);
      if (pane) pane.classList.add('active');
    });
  });

  // Line Style (Dashed vs Solid)
  const styleDashed = document.getElementById('btn-line-style-sashiko') || document.getElementById('style-dashed');
  const styleSolid = document.getElementById('btn-line-style-solid') || document.getElementById('style-solid');
  if (styleDashed && styleSolid) {
    styleDashed.addEventListener('click', () => {
      styleDashed.classList.add('active');
      styleSolid.classList.remove('active');
      opticsEngine.setLineStyle('dashed');
      camera.requestRender();
    });
    styleSolid.addEventListener('click', () => {
      styleSolid.classList.add('active');
      styleDashed.classList.remove('active');
      opticsEngine.setLineStyle('solid');
      camera.requestRender();
    });
  }

  // --- Quadrant Tracing Modes (Full vs 25% Quad) ---
  const btnQuadFull = document.getElementById('btn-quad-full');
  const btnQuadSplit = document.getElementById('btn-quad-split');
  const quadSubPills = document.getElementById('quad-sub-pills');

  if (btnQuadFull && btnQuadSplit && quadSubPills) {
    btnQuadFull.addEventListener('click', () => {
      btnQuadFull.classList.add('active');
      btnQuadSplit.classList.remove('active');
      quadSubPills.classList.add('hidden');
      camera.centerCushion();
    });

    btnQuadSplit.addEventListener('click', () => {
      btnQuadSplit.classList.add('active');
      btnQuadFull.classList.remove('active');
      quadSubPills.classList.remove('hidden');
      focusQuadrant(1);
    });

    quadSubPills.querySelectorAll('.q-btn').forEach((qb) => {
      qb.addEventListener('click', () => {
        quadSubPills.querySelectorAll('.q-btn').forEach(b => b.classList.remove('active'));
        qb.classList.add('active');
        focusQuadrant(parseInt(qb.dataset.quad, 10));
      });
    });
  }

  function focusQuadrant(quadNum) {
    const halfW = camera.artboardWidthPx / 2;
    const halfH = camera.artboardHeightPx / 2;
    let targetX = 0;
    let targetY = 0;

    switch (quadNum) {
      case 1: targetX = 0; targetY = 0; break;
      case 2: targetX = halfW; targetY = 0; break;
      case 3: targetX = 0; targetY = halfH; break;
      case 4: targetX = halfW; targetY = halfH; break;
    }

    const available = Math.min(camera.screenWidth, camera.screenHeight) * 0.85;
    camera.zoom = available / Math.max(halfW, halfH);
    camera.panX = (camera.screenWidth / 2) - (targetX + halfW / 2) * camera.zoom;
    camera.panY = (camera.screenHeight / 2) - (targetY + halfH / 2) * camera.zoom;
    camera.updateZoomHUD();
    camera.requestRender();
  }

  // --- Art Lab & Screen Tracing Manager ---
  artLabManager = new ArtLabManager(
    camera,
    latticeGrid,
    partitionEngine,
    stitchPen,
    opticsEngine,
    layerManager
  );
  stitchPen.artLabManager = artLabManager;
  camera.artLabManager = artLabManager;

  // --- Virtual Artisan Ruler & Protractor ---
  const virtualRuler = new VirtualRuler(canvasEl, camera, artLabManager);
  artLabManager.setVirtualRuler(virtualRuler);
  multiProjectTabs.virtualRuler = virtualRuler;
  virtualRuler.historyManager = historyManager;
  virtualRuler.onStateChanged = () => {
    historyManager.pushState(multiProjectTabs.serializeAll());
  };
  window.cad.virtualRuler = virtualRuler;
  window.cad.artLabManager = artLabManager;
  window.cad.multiProjectTabs = multiProjectTabs;

  // --- Undo / Redo Handlers ---
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');

  const applySnapshot = (snap) => {
    if (!snap) return;
    // Preserve current camera viewport to avoid disorienting reset jumps on Undo/Redo
    const prevZoom = camera.zoom;
    const prevPanX = camera.panX;
    const prevPanY = camera.panY;

    multiProjectTabs.deserializeAll(snap);
    if (snap.ruler && virtualRuler) {
      virtualRuler.deserialize(snap.ruler);
    }
    const activeTab = multiProjectTabs.getActiveTab();
    if (activeTab) {
      if (activeTab.stitches) {
        stitchPen.stitches = new Map(activeTab.stitches);
        stitchPen.pathCacheDirty = true;
      }
      if (activeTab.bgColor) {
        opticsEngine.setCustomColors(activeTab.bgColor, activeTab.stitchColor || '#FFFFFF');
        camera.artboardBg = activeTab.bgColor;
        updateSwatchVisuals(activeTab.bgColor, activeTab.stitchColor || '#FFFFFF');
      }
      if (activeTab.layers) {
        layerManager.deserialize(activeTab.layers);
        layerManager.renderLayerListUI(document.getElementById('layers-container-box'), stitchPen.stitches);
      }
      stitchPen.spatialGridDirty = true;
      stitchPen.clearSelection();
    }

    // Restore viewport position and zoom level
    if (prevZoom && prevPanX !== undefined && prevPanY !== undefined) {
      camera.zoom = prevZoom;
      camera.panX = prevPanX;
      camera.panY = prevPanY;
      camera.updateZoomHUD();
    }

    camera.requestRender();
  };

  if (btnUndo) {
    btnUndo.addEventListener('click', () => {
      const state = historyManager.undo();
      if (state) applySnapshot(state);
    });
  }
  if (btnRedo) {
    btnRedo.addEventListener('click', () => {
      const state = historyManager.redo();
      if (state) applySnapshot(state);
    });
  }

  // --- Native Device Storage Project File Manager ---
  projectFileManager = new ProjectFileManager({
    multiProjectTabs,
    historyManager,
    virtualRuler,
    camera,
    onProjectLoaded: (data) => {
      applySnapshot(data);
    }
  });
  historyManager.projectFileManager = projectFileManager;
  window.cad.projectFileManager = projectFileManager;

  // Header Open & Save to Disk Buttons
  const btnHeaderOpen = document.getElementById('btn-header-open');
  const btnHeaderSave = document.getElementById('btn-header-save');
  if (btnHeaderOpen) {
    btnHeaderOpen.addEventListener('click', () => {
      projectFileManager.openProject();
    });
  }
  if (btnHeaderSave) {
    btnHeaderSave.addEventListener('click', () => {
      projectFileManager.saveProject(false);
    });
  }

  // --- Settings (⚙️) Popover Dropdown ---
  const btnSettingsTrigger = document.getElementById('btn-settings-trigger');
  const settingsMenu = document.getElementById('settings-dropdown-menu');
  const settingsWrapper = document.getElementById('settings-dropdown-wrapper');
  const toggleAutoSave = document.getElementById('toggle-autosave-setting');
  const storageUsageDisplay = document.getElementById('storage-usage-display');
  const btnClearAutoSave = document.getElementById('btn-clear-autosave-storage');

  if (btnSettingsTrigger && settingsMenu) {
    btnSettingsTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = settingsMenu.classList.toggle('hidden');
      btnSettingsTrigger.classList.toggle('active', !isHidden);
    });

    document.addEventListener('click', (e) => {
      if (settingsWrapper && !settingsWrapper.contains(e.target)) {
        settingsMenu.classList.add('hidden');
        btnSettingsTrigger.classList.remove('active');
      }
    });
  }

  if (toggleAutoSave) {
    toggleAutoSave.checked = historyManager.autoSaveEnabled;
    if (storageUsageDisplay) {
      storageUsageDisplay.textContent = historyManager.autoSaveEnabled
        ? 'Local storage backup: active'
        : 'AutoSave disabled (Manual Save only)';
    }
    toggleAutoSave.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      historyManager.setAutoSaveEnabled(enabled);
      if (storageUsageDisplay) {
        storageUsageDisplay.textContent = enabled
          ? 'Local storage backup: active'
          : 'AutoSave disabled (Manual Save only)';
      }
    });
  }

  if (btnClearAutoSave) {
    btnClearAutoSave.addEventListener('click', () => {
      try {
        if (historyManager?.storageKey) {
          localStorage.removeItem(historyManager.storageKey);
        }
        localStorage.removeItem('sashiko_cad_autosave_v3');
        localStorage.removeItem('sashiko_cad_snapshot_v2');
        if (storageUsageDisplay) {
          storageUsageDisplay.textContent = 'Cached storage cleared';
        }
        alert('Cached browser auto-save cleared successfully.');
      } catch (e) {
        console.warn('Failed to clear storage:', e);
      }
    });
  }

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Quick Command Palette (Ctrl+K or Cmd+K) - works even if target is input
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
      e.preventDefault();
      toggleCommandPalette();
      return;
    }

    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      return;
    }

    // Exit Isolation / Focus Mode on Escape (Illustrator standard)
    if (e.key === 'Escape') {
      if (stitchPen.isolationMode && stitchPen.isolationMode.active) {
        e.preventDefault();
        stitchPen.exitIsolationMode();
        return;
      }
    }

    // Lock / Unlock Shortcuts (Illustrator Standard: Ctrl+2 to Lock, Ctrl+Alt+2 to Unlock All)
    if ((e.ctrlKey || e.metaKey) && (e.key === '2' || e.code === 'Digit2')) {
      e.preventDefault();
      if (e.altKey) {
        stitchPen.unlockAllStitches();
      } else {
        if (layerManager.activeEditingImage) {
          layerManager.lockImage(layerManager.activeEditingImage.id);
        } else if (stitchPen.selectedStitches.size > 0) {
          stitchPen.lockSelectedStitches();
        }
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === "'" || e.code === 'Quote')) {
      e.preventDefault();
      latticeGrid.enabled = !latticeGrid.enabled;
      camera.requestRender();
    } else if ((e.key === 'g' || e.key === 'G' || e.code === 'KeyG') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      latticeGrid.enabled = !latticeGrid.enabled;
      camera.requestRender();
    } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      camera.centerCushion();
    } else if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      resetColorsToDefault(true);
    } else if ((e.key === 'x' || e.key === 'X') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setCanvasColors(opticsEngine.stitchColor, opticsEngine.bgColor, true);
    } else if (e.shiftKey && (e.key === 'r' || e.key === 'R' || e.code === 'KeyR') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      virtualRuler.toggleVisible();
    } else if ((e.key === 'r' || e.key === 'R' || e.code === 'KeyR') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (stitchPen.selectedStitches.size > 0) {
        stitchPen.rotateSelected(90);
      } else {
        virtualRuler.toggleVisible();
      }
    } else if ((e.key === 'n' || e.key === 'N' || e.code === 'KeyN') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      document.getElementById('btn-toggle-minimap')?.click();
    } else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        const state = historyManager.redo();
        if (state) applySnapshot(state);
      } else {
        const state = historyManager.undo();
        if (state) applySnapshot(state);
      }
    } else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      e.stopPropagation();
      const state = historyManager.redo();
      if (state) applySnapshot(state);
    }

    // Boolean Operations Hotkeys (SS 2 standard: Alt+Shift+U / S / I / E / F)
    if (e.altKey && e.shiftKey) {
      if (e.code === 'KeyU' || e.key === 'U' || e.key === 'u') {
        e.preventDefault();
        booleanEngine.union();
      } else if (e.code === 'KeyS' || e.key === 'S' || e.key === 's') {
        e.preventDefault();
        booleanEngine.subtract();
      } else if (e.code === 'KeyI' || e.key === 'I' || e.key === 'i') {
        e.preventDefault();
        booleanEngine.intersect();
      } else if (e.code === 'KeyE' || e.key === 'E' || e.key === 'e') {
        e.preventDefault();
        booleanEngine.exclude();
      } else if (e.code === 'KeyF' || e.key === 'F' || e.key === 'f') {
        e.preventDefault();
        booleanEngine.flatten();
      }
    }

    // Grouping & Ungrouping (Ctrl+G, Ctrl+Shift+G)
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyG' || e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      if (e.shiftKey) {
        booleanEngine.ungroup();
      } else {
        booleanEngine.group();
      }
    }

    // Clipboard Copy & Paste (Ctrl+C, Ctrl+V)
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyC' || e.key === 'c' || e.key === 'C')) {
      if (stitchPen.selectedStitches.size > 0) {
        e.preventDefault();
        booleanEngine.copy();
      }
    } else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyV' || e.key === 'v' || e.key === 'V')) {
      if (booleanEngine.clipboard && booleanEngine.clipboard.length > 0) {
        e.preventDefault();
        booleanEngine.paste();
      }
    }

    // Illustrator & Figma Layer Stacking Shortcuts (Ctrl+], Ctrl+[, Ctrl+Shift+], Ctrl+Shift+[)
    if ((e.ctrlKey || e.metaKey) && (e.key === ']' || e.key === '[')) {
      e.preventDefault();
      const activeId = layerManager.activeEditingImage?.id || layerManager.activeLayerId;
      if (activeId) {
        if (e.key === ']') {
          if (e.shiftKey) {
            layerManager.bringToFront(activeId);
          } else {
            layerManager.bringForward(activeId);
          }
        } else if (e.key === '[') {
          if (e.shiftKey) {
            layerManager.sendToBack(activeId);
          } else {
            layerManager.sendBackward(activeId);
          }
        }
        layerManager.renderLayerListUI(document.getElementById('layers-container-box'), stitchPen.stitches);
      }
    }
  });

  // --- Figma Style Quick Command Palette (Ctrl + K) ---
  const cmdBackdrop = document.getElementById('cmd-palette-backdrop');
  const cmdInput = document.getElementById('cmd-palette-input');
  const cmdResults = document.getElementById('cmd-palette-results');
  let cmdSelectedIndex = 0;
  let filteredCommands = [];

  const COMMANDS = [
    // File & Project Operations (Device Storage & Cloud)
    { id: 'file-open', title: 'Open Project File (.sashiko, .json)', category: 'File & Project', icon: '📂', shortcut: 'Ctrl+O', action: () => projectFileManager?.openProject() },
    { id: 'file-save', title: 'Save Project to Device Storage', category: 'File & Project', icon: '💾', shortcut: 'Ctrl+S', action: () => projectFileManager?.saveProject(false) },
    { id: 'file-save-as', title: 'Save Project As...', category: 'File & Project', icon: '💾', shortcut: 'Ctrl+Shift+S', action: () => projectFileManager?.saveProject(true) },

    // Tools
    { id: 'tool-pen', title: 'Pen Tool', category: 'Tools', icon: '✒️', shortcut: 'P', action: () => document.getElementById('tool-pen')?.click() },
    { id: 'tool-select', title: 'Selection Tool (Marquee & Move)', category: 'Tools', icon: '↖', shortcut: 'V', action: () => document.getElementById('tool-select')?.click() },
    { id: 'tool-direct', title: 'Direct Selection Tool (Node Edit)', category: 'Tools', icon: '↗', shortcut: 'A', action: () => document.getElementById('tool-direct-select')?.click() },
    { id: 'tool-shape', title: 'Bounded Lab / Shape Tool', category: 'Tools', icon: '⬚', shortcut: 'M', action: () => document.getElementById('tool-rect')?.click() },
    { id: 'tool-slicer', title: 'Rotary Knife Slicer Tool', category: 'Tools', icon: '✂', shortcut: 'S', action: () => document.getElementById('tool-slicer')?.click() },
    { id: 'tool-eraser', title: 'Segment Eraser Tool', category: 'Tools', icon: '⌫', shortcut: 'E', action: () => document.getElementById('tool-eraser')?.click() },
    { id: 'tool-img', title: 'Place Reference Image Tracing Layer', category: 'Tools', icon: '🖼', shortcut: 'I', action: () => inputFileImg?.click() },
    { id: 'tool-hand', title: 'Hand / Pan Viewport', category: 'Tools', icon: '✋', shortcut: 'H / Space', action: () => document.getElementById('tool-hand')?.click() },
    { id: 'tool-zoom', title: 'Zoom Viewport', category: 'Tools', icon: '🔍', shortcut: 'Z', action: () => document.getElementById('tool-zoom')?.click() },

    // Curve & Arc Tools (Japanese Sashiko Engine)
    { id: 'tool-arc', title: '3-Point Arc Tool', category: 'Curve & Arc Tools', icon: '⌒', shortcut: 'C', action: () => { curveEngine.setTool('arc'); stitchPen.setTool('idle'); } },
    { id: 'tool-spline', title: 'Smooth Spline Tool (Catmull-Rom)', category: 'Curve & Arc Tools', icon: '∿', shortcut: 'Shift+C', action: () => { curveEngine.setTool('spline'); stitchPen.setTool('idle'); } },
    { id: 'curve-sakura', title: 'Generate 5-Petal Sakura Blossom Motif', category: 'Curve & Arc Tools', icon: '🌸', action: () => {
      const center = curveEngine.getResolvedSymmetryCenter();
      curveEngine.createSakuraBlossom(center, 90);
      camera.requestRender();
    }},
    { id: 'curve-sym-3', title: 'Set Curve Radial Symmetry: 3-Fold (Fans / Mitsu-Ogi)', category: 'Curve & Arc Tools', icon: '🪭', action: () => { curveEngine.setSymmetryOrder(3); } },
    { id: 'curve-sym-4', title: 'Set Curve Radial Symmetry: 4-Fold', category: 'Curve & Arc Tools', icon: '❖', action: () => { curveEngine.setSymmetryOrder(4); } },
    { id: 'curve-sym-5', title: 'Set Curve Radial Symmetry: 5-Fold (Sakura)', category: 'Curve & Arc Tools', icon: '🌸', action: () => { curveEngine.setSymmetryOrder(5); } },
    { id: 'curve-sym-6', title: 'Set Curve Radial Symmetry: 6-Fold (Asanoha)', category: 'Curve & Arc Tools', icon: '✡', action: () => { curveEngine.setSymmetryOrder(6); } },
    { id: 'curve-sym-8', title: 'Set Curve Radial Symmetry: 8-Fold (Kamon)', category: 'Curve & Arc Tools', icon: '☸', action: () => { curveEngine.setSymmetryOrder(8); } },
    { id: 'curve-sym-1', title: 'Set Curve Radial Symmetry: Off (1-Fold)', category: 'Curve & Arc Tools', icon: '1', action: () => { curveEngine.setSymmetryOrder(1); } },

    // Selection & Edit Actions
    { id: 'act-dup', title: 'Duplicate Selected Stitches', category: 'Selection Actions', icon: '⎘', shortcut: 'Ctrl+D', action: () => stitchPen.duplicateSelected() },
    { id: 'act-rot90', title: 'Rotate Selection 90°', category: 'Selection Actions', icon: '↻', shortcut: 'R', action: () => stitchPen.rotateSelected(90) },
    { id: 'act-rot45', title: 'Rotate Selection 45°', category: 'Selection Actions', icon: '↻', action: () => stitchPen.rotateSelected(45) },
    { id: 'act-rot180', title: 'Rotate Selection 180°', category: 'Selection Actions', icon: '↻', action: () => stitchPen.rotateSelected(180) },
    { id: 'act-rot360', title: 'Rotate Selection 360°', category: 'Selection Actions', icon: '↻', action: () => stitchPen.rotateSelected(360) },
    { id: 'act-mir', title: 'Mirror Selection Horizontally', category: 'Selection Actions', icon: '⇄', shortcut: 'O', action: () => stitchPen.mirrorSelected() },
    { id: 'act-del', title: 'Delete Selected Items', category: 'Selection Actions', icon: '🗑', shortcut: 'Del', action: () => stitchPen.deleteSelected() },
    { id: 'act-copy', title: 'Copy Selection to Clipboard', category: 'Selection Actions', icon: '📋', shortcut: 'Ctrl+C', action: () => booleanEngine.copy() },
    { id: 'act-paste', title: 'Paste from Clipboard', category: 'Selection Actions', icon: '📄', shortcut: 'Ctrl+V', action: () => booleanEngine.paste() },
    { id: 'act-group', title: 'Group Selected Stitches', category: 'Selection Actions', icon: '⛶', shortcut: 'Ctrl+G', action: () => booleanEngine.group() },
    { id: 'act-ungroup', title: 'Ungroup Selected Group', category: 'Selection Actions', icon: '◻', shortcut: 'Ctrl+Shift+G', action: () => booleanEngine.ungroup() },
    { id: 'act-conv-lab', title: 'Convert Selection to Bounded Lab', category: 'Selection Actions', icon: '✨', action: () => document.getElementById('btn-sel-convert-lab')?.click() },

    // Boolean Operations
    { id: 'bool-union', title: 'Boolean Union (Alt+Shift+U)', category: 'Boolean Operations', icon: '⊞', shortcut: 'Alt+Shift+U', action: () => booleanEngine.union() },
    { id: 'bool-sub', title: 'Boolean Subtract (Alt+Shift+S)', category: 'Boolean Operations', icon: '⊟', shortcut: 'Alt+Shift+S', action: () => booleanEngine.subtract() },
    { id: 'bool-int', title: 'Boolean Intersect (Alt+Shift+I)', category: 'Boolean Operations', icon: '⊡', shortcut: 'Alt+Shift+I', action: () => booleanEngine.intersect() },
    { id: 'bool-exc', title: 'Boolean Exclude (Alt+Shift+E)', category: 'Boolean Operations', icon: '⌧', shortcut: 'Alt+Shift+E', action: () => booleanEngine.exclude() },
    { id: 'bool-flat', title: 'Boolean Flatten (Alt+Shift+F)', category: 'Boolean Operations', icon: '≡', shortcut: 'Alt+Shift+F', action: () => booleanEngine.flatten() },

    // Canvas Sizes
    { id: 'size-18', title: 'Canvas Size: 18" × 18" Cushion Standard', category: 'Canvas Size', icon: '📐', action: () => applyCanvasSize(18, 18, '18" × 18"') },
    { id: 'size-20', title: 'Canvas Size: 20" × 20" Cushion Large', category: 'Canvas Size', icon: '📐', action: () => applyCanvasSize(20, 20, '20" × 20"') },
    { id: 'size-16', title: 'Canvas Size: 16" × 16" Cushion Compact', category: 'Canvas Size', icon: '📐', action: () => applyCanvasSize(16, 16, '16" × 16"') },
    { id: 'size-1620', title: 'Canvas Size: 16" × 20" Pillow Lumbar', category: 'Canvas Size', icon: '📐', action: () => applyCanvasSize(16, 20, '16" × 20"') },
    { id: 'size-free', title: 'Canvas Size: Free Canvas (Infinite)', category: 'Canvas Size', icon: '♾', action: () => applyCanvasSize(null, null, 'Free Canvas') },

    // View & Optics
    { id: 'view-fit', title: 'Fit Artboard to Screen', category: 'View & Optics', icon: '⛶', shortcut: 'Ctrl+0', action: () => camera.centerCushion() },
    { id: 'view-grid-main', title: 'Toggle Main Grid (Tier 1)', category: 'View & Optics', icon: '▦', action: () => document.getElementById('btn-toggle-main-grid')?.click() },
    { id: 'view-grid-sub', title: 'Toggle Sub-Grid (Tier 2)', category: 'View & Optics', icon: '▤', action: () => document.getElementById('btn-toggle-sub-grid')?.click() },
    { id: 'view-grid-micro', title: 'Toggle Micro-Grid (Tier 3)', category: 'View & Optics', icon: '░', action: () => document.getElementById('btn-toggle-micro-grid')?.click() },
    { id: 'view-grid-all', title: 'Toggle Master Grid On/Off', category: 'View & Optics', icon: '⊞', shortcut: "G or Ctrl+'", action: () => { latticeGrid.enabled = !latticeGrid.enabled; camera.requestRender(); } },
    { id: 'view-dots', title: 'Toggle Anchor Dots', category: 'View & Optics', icon: '●', action: () => { latticeGrid.showDots = !latticeGrid.showDots; camera.requestRender(); } },
    { id: 'view-lightbox', title: 'Enter Fullscreen Tracing Lightbox', category: 'View & Optics', icon: '💡', action: () => artLabManager.enterLightbox() },
    { id: 'view-minimap', title: 'Toggle Navigator Minimap', category: 'View & Optics', icon: '🗺', shortcut: 'N', action: () => document.getElementById('btn-toggle-minimap')?.click() },
    { id: 'view-colors-def', title: 'Reset Canvas Colors to Default', category: 'View & Optics', icon: '🎨', shortcut: 'D', action: () => resetColorsToDefault(true) },
    { id: 'view-colors-inv', title: 'Swap Stroke & Background Colors', category: 'View & Optics', icon: '⇄', shortcut: 'X', action: () => setCanvasColors(opticsEngine.stitchColor, opticsEngine.bgColor, true) },

    // Art Lab & Physical Tracing
    { id: 'artlab-open', title: 'Open Art Lab (Screen Tracing & Calibration)', category: 'Art Lab', icon: '🔬', action: () => document.querySelector('.insp-tab[data-tab="artlab"]')?.click() },
    { id: 'artlab-lock-scale', title: 'Lock 1:1 Real Physical Scale', category: 'Art Lab', icon: '🔒', action: () => artLabManager.lockRealScale() },
    { id: 'artlab-q1', title: 'Trace Quadrant 1 (Top-Left)', category: 'Art Lab', icon: '↖', action: () => artLabManager.focusQuadrant(1) },
    { id: 'artlab-q2', title: 'Trace Quadrant 2 (Top-Right)', category: 'Art Lab', icon: '↗', action: () => artLabManager.focusQuadrant(2) },
    { id: 'artlab-q3', title: 'Trace Quadrant 3 (Bottom-Left)', category: 'Art Lab', icon: '↙', action: () => artLabManager.focusQuadrant(3) },
    { id: 'artlab-q4', title: 'Trace Quadrant 4 (Bottom-Right)', category: 'Art Lab', icon: '↘', action: () => artLabManager.focusQuadrant(4) },
    { id: 'artlab-fabric-indigo', title: 'Fabric Optics: Indigo Denim (Neon Punch)', category: 'Art Lab', icon: '⚫', action: () => artLabManager.applyFabricPreset('indigo') },
    { id: 'artlab-fabric-light', title: 'Fabric Optics: Raw/White Cotton', category: 'Art Lab', icon: '⚪', action: () => artLabManager.applyFabricPreset('light') },

    // Virtual Artisan Ruler Commands
    { id: 'ruler-toggle', title: 'Toggle Virtual Artisan Ruler (cm/inch & 360° Protractor)', category: 'Art Lab', icon: '📐', shortcut: 'R', action: () => virtualRuler.toggleVisible() },
    { id: 'ruler-mode-screen', title: 'Ruler Mode: Screen Floating (Fixed Physical Display)', category: 'Art Lab', icon: '🖥', action: () => virtualRuler.setMode('screen') },
    { id: 'ruler-mode-world', title: 'Ruler Mode: Locked to Artboard (Zooms with CAD)', category: 'Art Lab', icon: '🔒', action: () => virtualRuler.setMode('world') },
    { id: 'ruler-nudge-plus', title: 'Pinpoint Zoom Micro-Nudge (+0.2%)', category: 'Art Lab', icon: '▲', action: () => virtualRuler.nudgeZoom(0.2) },
    { id: 'ruler-nudge-minus', title: 'Pinpoint Zoom Micro-Nudge (-0.2%)', category: 'Art Lab', icon: '▼', action: () => virtualRuler.nudgeZoom(-0.2) }
  ];

  function openCommandPalette() {
    if (!cmdBackdrop) return;
    cmdBackdrop.classList.remove('hidden');
    if (cmdInput) {
      cmdInput.value = '';
      cmdSelectedIndex = 0;
      renderCommandPaletteResults('');
      setTimeout(() => cmdInput.focus(), 50);
    }
  }

  function closeCommandPalette() {
    if (!cmdBackdrop) return;
    cmdBackdrop.classList.add('hidden');
    if (cmdInput) cmdInput.value = '';
  }

  function toggleCommandPalette() {
    if (!cmdBackdrop) return;
    if (cmdBackdrop.classList.contains('hidden')) {
      openCommandPalette();
    } else {
      closeCommandPalette();
    }
  }

  function renderCommandPaletteResults(query) {
    if (!cmdResults) return;
    const q = (query || '').toLowerCase().trim();
    filteredCommands = COMMANDS.filter(c => {
      if (!q) return true;
      return c.title.toLowerCase().includes(q) ||
             c.category.toLowerCase().includes(q) ||
             (c.shortcut && c.shortcut.toLowerCase().includes(q));
    });

    if (cmdSelectedIndex >= filteredCommands.length) {
      cmdSelectedIndex = Math.max(0, filteredCommands.length - 1);
    }

    if (filteredCommands.length === 0) {
      cmdResults.innerHTML = '<div class="cmd-palette-empty">No commands match your search.</div>';
      return;
    }

    let html = '';
    let currentCat = '';
    for (let i = 0; i < filteredCommands.length; i++) {
      const item = filteredCommands[i];
      if (item.category !== currentCat) {
        currentCat = item.category;
        html += `<div class="cmd-palette-category">${currentCat}</div>`;
      }
      const isSel = (i === cmdSelectedIndex);
      html += `
        <div class="cmd-palette-item ${isSel ? 'selected' : ''}" data-index="${i}">
          <div class="cmd-item-left">
            <span class="cmd-item-icon">${item.icon}</span>
            <span class="cmd-item-title">${item.title}</span>
          </div>
          ${item.shortcut ? `<span class="cmd-item-shortcut">${item.shortcut}</span>` : ''}
        </div>
      `;
    }
    cmdResults.innerHTML = html;

    cmdResults.querySelectorAll('.cmd-palette-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index, 10);
        executeCommand(idx);
      });
    });

    const selEl = cmdResults.querySelector('.cmd-palette-item.selected');
    if (selEl) {
      selEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function executeCommand(index) {
    const cmd = filteredCommands[index];
    if (cmd && typeof cmd.action === 'function') {
      closeCommandPalette();
      cmd.action();
    }
  }

  if (cmdInput) {
    cmdInput.addEventListener('input', (e) => {
      cmdSelectedIndex = 0;
      renderCommandPaletteResults(e.target.value);
    });

    cmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filteredCommands.length > 0) {
          cmdSelectedIndex = (cmdSelectedIndex + 1) % filteredCommands.length;
          renderCommandPaletteResults(cmdInput.value);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filteredCommands.length > 0) {
          cmdSelectedIndex = (cmdSelectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
          renderCommandPaletteResults(cmdInput.value);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeCommand(cmdSelectedIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandPalette();
      }
    });
  }

  if (cmdBackdrop) {
    cmdBackdrop.addEventListener('click', (e) => {
      if (e.target === cmdBackdrop) {
        closeCommandPalette();
      }
    });
  }

  // 9. Initial State Setup: Standard 18" × 18" Cushion & 3x3 Master Blocks (Auto-Centered on Infinite Grid)
  camera.setCustomArtboard(18, 18, '18" × 18"');
  subLabManager.initNineSquareBlocks();
  subLabManager.activePartitionId = 'B2';
  subLabManager.isGreenSubLabActive = false; // Sub-Lab OFF by default (clean blank canvas)
  subLabManager.renderPartitionListUI();

  // Clean blank canvas: No starter demo motif by default
  stitchPen.stitches = new Map();
  const activeTab = multiProjectTabs.getActiveTab();
  if (activeTab) {
    activeTab.artboardPreset = '18x18';
    activeTab.title = 'Untitled-1 @ 50% (18" × 18")';
    activeTab.partitions = JSON.parse(JSON.stringify(partitionEngine.partitions));
    activeTab.activePartitionId = 'B2';
    activeTab.stitches = new Map();
    multiProjectTabs.renderTabsUI();
  }

  // Click on the canvas artboard badge to open the Size Selection dropdown directly
  camera.onWorkAreaBadgeClicked = () => {
    btnSizeTrigger?.click();
  };

  initCollapsibleSections();
  updateArtboardHUD();
  syncUnitSlider();
  updateGridUI();
  blueprintSpecs.updateMetrics();
  layerManager.renderLayerListUI(document.getElementById('layers-container-box'), stitchPen.stitches);
  const savedState = historyManager.loadAutoSave();
  if (savedState) {
    applySnapshot(savedState);
  } else {
    historyManager.pushState(multiProjectTabs.serializeAll());
  }
  camera.centerCushion();

  // Visual Verification URL Query Overrides
  if (window.location.search.includes('menu=open')) {
    document.getElementById('canvas-size-menu')?.classList.remove('hidden');
    document.getElementById('btn-size-dropdown-trigger')?.classList.add('active');
  }
  if (window.location.search.includes('size=16x20')) {
    applyCanvasSize(16, 20, '16" × 20"');
  }
  if (window.location.search.includes('customlab=true')) {
    stitchPen.onCustomLabCreated?.({ minX: 160, minY: 160, w: 320, h: 320 });
  }
  if (window.location.search.includes('tab=shapes')) {
    document.querySelector('.insp-tab[data-tab="shapes"]')?.click();
  }
  if (window.location.search.includes('tab=artlab')) {
    document.querySelector('.insp-tab[data-tab="artlab"]')?.click();
  }
  if (window.location.search.includes('test=ruler')) {
    virtualRuler.setVisible(true);
    if (window.location.search.includes('ruler=world')) {
      virtualRuler.setMode('world');
    }
  }
  if (window.location.search.includes('test=lightbox')) {
    artLabManager.enterLightbox();
  }
  if (window.location.search.includes('tab=layers')) {
    document.querySelector('.insp-tab[data-tab="layers"]')?.click();
  }
  if (window.location.search.includes('tab=blueprint') || window.location.search.includes('tab=specs')) {
    document.querySelector('.insp-tab[data-tab="blueprint"]')?.click();
  }
  if (window.location.search.includes('collapse=doc')) {
    document.getElementById('header-doc-setup')?.click();
  }
  if (window.location.search.includes('collapse=all')) {
    document.getElementById('header-doc-setup')?.click();
    document.getElementById('header-grid-setup')?.click();
  }
  if (window.location.search.includes('expand=micro')) {
    document.getElementById('trigger-microgrid')?.click();
  }
  if (window.location.search.includes('unit=cm')) {
    btnUnitCm?.click();
  }
  if (window.location.search.includes('test=hover')) {
    const nodeA = { i: 6, j: 6, x: 6 * latticeGrid.getStepPx(), y: 6 * latticeGrid.getStepPx() };
    const nodeB = { i: 12, j: 12, x: 12 * latticeGrid.getStepPx(), y: 12 * latticeGrid.getStepPx() };
    stitchPen.commitEdge(nodeA, nodeB, true);
    stitchPen.hoveredStitchKey = '6,6--12,12';
    camera.requestRender();
  }
  if (window.location.search.includes('test=image')) {
    const testCanvas = document.createElement('canvas');
    testCanvas.width = 300;
    testCanvas.height = 300;
    const tCtx = testCanvas.getContext('2d');
    tCtx.fillStyle = '#0284c7';
    tCtx.fillRect(0, 0, 300, 300);
    tCtx.strokeStyle = '#ffffff';
    tCtx.lineWidth = 4;
    tCtx.strokeRect(20, 20, 260, 260);
    tCtx.beginPath();
    tCtx.arc(150, 150, 80, 0, Math.PI * 2);
    tCtx.stroke();
    const dataUrl = testCanvas.toDataURL();
    const imgEl = new Image();
    imgEl.onload = () => {
      const newLayer = layerManager.addImageLayer('Geometric Cushion Blueprint.jpg', imgEl, dataUrl, camera);
      if (window.location.search.includes('test=sendbg')) {
        layerManager.sendImageToBackground(newLayer.id);
      }
      if (window.location.search.includes('test=ctxmenu')) {
        const menuEl = document.getElementById('image-context-menu');
        if (menuEl) {
          menuEl.style.left = '450px';
          menuEl.style.top = '220px';
          menuEl.classList.remove('hidden');
        }
      }
      layerManager.renderLayerListUI(document.getElementById('layers-container-box'), stitchPen.stitches);
      document.querySelector('.insp-tab[data-tab="layers"]')?.click();
      camera.requestRender();
    };
    imgEl.src = dataUrl;
  }
  if (window.location.search.includes('test=reanchor')) {
    const center = { i: 9, j: 9, x: 9 * latticeGrid.getStepPx(), y: 9 * latticeGrid.getStepPx() };
    const targets = [
      { i: 9, j: 13 }, { i: 13, j: 9 }, { i: 13, j: 13 },
      { i: 5, j: 9 },  { i: 9, j: 5 },  { i: 5, j: 5 },
      { i: 5, j: 13 }, { i: 13, j: 5 }
    ];
    targets.forEach(t => {
      const node = { i: t.i, j: t.j, x: t.i * latticeGrid.getStepPx(), y: t.j * latticeGrid.getStepPx() };
      stitchPen.commitEdge(center, node, false);
    });
    stitchPen.notifyChange();
    camera.requestRender();
  }
  if (window.location.search.includes('test=ghost')) {
    stitchPen.chainAnchor = { i: 6, j: 6, x: 6 * latticeGrid.getStepPx(), y: 6 * latticeGrid.getStepPx() };
    const p2Node = { i: 10, j: 10, x: 10 * latticeGrid.getStepPx(), y: 10 * latticeGrid.getStepPx(), isCorner: true };
    latticeGrid.hoverNode = p2Node;
    latticeGrid.ghostEdge = {
      u: [6, 6],
      v: [10, 10],
      color: '#0D99FF',
      lengthMm: 143.5,
      angleDeg: 45
    };
    camera.requestRender();
  }
  if (window.location.search.includes('testpatch=1')) {
    document.querySelector('.insp-tab[data-tab="shapes"]')?.click();
    const parts = partitionEngine.partitions;
    if (parts.length >= 9) {
      parts[0].fabricColor = '#1E293B'; // A1 Navy
      parts[2].fabricColor = '#1E293B'; // A3 Navy
      parts[6].fabricColor = '#1E293B'; // C1 Navy
      parts[8].fabricColor = '#1E293B'; // C3 Navy
      parts[1].fabricColor = '#B45309'; // A2 Ochre
      parts[3].fabricColor = '#B45309'; // B1 Ochre
      parts[5].fabricColor = '#B45309'; // B3 Ochre
      parts[7].fabricColor = '#B45309'; // C2 Ochre
      parts[4].fabricColor = '#9A3412'; // B2 Center Terracotta
      subLabManager.activePartitionId = 'B2';
      subLabManager.pasteSelectedPatternToActiveShape();
      subLabManager.renderPartitionListUI();
      camera.requestRender();
    }
  }
  if (window.location.search.includes('test=guides')) {
    const step = latticeGrid.getStepPx();
    const nA = { i: 6, j: 6, x: 6 * step, y: 6 * step };
    const nB = { i: 6, j: 12, x: 6 * step, y: 12 * step };
    stitchPen.commitEdge(nA, nB, false);
    const nC = { i: 14, j: 12, x: 14 * step, y: 12 * step };
    stitchPen.commitEdge(nB, nC, false);
    // Align test cursor horizontally with nA and vertically with nC
    const snapPt = { i: 14, j: 6, x: 14 * step, y: 6 * step };
    latticeGrid.hoverNode = snapPt;
    smartGuides.computeGuides(snapPt);
    camera.requestRender();
  }
  if (window.location.search.includes('test=multisel')) {
    const step = latticeGrid.getStepPx();
    const nA = { i: 6, j: 6, x: 6 * step, y: 6 * step };
    const nB = { i: 6, j: 10, x: 6 * step, y: 10 * step };
    const nC = { i: 10, j: 6, x: 10 * step, y: 6 * step };
    const nD = { i: 10, j: 10, x: 10 * step, y: 10 * step };
    stitchPen.commitEdge(nA, nB, false);
    stitchPen.commitEdge(nC, nD, false);
    stitchPen.selectedStitches.add('6,6--6,10');
    stitchPen.selectedStitches.add('10,6--10,10');
    stitchPen.notifySelection();
    camera.requestRender();
  }
  if (window.location.search.includes('test=customlab')) {
    const step = latticeGrid.getStepPx();
    const p1 = { i: 8, j: 4, x: 8 * step, y: 4 * step };
    const p2 = { i: 14, j: 10, x: 14 * step, y: 10 * step };
    const p3 = { i: 8, j: 16, x: 8 * step, y: 16 * step };
    const p4 = { i: 2, j: 10, x: 2 * step, y: 10 * step };
    stitchPen.commitEdge(p1, p2, false);
    stitchPen.commitEdge(p2, p3, false);
    stitchPen.commitEdge(p3, p4, false);
    stitchPen.commitEdge(p4, p1, false);

    const keys = new Set(['8,4--14,10', '14,10--8,16', '8,16--2,10', '2,10--8,4']);
    stitchPen.selectedStitches = keys;
    subLabManager.createLabFromStitches(keys, stitchPen.stitches, latticeGrid);

    // Draw some inner sashiko stitches inside this bounded lab
    const in1 = { i: 8, j: 7, x: 8 * step, y: 7 * step };
    const in2 = { i: 8, j: 13, x: 8 * step, y: 13 * step };
    const in3 = { i: 5, j: 10, x: 5 * step, y: 10 * step };
    const in4 = { i: 11, j: 10, x: 11 * step, y: 10 * step };
    stitchPen.commitEdge(in1, in2, false);
    stitchPen.commitEdge(in3, in4, false);

    document.querySelector('.insp-tab[data-tab="shapes"]')?.click();
    camera.requestRender();
  }
  if (window.location.search.includes('test=contextmenu')) {
    const step = latticeGrid.getStepPx();
    const p1 = { i: 8, j: 4, x: 8 * step, y: 4 * step };
    const p2 = { i: 14, j: 10, x: 14 * step, y: 10 * step };
    const p3 = { i: 8, j: 16, x: 8 * step, y: 16 * step };
    const p4 = { i: 2, j: 10, x: 2 * step, y: 10 * step };
    stitchPen.commitEdge(p1, p2, false);
    stitchPen.commitEdge(p2, p3, false);
    stitchPen.commitEdge(p3, p4, false);
    stitchPen.commitEdge(p4, p1, false);

    const keys = new Set(['8,4--14,10', '14,10--8,16', '8,16--2,10', '2,10--8,4']);
    stitchPen.selectedStitches = keys;
    stitchPen.notifySelection();

    // Trigger context menu open
    stitchPen.onContextMenuRequested({ clientX: 420, clientY: 220 }, { x: 8 * step, y: 10 * step });
    camera.requestRender();
  }

  if (window.location.search.includes('test=cmdpalette')) {
    openCommandPalette();
    cmdInput.value = 'Grid';
    renderCommandPaletteResults('Grid');
  }

  if (window.location.search.includes('test=selectionhud')) {
    const step = latticeGrid.getStepPx();
    const p1 = { i: 8, j: 6, x: 8 * step, y: 6 * step };
    const p2 = { i: 14, j: 6, x: 14 * step, y: 6 * step };
    const p3 = { i: 14, j: 12, x: 14 * step, y: 12 * step };
    const p4 = { i: 8, j: 12, x: 8 * step, y: 12 * step };
    stitchPen.commitEdge(p1, p2, false);
    stitchPen.commitEdge(p2, p3, false);
    stitchPen.commitEdge(p3, p4, false);
    stitchPen.commitEdge(p4, p1, false);

    const keys = new Set(['8,6--14,6', '14,6--14,12', '8,12--14,12', '8,6--8,12']);
    stitchPen.selectedStitches = keys;
    stitchPen.setTool('select');
    stitchPen.notifySelection();
    camera.requestRender();
  }
});
