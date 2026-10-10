/**
 * Sashiko Studio CAD - Adobe Illustrator Style Layer Management Engine
 * Manages layer hierarchy, visibility eye toggles, lock states,
 * active drawing target, and per-layer stitch filtering.
 */

export class LayerManager {
  constructor(options = {}) {
    this.onLayersChanged = options.onLayersChanged || null;
    this.onActiveLayerChanged = options.onActiveLayerChanged || null;

    // Palette colors for layer identification tags
    this.layerColors = [
      '#00FF7F', // Emerald Green (Main)
      '#38BDF8', // Cyan (Grid)
      '#F59E0B', // Amber (Border)
      '#D946EF', // Magenta (Notes)
      '#EC4899', // Pink
      '#8B5CF6', // Purple
      '#10B981', // Mint
      '#F97316'  // Orange
    ];

    // Default 4 standard layers
    this.layers = [
      {
        id: 'layer_grid',
        name: 'Base Grid & Stencil',
        visible: true,
        locked: false,
        color: '#38BDF8',
        type: 'system_grid',
        removable: false
      },
      {
        id: 'layer_main',
        name: 'Main Motif',
        visible: true,
        locked: false,
        color: '#00FF7F',
        type: 'stitches',
        removable: false
      },
      {
        id: 'layer_border',
        name: 'Border Patterns',
        visible: true,
        locked: false,
        color: '#F59E0B',
        type: 'stitches',
        removable: true
      },
      {
        id: 'layer_notes',
        name: 'Artisan Notes',
        visible: true,
        locked: false,
        color: '#D946EF',
        type: 'notes',
        removable: true
      }
    ];

    this.activeLayerId = 'layer_main';
    this.camera = null;
    this.canvas = null;
    this.activeEditingImage = null;
    this.transformDrag = null;
    this.contextMenuTargetImage = null;
    this.floatingBtnBounds = null;
    this.imageCache = new Map();
    this.historyManager = options.historyManager || null;
    this.multiProjectTabs = options.multiProjectTabs || null;
    this.onHistoryPush = options.onHistoryPush || null;

    if (typeof window !== 'undefined') {
      setTimeout(() => this.initContextMenu(), 50);
    }
  }

  notifyHistoryPush() {
    if (typeof this.onHistoryPush === 'function') {
      this.onHistoryPush();
    } else if (this.multiProjectTabs && this.historyManager) {
      const active = this.multiProjectTabs.getActiveTab();
      if (active) {
        active.layers = this.serialize();
      }
      this.historyManager.pushState(this.multiProjectTabs.serializeAll());
    }
  }

  get activeLayer() {
    return this.getLayer(this.activeLayerId) || this.layers[1] || this.layers[0];
  }

  getLayer(layerId) {
    return this.layers.find(l => l.id === layerId) || null;
  }

  isLayerVisible(layerId) {
    if (!layerId) return true;
    const l = this.getLayer(layerId);
    return l ? l.visible : true;
  }

  isLayerLocked(layerId) {
    if (!layerId) return false;
    const l = this.getLayer(layerId);
    return l ? l.locked : false;
  }

  setActiveLayer(layerId) {
    const l = this.getLayer(layerId);
    if (!l) return;
    this.activeLayerId = layerId;
    this.notifyChange();
    if (typeof this.onActiveLayerChanged === 'function') {
      this.onActiveLayerChanged(l);
    }
  }

  toggleVisibility(layerId) {
    const l = this.getLayer(layerId);
    if (!l) return;
    l.visible = !l.visible;
    this.notifyChange();
    this.notifyHistoryPush();
  }

  toggleLock(layerId) {
    const l = this.getLayer(layerId);
    if (!l) return;
    l.locked = !l.locked;
    if (l.locked && this.activeEditingImage?.id === layerId) {
      this.activeEditingImage = null;
    } else if (!l.locked && l.type === 'image') {
      this.activeEditingImage = l;
      this.activeLayerId = layerId;
    }
    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
  }

  addLayer(name = null) {
    const count = this.layers.length + 1;
    const id = `layer_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const color = this.layerColors[(this.layers.length) % this.layerColors.length];

    const newLayer = {
      id,
      name: name || `Layer ${count}`,
      visible: true,
      locked: false,
      color,
      type: 'stitches',
      removable: true
    };

    // Insert directly above active layer or at top
    const activeIdx = this.layers.findIndex(l => l.id === this.activeLayerId);
    if (activeIdx !== -1) {
      this.layers.splice(activeIdx + 1, 0, newLayer);
    } else {
      this.layers.push(newLayer);
    }

    this.activeLayerId = id;
    this.notifyChange();
    this.notifyHistoryPush();
    return newLayer;
  }

  /**
   * Inserts a Reference Image into Active Placement Mode (100% opacity, 8 transform handles, resize guides).
   * It remains editable until user right-clicks -> 'Send to Background' (which auto-sets 60% opacity and locks it).
   */
  addImageLayer(name, imageElement, srcDataUrl, camera) {
    const count = this.layers.filter(l => l.type === 'image').length + 1;
    const id = `layer_img_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const color = '#EC4899'; // Distinct pink/magenta for template layers

    const artW = camera?.artboardWidthPx || 1728;
    const artH = camera?.artboardHeightPx || 1728;
    const natW = imageElement.naturalWidth || 800;
    const natH = imageElement.naturalHeight || 800;
    const aspect = natW / Math.max(1, natH);

    let targetW = artW * 0.75;
    let targetH = targetW / aspect;
    if (targetH > artH * 0.75) {
      targetH = artH * 0.75;
      targetW = targetH * aspect;
    }

    const x = (artW - targetW) / 2;
    const y = (artH - targetH) / 2;

    const newLayer = {
      id,
      name: name || `Reference ${count}`,
      type: 'image',
      src: srcDataUrl,
      imgEl: imageElement,
      x,
      y,
      width: targetW,
      height: targetH,
      aspectRatio: aspect,
      opacity: 0.60,         // Standard 60% template opacity by default for tracing
      blendMode: 'source-over', // 'source-over' (Normal) | 'multiply' (Blueprint Darken)
      isBackground: false,
      locked: false,
      visible: true,
      removable: true,
      color
    };

    // Insert new image layer above any existing image layers (and above grid, below stitches)
    const gridIdx = this.layers.findIndex(l => l.id === 'layer_grid');
    let insertIdx = gridIdx;
    for (let i = gridIdx + 1; i < this.layers.length; i++) {
      if (this.layers[i].type === 'image') {
        insertIdx = i;
      } else {
        break;
      }
    }
    if (insertIdx !== -1) {
      this.layers.splice(insertIdx + 1, 0, newLayer);
    } else {
      this.layers.push(newLayer);
    }

    this.activeLayerId = id;
    this.activeEditingImage = newLayer;
    if (srcDataUrl && imageElement) {
      this.imageCache.set(srcDataUrl, imageElement);
    }
    this.notifyChange();
    this.notifyHistoryPush();
    return newLayer;
  }

