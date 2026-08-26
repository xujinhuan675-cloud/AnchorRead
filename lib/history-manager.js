class HistoryManager {
  constructor() {
    this.STORAGE_KEY = 'smart-excalidraw-history';
    this.histories = [];
    this.loaded = false;
  }

  ensureLoaded() {
    if (typeof window === 'undefined') return;
    if (!this.loaded) {
      this.loadHistories();
      this.loaded = true;
    }
  }

  loadHistories() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      this.histories = stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to load histories:', error);
      this.histories = [];
    }
  }

  saveHistories() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.histories));
    } catch (error) {
      console.error('Failed to save histories:', error);
    }
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  addHistory(data) {
    this.ensureLoaded();
    const history = {
      id: this.generateId(),
      chartType: data.chartType,
      engine: data.engine || 'excalidraw',
      userInput: data.userInput,
      generatedCode: data.generatedCode,
      documentId: data.documentId || '',
      drawingId: data.drawingId || '',
      config: data.config,
      // 补录场景（从图解回填）需要保留原始创建时间，缺省才是当前时间
      timestamp: data.timestamp || Date.now()
    };
    this.histories.unshift(history);
    this.saveHistories();
    return history;
  }

  getHistories() {
    this.ensureLoaded();
    return [...this.histories];
  }

  getForDocument(documentId) {
    this.ensureLoaded();
    return this.histories.filter((history) => history.documentId === documentId);
  }

  replaceAll(histories) {
    this.histories = Array.isArray(histories) ? [...histories] : [];
    this.loaded = true;
    this.saveHistories();
  }

  deleteHistory(id) {
    this.ensureLoaded();
    this.histories = this.histories.filter(h => h.id !== id);
    this.saveHistories();
  }

  removeForDocument(documentId) {
    this.ensureLoaded();
    this.histories = this.histories.filter((history) => history.documentId !== documentId);
    this.saveHistories();
  }

  clearAll() {
    this.ensureLoaded();
    this.histories = [];
    this.saveHistories();
  }
}

export const historyManager = new HistoryManager();
