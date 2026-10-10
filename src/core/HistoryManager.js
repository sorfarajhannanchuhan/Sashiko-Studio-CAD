/**
 * Sashiko Studio CAD - History & Crash-Proof Auto-Save Manager
 * Manages full undo/redo state stacks and local storage persistence.
 */

export class HistoryManager {
  constructor(maxHistory = 50) {
    this.maxHistory = maxHistory;
    this.undoStack = [];
    this.redoStack = [];
    this.storageKey = 'sashiko_cad_autosave_v3';
    this.saveTimeout = null;
    this.onStateChange = null;
    this.assetRegistry = new Map(); // Global asset pool to deduplicate heavy image data

    // Configurable AutoSave (Default: true, can be toggled by user in Settings)
    const storedSetting = typeof localStorage !== 'undefined' ? localStorage.getItem('sashiko_autosave_enabled') : null;
    this.autoSaveEnabled = storedSetting !== null ? storedSetting === 'true' : true;
    this.projectFileManager = null;
  }

  setAutoSaveEnabled(enabled) {
    this.autoSaveEnabled = !!enabled;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sashiko_autosave_enabled', this.autoSaveEnabled ? 'true' : 'false');
    }
    if (!this.autoSaveEnabled && this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
  }

  /**
   * Compresses snapshot by replacing repeated base64 strings with lightweight asset IDs.
   * Uses structural shallow cloning to prevent multi-megabyte JSON string serialization on every stroke.
   */
  compressSnapshot(snapshot) {
    if (!snapshot) return null;
    try {
      if (!Array.isArray(snapshot.tabs)) {
        return snapshot;
      }
      const clone = { ...snapshot, tabs: [] };
      for (const tab of snapshot.tabs) {
        const tabClone = { ...tab };
        if (tab.layers && Array.isArray(tab.layers.layers)) {
          tabClone.layers = {
            ...tab.layers,
            layers: tab.layers.layers.map(l => {
              if (l.type === 'image' && l.src && l.src.length > 500) {
                const key = `asset_${l.id || 'img'}_${l.src.length}`;
                if (!this.assetRegistry.has(key)) {
                  this.assetRegistry.set(key, l.src);
                }
                return { ...l, src: key };
              }
              return { ...l };
            })
          };
        }
        clone.tabs.push(tabClone);
      }
      return clone;
    } catch {
      return snapshot;
    }
  }

  /**
   * Decompresses snapshot by resolving asset tokens back to cached image data
   */
  decompressSnapshot(snapshot) {
    if (!snapshot) return null;
    try {
      if (!Array.isArray(snapshot.tabs)) return snapshot;
      const clone = { ...snapshot, tabs: [] };
      for (const tab of snapshot.tabs) {
        const tabClone = { ...tab };
        if (tab.layers && Array.isArray(tab.layers.layers)) {
          tabClone.layers = {
            ...tab.layers,
            layers: tab.layers.layers.map(l => {
              if (l.type === 'image' && l.src && this.assetRegistry.has(l.src)) {
                return { ...l, src: this.assetRegistry.get(l.src) };
              }
              return { ...l };
            })
          };
        }
        clone.tabs.push(tabClone);
      }
      return clone;
    } catch {
      return snapshot;
    }
  }

  pushState(snapshot) {
    const compressed = this.compressSnapshot(snapshot);
    const stateStr = JSON.stringify(compressed);
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === stateStr) {
      return; // Deduplicate identical states
    }

    this.undoStack.push(stateStr);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    // Clear redo when new action taken
    this.redoStack = [];

    // Notify project file manager that project state has unsaved changes
    if (this.projectFileManager) {
      this.projectFileManager.markDirty();
    }

    if (this.autoSaveEnabled) {
      this.scheduleAutoSave(snapshot);
    }
    this.notify();
  }

  canUndo() {
    return this.undoStack.length > 1;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo()) return null;
    const current = this.undoStack.pop();
    this.redoStack.push(current);
    const prev = this.undoStack[this.undoStack.length - 1];
    this.notify();
    const parsed = JSON.parse(prev);
    return this.decompressSnapshot(parsed);
  }

  redo() {
    if (!this.canRedo()) return null;
    const next = this.redoStack.pop();
    this.undoStack.push(next);
    this.notify();
    const parsed = JSON.parse(next);
    return this.decompressSnapshot(parsed);
  }

  scheduleAutoSave(data) {
    if (!this.autoSaveEnabled) return;
    if (this.saveTimeout) clearTimeout(this.saveTimeout);

    // If ProjectFileManager has an active file handle, it writes directly to disk
    if (this.projectFileManager && this.projectFileManager.fileHandle) {
      this.projectFileManager.scheduleAutoSave();
      return;
    }

    this.saveTimeout = setTimeout(() => {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
        if (this.projectFileManager && !this.projectFileManager.fileHandle) {
          this.updateBadge('● AutoSaved (Local)');
        } else {
          this.updateBadge('● AutoSaved');
        }
      } catch (err) {
        // QuotaExceededError fallback: save lightweight data without raw image binaries
        try {
          const stripped = JSON.parse(JSON.stringify(data));
          if (stripped.tabs) {
            for (const t of stripped.tabs) {
              if (t.layers?.layers) {
                t.layers.layers = t.layers.layers.map(l => l.type === 'image' ? { ...l, src: '' } : l);
              }
            }
          }
          localStorage.setItem(this.storageKey, JSON.stringify(stripped));
          this.updateBadge('● Saved (Lite)');
        } catch (innerErr) {
          console.warn('AutoSave error:', innerErr);
        }
      }
    }, 1500);
    this.updateBadge('○ Saving...');
  }

  loadAutoSave() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return this.decompressSnapshot(parsed);
    } catch (e) {
      console.warn('Failed to load auto-save:', e);
      return null;
    }
  }

  updateBadge(text) {
    const badge = document.getElementById('save-status-badge');
    if (badge) {
      badge.textContent = text;
      badge.classList.toggle('saving', text.includes('Saving'));
    }
  }

  notify() {
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    if (btnUndo) btnUndo.disabled = !this.canUndo();
    if (btnRedo) btnRedo.disabled = !this.canRedo();

    if (typeof this.onStateChange === 'function') {
      this.onStateChange();
    }
  }
}