  lockImage(layerId) {
    const l = this.getLayer(layerId);
    if (!l) return;
    l.locked = true;
    if (this.activeEditingImage?.id === layerId) {
      this.activeEditingImage = null;
    }
    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
  }

  unlockImage(layerId) {
    const l = this.getLayer(layerId);
    if (!l) return;
    l.locked = false;
    this.activeLayerId = layerId;
    this.activeEditingImage = l;
    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
  }

  toggleImageLock(layerId) {
    const l = this.getLayer(layerId);
    if (!l) return;
    if (l.locked) this.unlockImage(layerId);
    else this.lockImage(layerId);
  }

  sendImageToBackground(layerId) {
    this.lockImage(layerId);
  }

  setImageBlendMode(layerId, blendMode) {
    const l = this.getLayer(layerId);
    if (!l) return;
    l.blendMode = blendMode;
    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
  }

  makeImageSquare(layerId) {
    const l = this.getLayer(layerId);
    if (!l) return;
    const sz = Math.min(l.width, l.height);
    l.x = l.x + (l.width - sz) / 2;
    l.y = l.y + (l.height - sz) / 2;
    l.width = sz;
    l.height = sz;
    l.aspectRatio = 1.0;
    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
  }

  fitImageToCushion(layerId) {
    const l = this.getLayer(layerId);
    if (!l) return;
    const artW = this.camera?.artboardWidthPx || 1728;
    const artH = this.camera?.artboardHeightPx || 1728;
    l.x = 0;
    l.y = 0;
    l.width = artW;
    l.height = artH;
    l.aspectRatio = artW / artH;
    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
  }

  initContextMenu() {
    const menuEl = document.getElementById('image-context-menu');
    const btnLockToggle = document.getElementById('ctx-image-lock-toggle');
    const btnBlendToggle = document.getElementById('ctx-toggle-blend');
    const btnBringFront = document.getElementById('ctx-bring-front');
    const btnBringForward = document.getElementById('ctx-bring-forward');
    const btnSendBackward = document.getElementById('ctx-send-backward');
    const btnSendBack = document.getElementById('ctx-send-back');
    const btnSquare = document.getElementById('ctx-square-fit');
    const btnCushion = document.getElementById('ctx-cushion-fit');
    const btnDelete = document.getElementById('ctx-delete-image');

    btnLockToggle?.addEventListener('click', () => {
      if (this.contextMenuTargetImage) {
        this.toggleImageLock(this.contextMenuTargetImage.id);
      }
      this.hideContextMenu();
    });

    btnBlendToggle?.addEventListener('click', () => {
      if (this.contextMenuTargetImage) {
        const nextMode = this.contextMenuTargetImage.blendMode === 'multiply' ? 'source-over' : 'multiply';
        this.setImageBlendMode(this.contextMenuTargetImage.id, nextMode);
      }
      this.hideContextMenu();
    });

    btnBringFront?.addEventListener('click', () => {
      if (this.contextMenuTargetImage) {
        this.bringToFront(this.contextMenuTargetImage.id);
      }
      this.hideContextMenu();
    });

    btnBringForward?.addEventListener('click', () => {
      if (this.contextMenuTargetImage) {
        this.bringForward(this.contextMenuTargetImage.id);
      }
      this.hideContextMenu();
    });

    btnSendBackward?.addEventListener('click', () => {
      if (this.contextMenuTargetImage) {
        this.sendBackward(this.contextMenuTargetImage.id);
      }
      this.hideContextMenu();
    });

    btnSendBack?.addEventListener('click', () => {
      if (this.contextMenuTargetImage) {
        this.sendToBack(this.contextMenuTargetImage.id);
      }
      this.hideContextMenu();
    });

    btnSquare?.addEventListener('click', () => {
      if (this.contextMenuTargetImage) {
        this.makeImageSquare(this.contextMenuTargetImage.id);
      }
      this.hideContextMenu();
    });

    btnCushion?.addEventListener('click', () => {
      if (this.contextMenuTargetImage) {
        this.fitImageToCushion(this.contextMenuTargetImage.id);
      }
      this.hideContextMenu();
    });

    btnDelete?.addEventListener('click', () => {
      if (this.contextMenuTargetImage) {
        this.deleteLayer(this.contextMenuTargetImage.id);
      }
      this.hideContextMenu();
    });

    window.addEventListener('click', (e) => {
      if (!e.target.closest('#image-context-menu')) {
        this.hideContextMenu();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideContextMenu();
      }
    });
  }

  hideContextMenu() {
    const menuEl = document.getElementById('image-context-menu');
    if (menuEl) {
      menuEl.classList.add('hidden');
    }
  }

