/**
 * Sashiko Studio CAD - Multi-Project & Multi-Lab Tabs System
 * Illustrator / Excel style project tabs. Each tab preserves independent
 * stitches, partition geometry, history, and physical cushion size.
 */

export class MultiProjectTabs {
  constructor(options = {}) {
    this.tabs = [];
    this.activeTabId = null;
    this.nextTabNumber = 1;

    this.onTabSwitched = options.onTabSwitched || null;
    this.onStateChanged = options.onStateChanged || null;
    this.layerManager = options.layerManager || null;
    this.partitionEngine = options.partitionEngine || null;
    this.subLabManager = options.subLabManager || null;
    this.camera = options.camera || null;
    this.stitchPen = options.stitchPen || null;

    this.container = document.getElementById('project-tabs-bar');
    this.btnAdd = document.getElementById('btn-add-tab');

    this.init();
  }

  notifyChange() {
    const active = this.getActiveTab();
    if (typeof this.onStateChanged === 'function') {
      this.onStateChanged(active, this);
    }
  }

  init() {
    if (this.btnAdd) {
      this.btnAdd.addEventListener('click', () => {
        this.createTab(`Cushion ${this.nextTabNumber++}`);
      });
    }

    if (this.container) {
      this.container.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
          e.preventDefault();
          this.container.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    }

    // Default initial tab (Illustrator / CAD style - Standard Cushion)
    this.createTab('Untitled-1 @ 50% (18" × 18")', {
      artboardPreset: '18x18',
      orientation: 'portrait',
      cushionInches: 18,
      stitches: new Map()
    });
  }

