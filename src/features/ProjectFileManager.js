/**
 * Sashiko Studio CAD - Native File System Manager
 * Supports File System Access API with handle persistence (Ctrl+S direct write),
 * universal fallback (Blob download + file input), and project drag-and-drop.
 */

export class ProjectFileManager {
  constructor(options = {}) {
    this.multiProjectTabs = options.multiProjectTabs;
    this.historyManager = options.historyManager;
    this.virtualRuler = options.virtualRuler || null;
    this.camera = options.camera || null;
    this.onProjectLoaded = options.onProjectLoaded || null;

    this.fileHandle = null;
    this.fileName = null;
    this.hasUnsavedChanges = false;
    this.isSupportedFSA = typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;

    this.badgeEl = document.getElementById('save-status-badge');
    this.hiddenInput = null;

    // AutoSave to project file concurrency locks
    this.isWriting = false;
    this.pendingWrite = false;
    this.autoSaveDebounceTimer = null;
    this.autoSaveDelay = 1500;

    this.initHiddenFileInput();
    this.bindWindowShortcuts();
    this.bindBeforeUnload();
  }

  initHiddenFileInput() {
    let input = document.getElementById('input-open-sashiko');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'input-open-sashiko';
      input.accept = '.sashiko,.json';
      input.style.display = 'none';
      document.body.appendChild(input);
    }
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        await this.loadFromFile(file);
        input.value = '';
      }
    });
    this.hiddenInput = input;
  }

  bindBeforeUnload() {
    window.addEventListener('beforeunload', (e) => {
      if (this.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved project changes in Sashiko Studio CAD.';
        return e.returnValue;
      }
    });
  }

  bindWindowShortcuts() {
    window.addEventListener('keydown', (e) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      if (!isCmdOrCtrl) return;

      const isKeyS = e.code === 'KeyS' || e.key === 's' || e.key === 'S';
      const isKeyO = e.code === 'KeyO' || e.key === 'o' || e.key === 'O';

      if (isKeyS) {
        e.preventDefault();
        e.stopPropagation();
        // Blur active input to commit any pending edit value before saving
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
          e.target.blur();
        }
        if (!e.shiftKey) {
          this.saveProject(false);
        } else {
          this.saveProject(true);
        }
        return;
      }

      if (isKeyO) {
        e.preventDefault();
        e.stopPropagation();
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
          e.target.blur();
        }
        this.openProject();
        return;
      }
    }, { capture: true });
  }

  markDirty() {
    this.hasUnsavedChanges = true;
    if (this.fileName) {
      this.updateBadge(`○ Unsaved (${this.fileName})`, 'dirty');
    } else {
      this.updateBadge('○ Unsaved Changes', 'dirty');
    }

    // Auto-save directly into the open project file if fileHandle exists
    if (this.fileHandle && this.historyManager?.autoSaveEnabled) {
      this.scheduleAutoSave();
    }
  }

  scheduleAutoSave() {
    if (this.autoSaveDebounceTimer) {
      clearTimeout(this.autoSaveDebounceTimer);
    }
    this.autoSaveDebounceTimer = setTimeout(async () => {
      await this.performAutoSave();
    }, this.autoSaveDelay);
  }

  async performAutoSave() {
    if (this.historyManager && !this.historyManager.autoSaveEnabled) {
      return;
    }

    if (this.fileHandle && this.isSupportedFSA) {
      await this.writeToHandle();
    } else {
      // Draft mode before file is created on disk
      if (this.fileName) {
        this.updateBadge(`○ Unsaved (${this.fileName})`, 'dirty');
      } else {
        this.updateBadge('○ Unsaved Changes', 'dirty');
      }
    }
  }

  async writeToHandle() {
    if (!this.fileHandle) return false;

    // Mutex lock to prevent concurrent write collisions or corrupted JSON on disk
    if (this.isWriting) {
      this.pendingWrite = true;
      return false;
    }

    this.isWriting = true;
    this.updateBadge(`⏳ AutoSaving to ${this.fileName}...`, 'saving');

    const data = this.generateProjectData();
    const jsonStr = JSON.stringify(data, null, 2);

    try {
      // Verify readwrite permission before attempting stream
      if (typeof this.fileHandle.queryPermission === 'function') {
        const perm = await this.fileHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          const req = await this.fileHandle.requestPermission({ mode: 'readwrite' });
          if (req !== 'granted') {
            throw new DOMException('File write permission was revoked', 'NotAllowedError');
          }
        }
      }

      const writable = await this.fileHandle.createWritable();
      await writable.write(jsonStr);
      await writable.close();

      this.hasUnsavedChanges = false;
      this.updateBadge(`💾 AutoSaved: ${this.fileName}`, 'saved-disk');

      // Sync to browser backup buffer
      if (this.historyManager) {
        try {
          localStorage.setItem(this.historyManager.storageKey, jsonStr);
        } catch {
          // Ignore quota limits for heavy image projects
        }
      }
      return true;
    } catch (err) {
      console.warn('AutoSave to project file failed (permission or disk error):', err);
      this.hasUnsavedChanges = true;

      // Emergency fallback: write directly to localStorage so crash recovery is guaranteed!
      if (this.historyManager) {
        try {
          localStorage.setItem(this.historyManager.storageKey, jsonStr);
          console.info('Emergency AutoSave mirrored to local storage buffer.');
        } catch (_) {}
      }

      // If handle was revoked or file unlinked, clear fileHandle to avoid infinite silent failures
      if (err.name === 'NotAllowedError' || err.name === 'NotFoundError' || err.name === 'SecurityError') {
        this.fileHandle = null;
        this.updateBadge(`⚠️ Save Failed (${this.fileName || 'Disk'} Unlinked)`, 'dirty');
      } else {
        this.updateBadge(`○ Unsaved (${this.fileName})`, 'dirty');
      }
      return false;
    } finally {
      this.isWriting = false;
      if (this.pendingWrite) {
        this.pendingWrite = false;
        this.scheduleAutoSave();
      }
    }
  }

  updateBadge(text, stateClass = '') {
    if (!this.badgeEl) {
      this.badgeEl = document.getElementById('save-status-badge');
    }
    if (!this.badgeEl) return;
    this.badgeEl.textContent = text;
    this.badgeEl.className = `save-status-badge ${stateClass}`;
  }

  generateProjectData() {
    const serialized = this.multiProjectTabs.serializeAll();
    return {
      version: '2.0.0',
      generator: 'Sashiko Studio CAD',
      timestamp: new Date().toISOString(),
      activeTabId: serialized.activeTabId,
      ruler: this.virtualRuler ? this.virtualRuler.serialize() : serialized.ruler || null,
      tabs: serialized.tabs
    };
  }

  /**
   * Save Project: If fileHandle exists and isSaveAs is false, writes directly to disk.
   * Otherwise opens native Windows/Mac Save File Picker.
   */
  async saveProject(isSaveAs = false) {
    const data = this.generateProjectData();
    const jsonStr = JSON.stringify(data, null, 2);

    this.updateBadge('⏳ Saving...', 'saving');

    if (this.isSupportedFSA) {
      try {
        if (!this.fileHandle || isSaveAs) {
          const activeTab = this.multiProjectTabs.getActiveTab();
          const cleanName = (activeTab?.title || 'Untitled_Project')
            .replace(/[^\w\d-_]/g, '_')
            .replace(/_+/g, '_');
          const suggestedName = `${cleanName}.sashiko`;

          this.fileHandle = await window.showSaveFilePicker({
            suggestedName,
            types: [
              {
                description: 'Sashiko Studio CAD Project (*.sashiko)',
                accept: { 'application/json': ['.sashiko', '.json'] }
              }
            ]
          });
          this.fileName = this.fileHandle.name;
        }

        const writable = await this.fileHandle.createWritable();
        await writable.write(jsonStr);
        await writable.close();

        this.hasUnsavedChanges = false;
        this.updateBadge(`💾 Saved: ${this.fileName}`, 'saved-disk');
        return true;
      } catch (err) {
        if (err.name === 'AbortError') {
          // User cancelled save dialog
          this.updateBadge(this.hasUnsavedChanges ? '○ Unsaved Changes' : '● Saved', this.hasUnsavedChanges ? 'dirty' : '');
          return false;
        }
        console.warn('File System Access API failed, falling back to download:', err);
      }
    }

    // Universal Fallback: Download via Object URL
    const activeTab = this.multiProjectTabs.getActiveTab();
    const cleanName = (activeTab?.title || 'Untitled_Project')
      .replace(/[^\w\d-_]/g, '_')
      .replace(/_+/g, '_');
    const filename = `${cleanName}.sashiko`;

    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);

    this.fileName = filename;
    this.hasUnsavedChanges = false;
    this.updateBadge(`💾 Downloaded: ${filename}`, 'saved-disk');
    return true;
  }

  /**
   * Open Project: Uses FSA file picker if available, else hidden <input type="file">
   */
  async openProject() {
    if (this.hasUnsavedChanges) {
      const confirmLeave = window.confirm('You have unsaved changes in your current project. Opening a new file will replace unsaved work. Continue?');
      if (!confirmLeave) return;
    }

    if (this.isSupportedFSA) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: 'Sashiko Studio CAD Project (*.sashiko, *.json)',
              accept: { 'application/json': ['.sashiko', '.json'] }
            }
          ]
        });
        if (handle) {
          const file = await handle.getFile();
          this.fileHandle = handle;
          this.fileName = handle.name;
          await this.loadFromFile(file);
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('FSA Open picker failed, falling back to input:', err);
      }
    }

    // Universal Fallback trigger
    this.hiddenInput?.click();
  }

  async loadFromFile(file) {
    try {
      this.updateBadge('⏳ Loading Project...', 'saving');
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate project format
      if (!data || (!data.tabs && !data.stitches)) {
        throw new Error('Invalid project structure. File does not contain Sashiko CAD data.');
      }

      let success = false;
      if (Array.isArray(data.tabs)) {
        success = this.multiProjectTabs.deserializeAll(data);
      } else {
        // Legacy v1.0 fallback
        success = this.multiProjectTabs.deserializeAll({
          activeTabId: null,
          tabs: [
            {
              id: 'tab_legacy',
              title: file.name.replace(/\.[^/.]+$/, ''),
              stitches: data.stitches || [],
              layers: data.layers || null,
              partitions: data.partitions || null,
              cushionInches: data.cushionInches || 18,
              bgColor: data.bgColor || '#121316',
              stitchColor: data.stitchColor || '#FFFFFF'
            }
          ]
        });
      }

      if (success) {
        this.fileName = file.name;
        this.hasUnsavedChanges = false;
        this.updateBadge(`💾 Open: ${this.fileName}`, 'saved-disk');

        if (this.historyManager) {
          this.historyManager.undoStack = [];
          this.historyManager.redoStack = [];
          this.historyManager.pushState(this.multiProjectTabs.serializeAll());
        }

        if (typeof this.onProjectLoaded === 'function') {
          this.onProjectLoaded(data);
        }
      }
    } catch (err) {
      console.error('Failed to load .sashiko file:', err);
      window.alert(`Could not load project: ${err.message}`);
      this.updateBadge('● Error Opening File', 'dirty');
    }
  }
}