  handleContextMenu(e, worldPt) {
    // Check if right click hits an editable image or template image
    const hitImg = this.activeEditingImage || this.findImageAtPoint(worldPt);
    if (hitImg) {
      this.contextMenuTargetImage = hitImg;
      const menuEl = document.getElementById('image-context-menu');
      const lockLabel = document.getElementById('ctx-image-lock-label');
      const blendLabel = document.getElementById('ctx-image-blend-label');

      if (lockLabel) {
        lockLabel.textContent = hitImg.locked ? '🔓 Unlock & Edit Image' : '🔒 Lock Image';
      }
      if (blendLabel) {
        blendLabel.textContent = hitImg.blendMode === 'multiply' ? 'Blend Mode: Normal' : 'Blueprint Blend: Multiply ⚡';
      }

      if (menuEl) {
        menuEl.style.left = `${Math.min(window.innerWidth - 240, e.clientX + 4)}px`;
        menuEl.style.top = `${Math.min(window.innerHeight - 240, e.clientY + 4)}px`;
        menuEl.classList.remove('hidden');
      }
      return true;
    }
    this.hideContextMenu();
    return false;
  }

  findImageAtPoint(worldPt) {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i];
      if (l.type === 'image' && l.visible) {
        if (worldPt.x >= l.x && worldPt.x <= l.x + l.width &&
            worldPt.y >= l.y && worldPt.y <= l.y + l.height) {
          return l;
        }
      }
    }
    return null;
  }

  handlePointerDown(e, worldPt) {
    if (e.button !== 0) return false;
    const zoom = this.camera?.zoom || 1;

    // 1. Check if user clicked the 🔒 lock badge of any locked image to immediately unlock it!
    for (const l of this.layers) {
      if (l.type === 'image' && l.visible && l.locked) {
        const bSz = Math.max(16, 20 / zoom);
        if (worldPt.x >= l.x + 4 / zoom && worldPt.x <= l.x + 4 / zoom + bSz &&
            worldPt.y >= l.y + 4 / zoom && worldPt.y <= l.y + 4 / zoom + bSz) {
          this.unlockImage(l.id);
          return true;
        }
      }
    }

    // 2. Check floating action button clicks if activeEditingImage exists
    if (this.activeEditingImage && this.floatingBtnBounds) {
      const fb = this.floatingBtnBounds;
      const hit = (b) => b && worldPt.x >= b.x && worldPt.x <= b.x + b.w &&
                              worldPt.y >= b.y && worldPt.y <= b.y + b.h;

      if (hit(fb.opMinus)) {
        const cur = this.activeEditingImage.opacity !== undefined ? this.activeEditingImage.opacity : 0.6;
        const next = Math.max(0.1, Math.round((cur - 0.1) * 10) / 10);
        this.setLayerOpacity(this.activeEditingImage.id, next);
        return true;
      }
      if (hit(fb.opPlus)) {
        const cur = this.activeEditingImage.opacity !== undefined ? this.activeEditingImage.opacity : 0.6;
        const next = Math.min(1.0, Math.round((cur + 0.1) * 10) / 10);
        this.setLayerOpacity(this.activeEditingImage.id, next);
        return true;
      }
      if (hit(fb.blend)) {
        const nextMode = this.activeEditingImage.blendMode === 'multiply' ? 'source-over' : 'multiply';
        this.setImageBlendMode(this.activeEditingImage.id, nextMode);
        return true;
      }
      if (hit(fb.lock)) {
        this.lockImage(this.activeEditingImage.id);
        return true;
      }
      if (hit(fb.square)) {
        this.makeImageSquare(this.activeEditingImage.id);
        return true;
      }
      if (hit(fb.fit)) {
        this.fitImageToCushion(this.activeEditingImage.id);
        return true;
      }
      if (hit(fb.del)) {
        this.deleteLayer(this.activeEditingImage.id);
        return true;
      }
    }

    // 3. Find image to transform: active editing image, or clicked unlocked image
    let img = this.activeEditingImage;
    if (!img) {
      const clickedImg = this.findImageAtPoint(worldPt);
      if (clickedImg && !this.isLayerLocked(clickedImg.id)) {
        img = clickedImg;
        this.activeLayerId = img.id;
        this.activeEditingImage = img;
        this.notifyChange();
      }
    }
    if (!img) return false;

    // Check 8 resize handles
    const hSz = Math.max(8, 10 / zoom);
    const handles = this.getImageHandles(img);
    for (const [key, pt] of Object.entries(handles)) {
      if (Math.hypot(worldPt.x - pt.x, worldPt.y - pt.y) <= hSz) {
        this.transformDrag = {
          type: key,
          startX: worldPt.x,
          startY: worldPt.y,
          origX: img.x,
          origY: img.y,
          origW: img.width,
          origH: img.height,
          origAspect: (img.width / Math.max(1, img.height)) || 1.0,
          isShift: !!e.shiftKey,
          img
        };
        return true;
      }
    }

    // Check click inside image for moving
    if (worldPt.x >= img.x && worldPt.x <= img.x + img.width &&
        worldPt.y >= img.y && worldPt.y <= img.y + img.height) {
      this.transformDrag = {
        type: 'move',
        startX: worldPt.x,
        startY: worldPt.y,
        origX: img.x,
        origY: img.y,
        origW: img.width,
        origH: img.height,
        origAspect: (img.width / Math.max(1, img.height)) || 1.0,
        isShift: false,
        img
      };
      return true;
    }

    return false;
  }

  handlePointerMove(e, worldPt) {
    const zoom = this.camera?.zoom || 1;

    if (this.transformDrag) {
      const td = this.transformDrag;
      const dx = worldPt.x - td.startX;
      const dy = worldPt.y - td.startY;
      const img = td.img;
      const origAspect = td.origAspect || (td.origW / td.origH) || 1.0;
      td.isShift = !!e.shiftKey;

      if (td.type === 'move') {
        img.x = Math.round(td.origX + dx);
        img.y = Math.round(td.origY + dy);
      } else {
        let newX = td.origX;
        let newY = td.origY;
        let newW = td.origW;
        let newH = td.origH;

        const isShift = !!e.shiftKey;

        if (td.type === 'se') {
          if (isShift) {
            const scaleW = (td.origW + dx) / td.origW;
            const scaleH = (td.origH + dy) / td.origH;
            const scale = Math.max(0.05, Math.abs(dx) > Math.abs(dy) ? scaleW : scaleH);
            newW = Math.max(30, td.origW * scale);
            newH = newW / origAspect;
          } else {
            newW = Math.max(30, td.origW + dx);
            newH = Math.max(30, td.origH + dy);
          }
          newX = td.origX;
          newY = td.origY;
        } else if (td.type === 'sw') {
          if (isShift) {
            const scaleW = (td.origW - dx) / td.origW;
            const scaleH = (td.origH + dy) / td.origH;
            const scale = Math.max(0.05, Math.abs(dx) > Math.abs(dy) ? scaleW : scaleH);
            newW = Math.max(30, td.origW * scale);
            newH = newW / origAspect;
          } else {
            newW = Math.max(30, td.origW - dx);
            newH = Math.max(30, td.origH + dy);
          }
          newX = (td.origX + td.origW) - newW;
          newY = td.origY;
        } else if (td.type === 'ne') {
          if (isShift) {
            const scaleW = (td.origW + dx) / td.origW;
            const scaleH = (td.origH - dy) / td.origH;
            const scale = Math.max(0.05, Math.abs(dx) > Math.abs(dy) ? scaleW : scaleH);
            newW = Math.max(30, td.origW * scale);
            newH = newW / origAspect;
          } else {
            newW = Math.max(30, td.origW + dx);
            newH = Math.max(30, td.origH - dy);
          }
          newX = td.origX;
          newY = (td.origY + td.origH) - newH;
        } else if (td.type === 'nw') {
          if (isShift) {
            const scaleW = (td.origW - dx) / td.origW;
            const scaleH = (td.origH - dy) / td.origH;
            const scale = Math.max(0.05, Math.abs(dx) > Math.abs(dy) ? scaleW : scaleH);
            newW = Math.max(30, td.origW * scale);
            newH = newW / origAspect;
          } else {
            newW = Math.max(30, td.origW - dx);
            newH = Math.max(30, td.origH - dy);
          }
          newX = (td.origX + td.origW) - newW;
          newY = (td.origY + td.origH) - newH;
        } else if (td.type === 'e') {
          newW = Math.max(30, td.origW + dx);
          newX = td.origX;
          if (isShift) {
            newH = newW / origAspect;
            newY = td.origY + (td.origH - newH) / 2;
          }
        } else if (td.type === 'w') {
          newW = Math.max(30, td.origW - dx);
          newX = td.origX + (td.origW - newW);
          if (isShift) {
            newH = newW / origAspect;
            newY = td.origY + (td.origH - newH) / 2;
          }
        } else if (td.type === 's') {
          newH = Math.max(30, td.origH + dy);
          newY = td.origY;
          if (isShift) {
            newW = newH * origAspect;
            newX = td.origX + (td.origW - newW) / 2;
          }
        } else if (td.type === 'n') {
          newH = Math.max(30, td.origH - dy);
          newY = td.origY + (td.origH - newH);
          if (isShift) {
            newW = newH * origAspect;
            newX = td.origX + (td.origW - newW) / 2;
          }
        }

        // Center scaling with Alt key
        if (e.altKey) {
          const centerX = td.origX + td.origW / 2;
          const centerY = td.origY + td.origH / 2;
          newX = centerX - newW / 2;
          newY = centerY - newH / 2;
        }

        img.x = Math.round(newX);
        img.y = Math.round(newY);
        img.width = Math.round(newW);
        img.height = Math.round(newH);
        img.aspectRatio = newW / newH;
      }

      this.notifyChange();
      if (this.camera) this.camera.requestRender();
      return true;
    }

    // Set hover cursor over handles or active image
    const img = this.activeEditingImage;
    if (img) {
      const hSz = Math.max(8, 10 / zoom);
      const handles = this.getImageHandles(img);
      for (const [key, pt] of Object.entries(handles)) {
        if (Math.hypot(worldPt.x - pt.x, worldPt.y - pt.y) <= hSz) {
          const cursorMap = {
            nw: 'nwse-resize', se: 'nwse-resize',
            ne: 'nesw-resize', sw: 'nesw-resize',
            n: 'ns-resize', s: 'ns-resize',
            e: 'ew-resize', w: 'ew-resize'
          };
          if (this.camera?.canvas) this.camera.canvas.style.cursor = cursorMap[key] || 'pointer';
          return true;
        }
      }
      if (worldPt.x >= img.x && worldPt.x <= img.x + img.width &&
          worldPt.y >= img.y && worldPt.y <= img.y + img.height) {
        if (this.camera?.canvas) this.camera.canvas.style.cursor = 'move';
        return true;
      }
    }

    return false;
  }

  handlePointerUp() {
    if (this.transformDrag) {
      const td = this.transformDrag;
      const img = td.img;
      const hasChanged = img.x !== td.origX || img.y !== td.origY ||
                         img.width !== td.origW || img.height !== td.origH;
      this.transformDrag = null;

      if (hasChanged) {
        this.notifyHistoryPush();
      }
      return true;
    }
    return false;
  }

  getImageHandles(layer) {
    const x = layer.x;
    const y = layer.y;
    const w = layer.width;
    const h = layer.height;
    return {
      nw: { x, y },
      n:  { x: x + w / 2, y },
      ne: { x: x + w, y },
      e:  { x: x + w, y: y + h / 2 },
      se: { x: x + w, y: y + h },
      s:  { x: x + w / 2, y: y + h },
      sw: { x, y: y + h },
      w:  { x, y: y + h / 2 }
    };
  }

  setLayerOpacity(layerId, opacity) {
    const l = this.getLayer(layerId);
    if (l) {
      l.opacity = Math.max(0.0, Math.min(1.0, opacity));
      this.notifyChange();
    }
  }

  moveLayer(layerId, direction) {
    const idx = this.layers.findIndex(l => l.id === layerId);
    if (idx === -1) return;
    const newIdx = direction === 'up' ? idx + 1 : idx - 1;
    if (newIdx < 0 || newIdx >= this.layers.length) return;

    const temp = this.layers[idx];
    this.layers[idx] = this.layers[newIdx];
    this.layers[newIdx] = temp;
    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
  }

  bringToFront(layerId) {
    const idx = this.layers.findIndex(l => l.id === layerId);
    if (idx === -1 || idx === this.layers.length - 1) return;
    const [item] = this.layers.splice(idx, 1);
    this.layers.push(item);
    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
  }

  bringForward(layerId) {
    const idx = this.layers.findIndex(l => l.id === layerId);
    if (idx === -1 || idx >= this.layers.length - 1) return;
    const temp = this.layers[idx];
    this.layers[idx] = this.layers[idx + 1];
    this.layers[idx + 1] = temp;
    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
  }

  sendBackward(layerId) {
    const idx = this.layers.findIndex(l => l.id === layerId);
    if (idx <= 0) return;
    const temp = this.layers[idx];
    this.layers[idx] = this.layers[idx - 1];
    this.layers[idx - 1] = temp;
    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
  }

  sendToBack(layerId) {
    const idx = this.layers.findIndex(l => l.id === layerId);
    if (idx === -1) return;
    const [item] = this.layers.splice(idx, 1);
    // Find system grid index: image should be placed ABOVE system grid, not behind it!
    const gridIdx = this.layers.findIndex(l => l.id === 'layer_grid');
    const insertIdx = (gridIdx !== -1) ? gridIdx + 1 : 0;
    this.layers.splice(insertIdx, 0, item);
    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
  }

  reorderLayer(sourceId, targetId, insertAboveInUI = true) {
    if (sourceId === targetId) return;
    const srcIdx = this.layers.findIndex(l => l.id === sourceId);
    const tgtIdx = this.layers.findIndex(l => l.id === targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    const [moved] = this.layers.splice(srcIdx, 1);
    const newTgtIdx = this.layers.findIndex(l => l.id === targetId);

    // In UI (reversed view):
    // Dropping above target in UI means inserting after target in the array (higher index)
    // Dropping below target in UI means inserting before target in the array (lower index)
    const insertIdx = insertAboveInUI ? newTgtIdx + 1 : newTgtIdx;
    this.layers.splice(Math.max(0, Math.min(this.layers.length, insertIdx)), 0, moved);

    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
  }

  /**
   * Renders Reference Image Layers on Canvas (stacked below grid & stitches)
   */
  renderImageLayers(ctx, state) {
    const zoom = state?.zoom || 1;
    const isIsolationActive = !!this.stitchPen?.isolationMode?.active;

    for (const layer of this.layers) {
      if (layer.type !== 'image' || !layer.visible || !layer.imgEl) continue;

      ctx.save();
      // Always respect user opacity (default 0.60)
      let alpha = layer.opacity !== undefined ? layer.opacity : 0.60;
      if (isIsolationActive) {
        alpha *= 0.25; // Dim non-isolated images during Focus Mode!
      }
      ctx.globalAlpha = Math.max(0.05, Math.min(1.0, alpha));

      // Apply Blend Mode (e.g. 'multiply' for blueprints!)
      ctx.globalCompositeOperation = layer.blendMode || 'source-over';

      // Draw reference image in artboard coordinates
      try {
        if (layer.imgEl && (layer.imgEl.complete === undefined || layer.imgEl.complete || layer.imgEl.width > 0)) {
          ctx.drawImage(layer.imgEl, layer.x, layer.y, layer.width, layer.height);
        }
      } catch (err) {
        // Image still loading or decoding
      }

      // Reset blend mode for UI overlays
      ctx.globalCompositeOperation = 'source-over';

      // Draw subtle lock badge if locked
      if (layer.locked) {
        const bSz = Math.max(16, 20 / zoom);
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = 'rgba(24, 24, 28, 0.88)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = Math.max(0.75, 1.0 / zoom);
        if (ctx.roundRect) ctx.roundRect(layer.x + 4 / zoom, layer.y + 4 / zoom, bSz, bSz, 4 / zoom);
        else ctx.rect(layer.x + 4 / zoom, layer.y + 4 / zoom, bSz, bSz);
        ctx.fill();
        ctx.stroke();

        ctx.font = `${Math.max(9, 11 / zoom)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔒', layer.x + 4 / zoom + bSz / 2, layer.y + 4 / zoom + bSz / 2);
      }

      // If active editing mode: Draw Figma Transform Bounding Box with 8 Handles & Smart Guides
      const isEditing = this.activeEditingImage?.id === layer.id;
      if (isEditing && !layer.locked) {
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = '#0D99FF';
        ctx.lineWidth = Math.max(1.2, 1.5 / zoom);
        ctx.strokeRect(layer.x, layer.y, layer.width, layer.height);

        // 8 Transform Handles (NW, N, NE, E, SE, S, SW, W)
        const hSz = Math.max(6.5, 8.0 / zoom);
        const handles = this.getImageHandles(layer);
        for (const pt of Object.values(handles)) {
          ctx.fillStyle = '#FFFFFF';
          ctx.strokeStyle = '#0D99FF';
          ctx.lineWidth = Math.max(1.0, 1.2 / zoom);
          ctx.fillRect(pt.x - hSz / 2, pt.y - hSz / 2, hSz, hSz);
          ctx.strokeRect(pt.x - hSz / 2, pt.y - hSz / 2, hSz, hSz);
        }

        // 1:1 Square Constraint Guide (diagonal dashed line if square)
        const isSquare = Math.abs(layer.width - layer.height) < 4;
        if (isSquare) {
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
          ctx.lineWidth = Math.max(0.8, 1.0 / zoom);
          ctx.setLineDash([4 / zoom, 3 / zoom]);
          ctx.strokeRect(layer.x, layer.y, layer.width, layer.height);
          ctx.setLineDash([]);
        }

        // Dimension Tag above top-left
        const ppi = this.camera?.ppi || 96;
        const wIn = (layer.width / ppi).toFixed(1);
        const hIn = (layer.height / ppi).toFixed(1);
        const isDragging = this.transformDrag && this.transformDrag.img.id === layer.id;
        const isShift = isDragging && this.transformDrag.isShift;

        let tagText = `📐 ${wIn}" × ${hIn}"`;
        if (isDragging) {
          tagText += isShift ? ' [Shift: Proportional 🔒]' : ' (Hold Shift to lock shape)';
        } else if (isSquare) {
          tagText += ' [1:1 Square]';
        }

        const tagFont = Math.max(9, 10 / zoom);
        ctx.font = `600 ${tagFont}px "JetBrains Mono", Consolas, monospace`;
        const tagMetrics = ctx.measureText(tagText);
        const tagW = tagMetrics.width + 10 / zoom;
        const tagH = tagFont + 6 / zoom;
        const tagX = layer.x;
        const tagY = layer.y - tagH - 4 / zoom;

        ctx.fillStyle = 'rgba(24, 24, 28, 0.92)';
        ctx.strokeStyle = isShift ? '#10B981' : (isSquare ? '#10B981' : '#0D99FF');
        ctx.lineWidth = Math.max(0.75, 1.0 / zoom);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(tagX, tagY, tagW, tagH, 3 / zoom);
        else ctx.rect(tagX, tagY, tagW, tagH);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isShift || isSquare ? '#6EE7B7' : '#EDEDED';
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, tagX + 5 / zoom, tagY + tagH / 2);

        // Modern Floating Action Bar HUD above tag:
        // [ - ] [ ◧ 60% ] [ + ] | [ Blend: Multiply/Normal ] | [ 🔒 Lock ] | [ ⏹ 1:1 ] | [ ↔ Fit ] | [ 🗑 ]
        const btnFont = Math.max(8.5, 9.5 / zoom);
        ctx.font = `600 ${btnFont}px "Plus Jakarta Sans", sans-serif`;

        const opValText = `◧ ${Math.round(alpha * 100)}%`;
        const blendText = layer.blendMode === 'multiply' ? 'Blend: Multiply ⚡' : 'Blend: Normal';
        const lockText = '🔒 Lock';
        const sqText = '⏹ 1:1';
        const fitText = '↔ Fit';
        const delText = '🗑';

        const opW = ctx.measureText(opValText).width + 8 / zoom;
        const minusW = 16 / zoom;
        const plusW = 16 / zoom;
        const blnW = ctx.measureText(blendText).width + 10 / zoom;
        const lckW = ctx.measureText(lockText).width + 8 / zoom;
        const sqW = ctx.measureText(sqText).width + 8 / zoom;
        const fitW = ctx.measureText(fitText).width + 8 / zoom;
        const delW = 20 / zoom;
        const bH = btnFont + 7 / zoom;
        const gap = 3 / zoom;

        const barX = layer.x;
        const barY = tagY - bH - 3 / zoom;

        let curX = barX;
        this.floatingBtnBounds = {
          opMinus: { x: curX, y: barY, w: minusW, h: bH },
          opVal: { x: (curX += minusW + 1 / zoom), y: barY, w: opW, h: bH },
          opPlus: { x: (curX += opW + 1 / zoom), y: barY, w: plusW, h: bH },
          blend: { x: (curX += plusW + gap), y: barY, w: blnW, h: bH },
          lock: { x: (curX += blnW + gap), y: barY, w: lckW, h: bH },
          square: { x: (curX += lckW + gap), y: barY, w: sqW, h: bH },
          fit: { x: (curX += sqW + gap), y: barY, w: fitW, h: bH },
          del: { x: (curX += fitW + gap), y: barY, w: delW, h: bH }
        };

        const renderMiniBtn = (bounds, text, isPrimary = false, isAccent = false) => {
          ctx.fillStyle = isAccent ? 'rgba(56, 189, 248, 0.25)' : (isPrimary ? '#0D99FF' : 'rgba(37, 37, 40, 0.95)');
          ctx.strokeStyle = isAccent ? '#38BDF8' : (isPrimary ? '#38BDF8' : 'rgba(255, 255, 255, 0.15)');
          ctx.lineWidth = Math.max(0.75, 1.0 / zoom);
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(bounds.x, bounds.y, bounds.w, bounds.h, 4 / zoom);
          else ctx.rect(bounds.x, bounds.y, bounds.w, bounds.h);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = isAccent ? '#38BDF8' : (isPrimary ? '#FFFFFF' : '#EDEDED');
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
        };

        renderMiniBtn(this.floatingBtnBounds.opMinus, '−');
        renderMiniBtn(this.floatingBtnBounds.opVal, opValText, false, true);
        renderMiniBtn(this.floatingBtnBounds.opPlus, '+');
        renderMiniBtn(this.floatingBtnBounds.blend, blendText, layer.blendMode === 'multiply');
        renderMiniBtn(this.floatingBtnBounds.lock, lockText);
        renderMiniBtn(this.floatingBtnBounds.square, sqText);
        renderMiniBtn(this.floatingBtnBounds.fit, fitText);
        renderMiniBtn(this.floatingBtnBounds.del, delText);
      }

      ctx.restore();
    }
  }

  deleteLayer(layerId, stitchesMap = null) {
    const l = this.getLayer(layerId);
    if (!l || !l.removable) return false;

    // Remove stitches associated with this layer if map provided
    if (stitchesMap) {
      for (const [k, edge] of Array.from(stitchesMap.entries())) {
        if (edge.layerId === layerId) {
          stitchesMap.delete(k);
        }
      }
    }

    this.layers = this.layers.filter(lay => lay.id !== layerId);

    // If active was deleted, fallback to main
    if (this.activeLayerId === layerId) {
      this.activeLayerId = 'layer_main';
    }
    if (this.activeEditingImage?.id === layerId) {
      this.activeEditingImage = null;
    }

    this.notifyChange();
    if (this.camera) this.camera.requestRender();
    this.notifyHistoryPush();
    return true;
  }

  duplicateLayer(layerId, stitchesMap = null) {
    const orig = this.getLayer(layerId);
    if (!orig) return null;

    const newLayer = this.addLayer(`${orig.name} Copy`);
    newLayer.color = orig.color;

    // Clone stitches if map provided
    if (stitchesMap) {
      const clonedStitches = [];
      for (const [k, edge] of stitchesMap.entries()) {
        if (edge.layerId === orig.id || (!edge.layerId && orig.id === 'layer_main')) {
          clonedStitches.push({ ...edge, layerId: newLayer.id });
        }
      }
      for (const st of clonedStitches) {
        const offsetK = `${st.u[0]},${st.u[1]}--${st.v[0]},${st.v[1]}_${newLayer.id}`;
        stitchesMap.set(offsetK, st);
      }
    }

    this.notifyChange();
    return newLayer;
  }

  renameLayer(layerId, newName) {
    const l = this.getLayer(layerId);
    if (l && newName.trim()) {
      l.name = newName.trim();
      this.notifyChange();
    }
  }

  getStitchCount(layerId, stitchesMap) {
    if (!stitchesMap) return 0;
    let count = 0;
    for (const edge of stitchesMap.values()) {
      if (edge.layerId === layerId || (!edge.layerId && layerId === 'layer_main')) {
        count++;
      }
    }
    return count;
  }

  renderLayerListUI(containerEl = this.lastListContainer, stitchesMap = this.lastStitchesMap) {
    if (!containerEl) return;
    this.lastListContainer = containerEl;
    this.lastStitchesMap = stitchesMap;
    containerEl.innerHTML = '';

    // Update count badge if present
    const badgeEl = document.getElementById('layer-count-badge');
    if (badgeEl) {
      badgeEl.textContent = `${this.layers.length} Layers`;
    }

    // Render layers in reverse order (top layer at top, like Illustrator & Figma)
    const reversed = [...this.layers].reverse();

    reversed.forEach((layer) => {
      const isActive = layer.id === this.activeLayerId;
      const count = this.getStitchCount(layer.id, stitchesMap);

      const card = document.createElement('div');
      card.className = `layer-item-card ${isActive ? 'active' : ''} ${layer.locked ? 'locked' : ''} ${!layer.visible ? 'hidden-layer' : ''}`;
      card.dataset.layerId = layer.id;
      card.draggable = true;

      if (layer.type === 'image') {
        const opacityPct = Math.round((layer.opacity !== undefined ? layer.opacity : 0.6) * 100);
        card.innerHTML = `
          <!-- Drag Handle Grip -->
          <div class="layer-drag-grip" title="Drag to reorder layer">
            <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
              <circle cx="2" cy="2" r="1.1"/>
              <circle cx="6" cy="2" r="1.1"/>
              <circle cx="2" cy="6" r="1.1"/>
              <circle cx="6" cy="6" r="1.1"/>
              <circle cx="2" cy="10" r="1.1"/>
              <circle cx="6" cy="10" r="1.1"/>
            </svg>
          </div>

          <!-- Visibility Eye Toggle -->
          <button class="btn-layer-icon btn-layer-eye ${layer.visible ? 'active' : ''}" title="${layer.visible ? 'Hide Reference Image' : 'Show Reference Image'}">
            ${layer.visible 
              ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>` 
              : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
            }
          </button>

          <!-- Lock Toggle -->
          <button class="btn-layer-icon btn-layer-lock ${layer.locked ? 'active' : ''}" title="${layer.locked ? 'Unlock Reference Image' : 'Lock Reference Image'}">
            ${layer.locked 
              ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>` 
              : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`
            }
          </button>

          <!-- Thumbnail -->
          ${layer.src ? `<img src="${layer.src}" class="layer-thumb-preview" alt="thumb">` : ''}

          <!-- Layer Title -->
          <div class="layer-info-col">
            <span class="layer-name-text" title="${layer.name}">${layer.name}</span>
          </div>

          <!-- Inline Opacity Slider & Badge (Clean Figma Style) -->
          <div class="layer-item-right layer-image-controls">
            <input type="range" class="layer-mini-slider" min="0" max="1" step="0.05" value="${layer.opacity !== undefined ? layer.opacity : 0.6}" title="Adjust Opacity">
            <span class="layer-opacity-badge">${opacityPct}%</span>
          </div>
        `;

        // Wire opacity slider
        const slider = card.querySelector('.layer-mini-slider');
        const valText = card.querySelector('.layer-opacity-badge');
        slider?.addEventListener('input', (e) => {
          e.stopPropagation();
          const val = parseFloat(e.target.value);
          if (valText) valText.textContent = `${Math.round(val * 100)}%`;
          this.setLayerOpacity(layer.id, val);
          if (this.camera) this.camera.requestRender();
        });
        slider?.addEventListener('change', (e) => {
          e.stopPropagation();
          this.notifyHistoryPush();
        });
      } else {
        card.innerHTML = `
          <!-- Drag Handle Grip -->
          <div class="layer-drag-grip" title="Drag to reorder layer">
            <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
              <circle cx="2" cy="2" r="1.1"/>
              <circle cx="6" cy="2" r="1.1"/>
              <circle cx="2" cy="6" r="1.1"/>
              <circle cx="6" cy="6" r="1.1"/>
              <circle cx="2" cy="10" r="1.1"/>
              <circle cx="6" cy="10" r="1.1"/>
            </svg>
          </div>

          <!-- Visibility Eye Toggle -->
          <button class="btn-layer-icon btn-layer-eye ${layer.visible ? 'active' : ''}" title="${layer.visible ? 'Hide Layer' : 'Show Layer'}">
            ${layer.visible 
              ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>` 
              : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
            }
          </button>

          <!-- Lock Toggle -->
          <button class="btn-layer-icon btn-layer-lock ${layer.locked ? 'active' : ''}" title="${layer.locked ? 'Unlock Layer' : 'Lock Layer'}">
            ${layer.locked 
              ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>` 
              : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`
            }
          </button>

          <!-- Color Indicator Dot -->
          <div class="layer-color-dot" style="background: ${layer.color}"></div>

          <!-- Layer Title -->
          <div class="layer-info-col">
            <span class="layer-name-text" title="${layer.name}">${layer.name}</span>
          </div>

          <!-- Right Meta Badge -->
          <div class="layer-item-right">
            <span class="layer-meta-badge">${layer.type === 'system_grid' ? 'Grid' : `${count}`}</span>
          </div>
        `;
      }

      // Drag and Drop Events for Reordering
      card.addEventListener('dragstart', (e) => {
        this.draggedLayerId = layer.id;
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', layer.id);
      });

      card.addEventListener('dragend', () => {
        this.draggedLayerId = null;
        card.classList.remove('is-dragging');
        document.querySelectorAll('.layer-item-card').forEach(c => {
          c.classList.remove('drag-over-top', 'drag-over-bottom');
        });
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (this.draggedLayerId === layer.id) return;
        const rect = card.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        const isTop = relY < rect.height / 2;
        card.classList.toggle('drag-over-top', isTop);
        card.classList.toggle('drag-over-bottom', !isTop);
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over-top', 'drag-over-bottom');
        const sourceId = this.draggedLayerId || e.dataTransfer.getData('text/plain');
        if (!sourceId || sourceId === layer.id) return;

        const rect = card.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        const insertAboveInUI = relY < rect.height / 2;

        this.reorderLayer(sourceId, layer.id, insertAboveInUI);
        this.renderLayerListUI(containerEl, stitchesMap);
      });

      // Context menu on layer card (Right click)
      card.addEventListener('contextmenu', (e) => {
        if (layer.type === 'image') {
          e.preventDefault();
          this.contextMenuTargetImage = layer;
          const menuEl = document.getElementById('image-context-menu');
          if (menuEl) {
            menuEl.style.left = `${Math.min(window.innerWidth - 240, e.clientX + 4)}px`;
            menuEl.style.top = `${Math.min(window.innerHeight - 200, e.clientY + 4)}px`;
            menuEl.classList.remove('hidden');
          }
        }
      });

      // Click card selects layer
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-layer-icon') || e.target.closest('.layer-mini-slider') || e.target.closest('.layer-drag-grip')) return;
        this.setActiveLayer(layer.id);
        if (layer.type === 'image') {
          this.activeEditingImage = layer.locked ? null : layer;
          if (this.camera) this.camera.requestRender();
        }
      });

      // Eye visibility toggle
      const eyeBtn = card.querySelector('.btn-layer-eye');
      eyeBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleVisibility(layer.id);
      });

      // Lock toggle
      const lockBtn = card.querySelector('.btn-layer-lock');
      lockBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleLock(layer.id);
      });

      // Double-click name to rename
      const nameEl = card.querySelector('.layer-name-text');
      nameEl?.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const currentName = layer.name;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cad-inline-input';
        input.value = currentName;

        const commit = () => {
          this.renameLayer(layer.id, input.value || currentName);
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') commit();
          if (ke.key === 'Escape') this.notifyChange();
        });

        nameEl.replaceWith(input);
        input.focus();
        input.select();
      });

      containerEl.appendChild(card);
    });
  }

  notifyChange() {
    if (typeof this.onLayersChanged === 'function') {
      this.onLayersChanged(this.layers);
    }
  }

  serialize() {
    return {
      activeLayerId: this.activeLayerId,
      layers: this.layers.map(l => {
        if (l.type === 'image') {
          return {
            id: l.id,
            name: l.name,
            type: 'image',
            src: l.src,
            x: l.x,
            y: l.y,
            width: l.width,
            height: l.height,
            aspectRatio: l.aspectRatio || (l.width / Math.max(1, l.height)),
            opacity: l.opacity,
            blendMode: l.blendMode || 'source-over',
            isBackground: l.isBackground ?? false,
            locked: l.locked,
            visible: l.visible,
            removable: l.removable ?? true,
            color: l.color
          };
        }
        return {
          id: l.id,
          name: l.name,
          type: l.type,
          visible: l.visible,
          locked: l.locked,
          removable: l.removable ?? true,
          color: l.color
        };
      })
    };
  }

  deserialize(data) {
    if (!data || !Array.isArray(data.layers)) return;
    this.layers = data.layers.map(l => {
      if (l.type === 'image' && l.src) {
        let img = this.imageCache.get(l.src);
        if (!img) {
          img = new Image();
          img.src = l.src;
          this.imageCache.set(l.src, img);
          img.onload = () => {
            if (this.camera) this.camera.requestRender();
          };
        }
        return {
          ...l,
          imgEl: img
        };
      }
      return { ...l };
    });
    this.activeLayerId = data.activeLayerId || 'layer_main';
    this.activeEditingImage = this.layers.find(l => l.type === 'image' && !l.isBackground && !l.locked) || null;
    this.notifyChange();
    if (this.camera) this.camera.requestRender();
  }
}
