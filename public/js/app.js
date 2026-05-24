/* ============================================================
   BookForge — Main Application
   ============================================================ */
const app = {
  books: [],
  currentBook: null,
  currentChapters: [],
  currentChapterIndex: 0,
  viewMode: 'grid',
  readerFontSize: 18,
  readerDarkMode: true,
  activeTag: null,
  ttsUtterance: null,
  ttsSpeaking: false,

  async init() {
    this.initTheme();
    this.bindEvents();
    await this.loadBooks();
    await this.loadTags();
    await this.loadIntegrationStatus();
    this.populateTTSVoices();
  },

  // ============================================================
  // Theme — Auto day/night based on time
  // ============================================================
  initTheme() {
    const hour = new Date().getHours();
    const isNight = hour < 6 || hour >= 19;
    const saved = localStorage.getItem('bf-theme');
    const theme = saved || (isNight ? 'dark' : 'light');
    this.setTheme(theme);

    // Re-check every 5 minutes
    setInterval(() => {
      if (!localStorage.getItem('bf-theme')) {
        const h = new Date().getHours();
        this.setTheme(h < 6 || h >= 19 ? 'dark' : 'light');
      }
    }, 5 * 60 * 1000);
  },

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    this.currentTheme = theme;
  },

  toggleTheme() {
    const next = this.currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('bf-theme', next);
    this.setTheme(next);
  },

  // ============================================================
  // Events
  // ============================================================
  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate(link.dataset.view);
      });
    });

    // Search
    const searchInput = document.getElementById('search-input');
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => this.loadBooks({ search: searchInput.value }), 300);
    });

    // View toggle
    document.getElementById('btn-grid').addEventListener('click', () => this.setViewMode('grid'));
    document.getElementById('btn-list').addEventListener('click', () => this.setViewMode('list'));

    // Sort
    document.getElementById('sort-select').addEventListener('change', (e) => {
      this.loadBooks({ sort: e.target.value });
    });

    // Upload
    document.getElementById('btn-upload').addEventListener('click', () => this.openModal());
    document.getElementById('file-input').addEventListener('change', (e) => this.handleFileSelect(e));

    // Modal close
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', () => {
        this.closeModal();
        this.closeBookModal();
      });
    });

    // Upload drop area
    const uploadDrop = document.getElementById('upload-drop');
    if (uploadDrop) {
      uploadDrop.addEventListener('dragover', (e) => { e.preventDefault(); uploadDrop.classList.add('drag-over'); });
      uploadDrop.addEventListener('dragleave', () => uploadDrop.classList.remove('drag-over'));
      uploadDrop.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadDrop.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) this.uploadFile(e.dataTransfer.files[0]);
      });
    }

    // Global drag-and-drop
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      document.getElementById('drop-zone').classList.remove('hidden');
    });
    document.getElementById('drop-zone').addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null || !document.getElementById('drop-zone').contains(e.relatedTarget)) {
        document.getElementById('drop-zone').classList.add('hidden');
      }
    });
    document.getElementById('drop-zone').addEventListener('drop', (e) => {
      e.preventDefault();
      document.getElementById('drop-zone').classList.add('hidden');
      if (e.dataTransfer.files.length > 0) this.uploadFile(e.dataTransfer.files[0]);
    });

    // Reader controls
    document.getElementById('reader-back').addEventListener('click', () => this.navigate('library'));
    document.getElementById('btn-font-down').addEventListener('click', () => this.changeFontSize(-2));
    document.getElementById('btn-font-up').addEventListener('click', () => this.changeFontSize(2));
    document.getElementById('btn-theme-toggle').addEventListener('click', () => this.toggleTheme());
    document.getElementById('btn-prev-chapter').addEventListener('click', () => this.prevChapter());
    document.getElementById('btn-next-chapter').addEventListener('click', () => this.nextChapter());

    // TTS controls
    document.getElementById('tts-speed').addEventListener('input', (e) => {
      document.getElementById('speed-value').textContent = `${e.target.value}x`;
    });
    document.getElementById('btn-generate-tts').addEventListener('click', () => this.generateTTS());
    document.getElementById('btn-tts-play').addEventListener('click', () => this.playTTS());
    document.getElementById('btn-tts-pause').addEventListener('click', () => this.pauseTTS());
    document.getElementById('btn-tts-stop').addEventListener('click', () => this.stopTTS());

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.closeModal(); this.closeBookModal(); }
      if (document.getElementById('view-reader').classList.contains('active')) {
        if (e.key === 'ArrowLeft') this.prevChapter();
        if (e.key === 'ArrowRight') this.nextChapter();
      }
    });
  },

  // ============================================================
  // Navigation
  // ============================================================
  navigate(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    document.querySelector(`[data-view="${view}"]`).classList.add('active');
  },

  // ============================================================
  // Books
  // ============================================================
  async loadBooks(params = {}) {
    try {
      const query = new URLSearchParams();
      if (params.search) query.set('search', params.search);
      if (params.tag || this.activeTag) query.set('tag', params.tag || this.activeTag);
      if (params.sort) query.set('sort', params.sort);

      const res = await fetch(`/api/books?${query}`);
      this.books = await res.json();
      this.renderBooks();
      this.updateStats();
    } catch (err) {
      this.toast('Failed to load books', 'error');
    }
  },

  renderBooks() {
    const grid = document.getElementById('book-grid');
    const empty = document.getElementById('empty-state');

    if (this.books.length === 0) {
      grid.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    grid.classList.remove('hidden');

    grid.innerHTML = this.books.map(book => `
      <div class="book-card" onclick="app.openBookDetail('${book.id}')" data-id="${book.id}">
        <div class="book-cover">
          ${book.cover_path
            ? `<img src="/${book.cover_path}" alt="${this.escape(book.title)}">`
            : `<div class="book-cover-placeholder">
                <span class="format-badge">${book.format}</span>
                <span class="title-preview">${this.escape(book.title)}</span>
              </div>`
          }
        </div>
        <div class="book-info">
          <div class="book-title">${this.escape(book.title)}</div>
          <div class="book-author">${this.escape(book.author)}</div>
          ${book.tags && book.tags.length > 0
            ? `<div class="book-tags-mini">${book.tags.slice(0, 3).map(t => `<span class="tag-mini">${t}</span>`).join('')}</div>`
            : ''
          }
        </div>
      </div>
    `).join('');
  },

  setViewMode(mode) {
    this.viewMode = mode;
    const grid = document.getElementById('book-grid');
    grid.classList.toggle('list-view', mode === 'list');
    document.getElementById('btn-grid').classList.toggle('active', mode === 'grid');
    document.getElementById('btn-list').classList.toggle('active', mode === 'list');
  },

  updateStats() {
    const statsEl = document.getElementById('stats');
    statsEl.innerHTML = `<span>${this.books.length} book${this.books.length !== 1 ? 's' : ''}</span>`;
  },

  // ============================================================
  // Upload
  // ============================================================
  openModal() {
    document.getElementById('upload-modal').classList.remove('hidden');
    document.getElementById('upload-progress').classList.add('hidden');
    document.getElementById('upload-drop').classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('upload-modal').classList.add('hidden');
  },

  handleFileSelect(e) {
    if (e.target.files.length > 0) this.uploadFile(e.target.files[0]);
  },

  async uploadFile(file) {
    const progressEl = document.getElementById('upload-progress');
    const dropEl = document.getElementById('upload-drop');
    const fillEl = document.getElementById('progress-fill');
    const statusEl = document.getElementById('upload-status');

    dropEl.classList.add('hidden');
    progressEl.classList.remove('hidden');
    fillEl.style.width = '0%';
    statusEl.textContent = `Uploading ${file.name}...`;

    try {
      const formData = new FormData();
      formData.append('book', file);

      // Simulate progress
      let progress = 0;
      const interval = setInterval(() => {
        progress = Math.min(progress + Math.random() * 20, 90);
        fillEl.style.width = `${progress}%`;
      }, 200);

      const res = await fetch('/api/books/upload', { method: 'POST', body: formData });
      clearInterval(interval);

      if (!res.ok) throw new Error('Upload failed');

      fillEl.style.width = '100%';
      statusEl.textContent = 'Processing complete!';

      const book = await res.json();
      this.toast(`"${book.title}" added to your library`, 'success');

      setTimeout(() => {
        this.closeModal();
        this.loadBooks();
        this.loadTags();
      }, 800);
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      this.toast('Upload failed', 'error');
    }
  },

  // ============================================================
  // Book Detail
  // ============================================================
  async openBookDetail(id) {
    try {
      const res = await fetch(`/api/books/${id}`);
      const book = await res.json();
      this.currentBook = book;

      document.getElementById('modal-book-title').textContent = book.title;
      const body = document.getElementById('book-detail-body');

      body.innerHTML = `
        <div class="book-detail">
          <div class="book-detail-cover">
            ${book.cover_path
              ? `<img src="/${book.cover_path}" alt="${this.escape(book.title)}">`
              : `<div class="book-cover-placeholder"><span class="format-badge">${book.format}</span></div>`
            }
          </div>
          <div class="book-detail-meta">
            <h4>Author</h4>
            <p>${this.escape(book.author)}</p>

            <h4>Format</h4>
            <p>${book.format} · ${this.formatBytes(book.file_size)}</p>

            ${book.language ? `<h4>Language</h4><p>${book.language}</p>` : ''}
            ${book.publisher ? `<h4>Publisher</h4><p>${this.escape(book.publisher)}</p>` : ''}
            ${book.description ? `<h4>Description</h4><p class="description-text">${this.escape(book.description).slice(0, 300)}</p>` : ''}

            <h4>Tags</h4>
            <div class="book-tags" id="detail-tags">
              ${(book.tags || []).map(t => `
                <span class="book-tag">${t} <span class="remove-tag" onclick="event.stopPropagation(); app.removeTag('${book.id}', '${t}')">&times;</span></span>
              `).join('')}
            </div>
            <div class="add-tag-input">
              <input type="text" id="new-tag-input" placeholder="Add tag..." onkeydown="if(event.key==='Enter') app.addTag('${book.id}')">
              <button class="btn btn-sm" onclick="app.addTag('${book.id}')">Add</button>
            </div>

            <div class="book-detail-actions">
              ${book.format === 'EPUB' || book.format === 'TXT'
                ? `<button class="btn btn-primary" onclick="app.readBook('${book.id}')">Read</button>`
                : ''
              }
              ${book.format === 'EPUB' || book.format === 'TXT'
                ? `<button class="btn btn-ghost" onclick="app.openAudiobook('${book.id}')">Audiobook</button>`
                : ''
              }
              <button class="btn btn-ghost" onclick="app.downloadBook('${book.id}')">Download</button>
              <button class="btn btn-ghost" onclick="app.syncBook('${book.id}')">Sync All</button>
              <button class="btn btn-danger" onclick="app.deleteBook('${book.id}')">Delete</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('book-modal').classList.remove('hidden');
    } catch (err) {
      this.toast('Failed to load book details', 'error');
    }
  },

  closeBookModal() {
    document.getElementById('book-modal').classList.add('hidden');
  },

  async deleteBook(id) {
    if (!confirm('Delete this book permanently?')) return;
    try {
      await fetch(`/api/books/${id}`, { method: 'DELETE' });
      this.toast('Book deleted', 'success');
      this.closeBookModal();
      this.loadBooks();
      this.loadTags();
    } catch (err) {
      this.toast('Failed to delete book', 'error');
    }
  },

  async downloadBook(id) {
    window.open(`/api/books/${id}/file`, '_blank');
  },

  // ============================================================
  // Tags
  // ============================================================
  async loadTags() {
    try {
      const res = await fetch('/api/tags');
      const tags = await res.json();
      const bar = document.getElementById('tags-bar');
      bar.innerHTML = tags.map(t => `
        <span class="tag-pill ${this.activeTag === t.tag ? 'active' : ''}" onclick="app.filterByTag('${t.tag}')">
          ${t.tag} <span class="count">${t.count}</span>
        </span>
      `).join('');
    } catch (err) {
      // Silently ignore
    }
  },

  filterByTag(tag) {
    this.activeTag = this.activeTag === tag ? null : tag;
    this.loadBooks();
    this.loadTags();
  },

  async addTag(bookId) {
    const input = document.getElementById('new-tag-input');
    const tag = input.value.trim();
    if (!tag) return;

    try {
      await fetch(`/api/books/${bookId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag })
      });
      input.value = '';
      this.openBookDetail(bookId);
      this.loadTags();
    } catch (err) {
      this.toast('Failed to add tag', 'error');
    }
  },

  async removeTag(bookId, tag) {
    try {
      await fetch(`/api/books/${bookId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
      this.openBookDetail(bookId);
      this.loadTags();
    } catch (err) {
      this.toast('Failed to remove tag', 'error');
    }
  },

  // ============================================================
  // Reader
  // ============================================================
  async readBook(id) {
    try {
      this.closeBookModal();
      this.navigate('reader');

      const bookRes = await fetch(`/api/books/${id}`);
      const book = await bookRes.json();
      this.currentBook = book;

      document.getElementById('reader-title').textContent = book.title;

      const contentRes = await fetch(`/api/books/${id}/content`);
      const data = await contentRes.json();
      this.currentChapters = data.chapters || [];

      document.getElementById('reader-placeholder').classList.add('hidden');
      document.getElementById('reader-container').classList.remove('hidden');

      // Populate chapter list
      const chapterList = document.getElementById('chapter-list');
      chapterList.innerHTML = this.currentChapters.map((ch, i) => `
        <li class="${i === 0 ? 'active' : ''}" onclick="app.goToChapter(${i})">${this.escape(ch.title || `Chapter ${i + 1}`)}</li>
      `).join('');

      // Load reading progress
      const progressRes = await fetch(`/api/books/${id}/progress`);
      const progress = await progressRes.json();
      if (progress && progress.chapter_index > 0 && progress.chapter_index < this.currentChapters.length) {
        this.goToChapter(progress.chapter_index);
      } else {
        this.goToChapter(0);
      }
    } catch (err) {
      this.toast('Failed to load book', 'error');
    }
  },

  goToChapter(index) {
    if (index < 0 || index >= this.currentChapters.length) return;
    this.currentChapterIndex = index;

    const chapter = this.currentChapters[index];
    const content = document.getElementById('reader-content');
    content.innerHTML = chapter.content || '<p>No content available.</p>';
    content.style.fontSize = `${this.readerFontSize}px`;
    content.scrollTop = 0;

    // Update chapter list active state
    document.querySelectorAll('#chapter-list li').forEach((li, i) => {
      li.classList.toggle('active', i === index);
    });

    document.getElementById('reader-progress').textContent =
      `Chapter ${index + 1} of ${this.currentChapters.length}`;

    // Save progress
    if (this.currentBook) {
      const percentage = ((index + 1) / this.currentChapters.length) * 100;
      fetch(`/api/books/${this.currentBook.id}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: index, percentage, chapter_index: index })
      }).catch(() => {});
    }
  },

  prevChapter() { this.goToChapter(this.currentChapterIndex - 1); },
  nextChapter() { this.goToChapter(this.currentChapterIndex + 1); },

  changeFontSize(delta) {
    this.readerFontSize = Math.max(12, Math.min(32, this.readerFontSize + delta));
    const content = document.getElementById('reader-content');
    if (content) content.style.fontSize = `${this.readerFontSize}px`;
  },

  // ============================================================
  // Audiobook / TTS
  // ============================================================
  async openAudiobook(id) {
    this.closeBookModal();
    this.navigate('audiobook');

    const res = await fetch(`/api/books/${id}`);
    const book = await res.json();
    this.currentBook = book;

    document.getElementById('audiobook-title').textContent = book.title;
    document.getElementById('audiobook-placeholder').classList.add('hidden');
    document.getElementById('audiobook-container').classList.remove('hidden');

    // Load chapters for chapter selector
    try {
      const contentRes = await fetch(`/api/books/${id}/content`);
      const data = await contentRes.json();
      const chapterSelect = document.getElementById('tts-chapter');
      chapterSelect.innerHTML = '<option value="-1">All Chapters</option>' +
        (data.chapters || []).map((ch, i) => `<option value="${i}">${this.escape(ch.title || `Chapter ${i + 1}`)}</option>`).join('');
    } catch (e) {
      // Keep default
    }
  },

  populateTTSVoices() {
    const select = document.getElementById('tts-voice');
    if (!window.speechSynthesis) return;

    function loadVoices() {
      const voices = speechSynthesis.getVoices();
      if (voices.length === 0) return;
      select.innerHTML = voices.map((v, i) => `<option value="${i}">${v.name} (${v.lang})</option>`).join('');
    }

    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  },

  async generateTTS() {
    if (!this.currentBook) return;
    const statusEl = document.getElementById('tts-status');
    const playerEl = document.getElementById('audiobook-player');

    statusEl.classList.remove('hidden');
    statusEl.innerHTML = '<p>Generating audiobook... This uses your browser\'s text-to-speech engine.</p>';

    try {
      const chapterIndex = parseInt(document.getElementById('tts-chapter').value);
      const speed = parseFloat(document.getElementById('tts-speed').value);

      const res = await fetch(`/api/books/${this.currentBook.id}/tts/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapter_index: chapterIndex >= 0 ? chapterIndex : undefined, speed })
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Load the TTS manifest
      const manifestRes = await fetch(data.audioPath);
      this.ttsManifest = await manifestRes.json();

      statusEl.innerHTML = `<p>Ready to play! Text length: ${this.ttsManifest.fullLength.toLocaleString()} characters${this.ttsManifest.truncated ? ' (truncated for preview)' : ''}</p>`;
      playerEl.classList.remove('hidden');
      document.getElementById('tts-current-text').textContent = this.ttsManifest.text.slice(0, 500) + '...';

      this.toast('Audiobook ready', 'success');
    } catch (err) {
      statusEl.innerHTML = `<p style="color: var(--danger);">Error: ${err.message}</p>`;
      this.toast('TTS generation failed', 'error');
    }
  },

  playTTS() {
    if (!this.ttsManifest || !window.speechSynthesis) {
      this.toast('Text-to-speech not available', 'error');
      return;
    }

    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(this.ttsManifest.text);
    utterance.rate = this.ttsManifest.speed || 1.0;

    const voiceIndex = parseInt(document.getElementById('tts-voice').value);
    const voices = speechSynthesis.getVoices();
    if (voices[voiceIndex]) utterance.voice = voices[voiceIndex];

    utterance.onend = () => { this.ttsSpeaking = false; };
    utterance.onerror = () => { this.ttsSpeaking = false; };

    speechSynthesis.speak(utterance);
    this.ttsUtterance = utterance;
    this.ttsSpeaking = true;
    this.toast('Playing audiobook', 'info');
  },

  pauseTTS() {
    if (window.speechSynthesis) {
      if (speechSynthesis.paused) {
        speechSynthesis.resume();
      } else {
        speechSynthesis.pause();
      }
    }
  },

  stopTTS() {
    if (window.speechSynthesis) {
      speechSynthesis.cancel();
      this.ttsSpeaking = false;
    }
  },

  // ============================================================
  // Integrations
  // ============================================================
  async loadIntegrationStatus() {
    try {
      const res = await fetch('/api/integrations/status');
      const status = await res.json();

      for (const [key, info] of Object.entries(status)) {
        const el = document.getElementById(`status-${key}`);
        if (!el) continue;
        const dot = el.querySelector('.status-dot');
        const text = el.querySelector('.status-text');
        dot.className = `status-dot ${info.configured ? 'connected' : 'disconnected'}`;
        text.textContent = info.configured ? 'Connected' : 'Not configured';
      }
    } catch (err) {
      // Silently ignore
    }
  },

  async syncIntegration(name) {
    if (this.books.length === 0) {
      this.toast('No books to sync', 'info');
      return;
    }

    this.toast(`Syncing to ${name}...`, 'info');
    let successCount = 0;
    let errorCount = 0;

    for (const book of this.books) {
      try {
        await fetch(`/api/integrations/${name}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ book_id: book.id })
        });
        successCount++;
      } catch (err) {
        errorCount++;
      }
    }

    this.toast(`Synced ${successCount} book(s) to ${name}${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
      errorCount > 0 ? 'warning' : 'success');
  },

  async syncBook(bookId) {
    try {
      this.toast('Syncing to all integrations...', 'info');
      const res = await fetch('/api/integrations/sync-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: bookId })
      });
      const results = await res.json();
      const count = Object.keys(results).length;
      this.toast(`Synced to ${count} integration(s)`, 'success');
    } catch (err) {
      this.toast('Sync failed', 'error');
    }
  },

  // ============================================================
  // Utilities
  // ============================================================
  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  },

  escape(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  formatBytes(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }
};

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => app.init());