  createTab(title, initialData = {}) {
    const id = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const defaultLayers = {
      activeLayerId: 'layer_main',
      layers: [
        { id: 'layer_grid', name: 'Base Grid & Stencil', visible: true, locked: false, color: '#38BDF8', type: 'system_grid', removable: false },
        { id: 'layer_main', name: 'Main Motif', visible: true, locked: false, color: '#00FF7F', type: 'stitches', removable: false },
        { id: 'layer_border', name: 'Border Patterns', visible: true, locked: false, color: '#F59E0B', type: 'stitches', removable: true },
        { id: 'layer_notes', name: 'Artisan Notes', visible: true, locked: false, color: '#D946EF', type: 'notes', removable: true }
      ]
    };

    const newTab = {
      id,
      title: title || `Untitled-${this.nextTabNumber++} @ 50% (A2/CAD)`,
      artboardPreset: initialData.artboardPreset || '18x18',
      orientation: initialData.orientation || 'portrait',
      cushionInches: initialData.cushionInches || 18,
      preset: initialData.preset || 'grid-3x3',
      partitions: initialData.partitions ? JSON.parse(JSON.stringify(initialData.partitions)) : null,
      activePartitionId: initialData.activePartitionId || 'B2',
      stitches: initialData.stitches ? new Map(initialData.stitches) : new Map(),
      bgColor: initialData.bgColor || '#121316',
      stitchColor: initialData.stitchColor || '#FFFFFF',
      layers: initialData.layers || defaultLayers
    };

    this.tabs.push(newTab);
    this.switchTab(id);
    this.notifyChange();
    return newTab;
  }

  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId) || this.tabs[0] || null;
  }

  saveCurrentTabState(statePatch) {
    const active = this.getActiveTab();
    if (!active) return;
    Object.assign(active, statePatch);
    this.notifyChange();
  }

  switchTab(tabId) {
    if (this.activeTabId === tabId) return;
    const target = this.tabs.find(t => t.id === tabId);
    if (!target) return;

    // Flush outgoing tab's layers and state before switching
    const outgoing = this.getActiveTab();
    if (outgoing) {
      if (this.layerManager) outgoing.layers = this.layerManager.serialize();
      if (this.partitionEngine) outgoing.partitions = JSON.parse(JSON.stringify(this.partitionEngine.partitions));
      if (this.subLabManager) outgoing.activePartitionId = this.subLabManager.activePartitionId;
      if (this.stitchPen) outgoing.stitches = new Map(this.stitchPen.stitches);
      if (this.camera) {
        outgoing.artboardPreset = this.camera.artboardPreset;
        outgoing.orientation = this.camera.orientation;
        outgoing.cushionInches = this.camera.cushionInches;
      }
    }

    this.activeTabId = tabId;
    this.renderTabsUI();

    const activeEl = this.container?.querySelector(`.project-tab[data-tab-id="${tabId}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }

    if (target.layers && this.layerManager) {
      this.layerManager.deserialize(target.layers);
    }

    if (typeof this.onTabSwitched === 'function') {
      this.onTabSwitched(target);
    }
  }

  closeTab(tabId, e) {
    if (e) e.stopPropagation();
    if (this.tabs.length <= 1) {
      // Don't close last tab; just reset it
      const last = this.tabs[0];
      last.title = 'New Cushion';
      last.stitches.clear();
      this.renderTabsUI();
      if (typeof this.onTabSwitched === 'function') {
        this.onTabSwitched(last);
      }
      this.notifyChange();
      return;
    }

    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx !== -1) {
      this.tabs.splice(idx, 1);
      if (this.activeTabId === tabId) {
        const nextIdx = Math.min(this.tabs.length - 1, idx);
        this.switchTab(this.tabs[nextIdx].id);
      } else {
        this.renderTabsUI();
      }
      this.notifyChange();
    }
  }

  renameTab(tabId, newTitle) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && newTitle.trim() && tab.title !== newTitle.trim()) {
      tab.title = newTitle.trim();
      this.renderTabsUI();
      this.notifyChange();
    }
  }

  renderTabsUI() {
    if (!this.container) return;

    // Clear existing tab buttons (except btnAdd)
    const existing = this.container.querySelectorAll('.project-tab');
    existing.forEach(el => el.remove());

    this.tabs.forEach((tab) => {
      const tabEl = document.createElement('button');
      tabEl.className = `project-tab ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabEl.dataset.tabId = tab.id;
      tabEl.title = `${tab.title} (Double-click to rename)`;

      tabEl.innerHTML = `
        <span class="tab-title">${tab.title}</span>
        <span class="tab-close" title="Close Canvas">✕</span>
      `;

      tabEl.addEventListener('click', () => {
        this.switchTab(tab.id);
      });

      // Double-click to rename tab title
      const titleSpan = tabEl.querySelector('.tab-title');
      titleSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const currentTitle = tab.title;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tab-rename-input';
        input.value = currentTitle;
        input.style.cssText = 'background:var(--bg-input, #18181A); border:1px solid var(--accent-blue, #0D99FF); color:#fff; font-size:11px; font-weight:600; border-radius:3px; padding:1px 4px; width:100%; min-width:0; box-sizing:border-box; outline:none;';

        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          const val = input.value.trim();
          this.renameTab(tab.id, val || currentTitle);
          this.renderTabsUI();
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') {
            ke.preventDefault();
            commit();
          }
          if (ke.key === 'Escape') {
            committed = true;
            this.renderTabsUI();
          }
        });

        titleSpan.replaceWith(input);
        input.focus();
        input.select();
      });

      const closeSpan = tabEl.querySelector('.tab-close');
      closeSpan.addEventListener('click', (e) => {
        this.closeTab(tab.id, e);
      });

      this.container.insertBefore(tabEl, this.btnAdd);
    });
  }

  serializeAll() {
    const active = this.getActiveTab();
    if (active) {
      if (this.stitchPen) active.stitches = new Map(this.stitchPen.stitches);
      if (this.layerManager) active.layers = this.layerManager.serialize();
      if (this.partitionEngine) active.partitions = JSON.parse(JSON.stringify(this.partitionEngine.partitions));
      if (this.subLabManager) active.activePartitionId = this.subLabManager.activePartitionId;
      if (this.camera) {
        active.artboardPreset = this.camera.artboardPreset;
        active.orientation = this.camera.orientation;
        active.cushionInches = this.camera.cushionInches;
      }
    }
    return {
      activeTabId: this.activeTabId,
      ruler: this.virtualRuler ? this.virtualRuler.serialize() : null,
      tabs: this.tabs.map(t => ({
        id: t.id,
        title: t.title,
        artboardPreset: t.artboardPreset || '18x18',
        orientation: t.orientation || 'portrait',
        cushionInches: t.cushionInches || 18,
        preset: t.preset || 'grid-3x3',
        partitions: t.id === this.activeTabId && this.partitionEngine
          ? JSON.parse(JSON.stringify(this.partitionEngine.partitions))
          : t.partitions,
        activePartitionId: t.id === this.activeTabId && this.subLabManager
          ? this.subLabManager.activePartitionId
          : t.activePartitionId,
        stitches: Array.from(t.stitches.entries()),
        bgColor: t.bgColor || '#121316',
        stitchColor: t.stitchColor || '#FFFFFF',
        layers: t.id === this.activeTabId && this.layerManager
          ? this.layerManager.serialize()
          : (t.layers || null)
      }))
    };
  }

  deserializeAll(data) {
    if (!data || !Array.isArray(data.tabs) || data.tabs.length === 0) return false;

    this.tabs = data.tabs.map(t => ({
      id: t.id,
      title: t.title,
      artboardPreset: t.artboardPreset || (t.cushionInches ? `${t.cushionInches}x${t.cushionInches}` : '18x18'),
      orientation: t.orientation || 'portrait',
      cushionInches: t.cushionInches || 18,
      preset: t.preset || 'grid-3x3',
      partitions: t.partitions || null,
      activePartitionId: t.activePartitionId || 'B2',
      stitches: new Map(t.stitches || []),
      bgColor: t.bgColor || '#121316',
      stitchColor: t.stitchColor || '#FFFFFF',
      layers: t.layers || null
    }));

    this.activeTabId = data.activeTabId || this.tabs[0].id;
    this.renderTabsUI();
    const active = this.getActiveTab();
    if (active) {
      if (active.layers && this.layerManager) {
        this.layerManager.deserialize(active.layers);
      }
      if (typeof this.onTabSwitched === 'function') {
        this.onTabSwitched(active);
      }
    }
    if (data.ruler && this.virtualRuler) {
      this.virtualRuler.deserialize(data.ruler);
    }
    return true;
  }
}
