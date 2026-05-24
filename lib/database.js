const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'bookforge.db');

let db;

function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initialize() {
  const conn = getDb();

  conn.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT DEFAULT 'Unknown',
      description TEXT DEFAULT '',
      language TEXT DEFAULT 'en',
      publisher TEXT DEFAULT '',
      published_date TEXT DEFAULT '',
      cover_path TEXT DEFAULT '',
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      format TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      position REAL DEFAULT 0,
      percentage REAL DEFAULT 0,
      chapter_index INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      note TEXT DEFAULT '',
      chapter_index INTEGER DEFAULT 0,
      position REAL DEFAULT 0,
      color TEXT DEFAULT '#ffeb3b',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tags (
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (book_id, tag)
    );

    CREATE TABLE IF NOT EXISTS audio_files (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_index INTEGER DEFAULT -1,
      file_path TEXT NOT NULL,
      voice TEXT DEFAULT 'default',
      speed REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id);
    CREATE INDEX IF NOT EXISTS idx_tags_book ON tags(book_id);
    CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
    CREATE INDEX IF NOT EXISTS idx_audio_book ON audio_files(book_id);
  `);
}

function getBooks({ search, tag, sort, order } = {}) {
  const conn = getDb();
  let query = `
    SELECT b.*, GROUP_CONCAT(t.tag) as tags
    FROM books b
    LEFT JOIN tags t ON b.id = t.book_id
  `;
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(b.title LIKE ? OR b.author LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  if (tag) {
    conditions.push('t.tag = ?');
    params.push(tag);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' GROUP BY b.id';

  const sortCol = ['title', 'author', 'created_at', 'file_size'].includes(sort) ? sort : 'created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  query += ` ORDER BY b.${sortCol} ${sortOrder}`;

  const books = conn.prepare(query).all(...params);
  return books.map(b => ({
    ...b,
    tags: b.tags ? b.tags.split(',') : []
  }));
}

function getBook(id) {
  const conn = getDb();
  const book = conn.prepare('SELECT * FROM books WHERE id = ?').get(id);
  if (!book) return null;

  const tags = conn.prepare('SELECT tag FROM tags WHERE book_id = ?').all(id).map(t => t.tag);
  return { ...book, tags };
}

function addBook(bookData) {
  const conn = getDb();
  const stmt = conn.prepare(`
    INSERT INTO books (id, title, author, description, language, publisher, published_date, cover_path, file_path, file_name, file_size, format)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    bookData.id, bookData.title, bookData.author, bookData.description,
    bookData.language, bookData.publisher, bookData.published_date,
    bookData.cover_path, bookData.file_path, bookData.file_name,
    bookData.file_size, bookData.format
  );
  return getBook(bookData.id);
}

function updateBook(id, updates) {
  const conn = getDb();
  const existing = getBook(id);
  if (!existing) return null;

  const allowed = ['title', 'author', 'description', 'language', 'publisher', 'published_date'];
  const sets = [];
  const params = [];

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(updates[key]);
    }
  }

  if (sets.length > 0) {
    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    conn.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  return getBook(id);
}

function deleteBook(id) {
  const conn = getDb();
  conn.prepare('DELETE FROM books WHERE id = ?').run(id);
}

function getProgress(bookId) {
  const conn = getDb();
  return conn.prepare('SELECT * FROM reading_progress WHERE book_id = ?').get(bookId);
}

function updateProgress(bookId, { position, percentage, chapter_index }) {
  const conn = getDb();
  conn.prepare(`
    INSERT INTO reading_progress (book_id, position, percentage, chapter_index, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(book_id) DO UPDATE SET
      position = excluded.position,
      percentage = excluded.percentage,
      chapter_index = excluded.chapter_index,
      updated_at = CURRENT_TIMESTAMP
  `).run(bookId, position || 0, percentage || 0, chapter_index || 0);
  return getProgress(bookId);
}

function getHighlights(bookId) {
  const conn = getDb();
  return conn.prepare('SELECT * FROM highlights WHERE book_id = ? ORDER BY created_at DESC').all(bookId);
}

function addHighlight(data) {
  const conn = getDb();
  conn.prepare(`
    INSERT INTO highlights (id, book_id, text, note, chapter_index, position, color)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(data.id, data.book_id, data.text, data.note, data.chapter_index, data.position, data.color);
  return conn.prepare('SELECT * FROM highlights WHERE id = ?').get(data.id);
}

function deleteHighlight(id) {
  const conn = getDb();
  conn.prepare('DELETE FROM highlights WHERE id = ?').run(id);
}

function getTags() {
  const conn = getDb();
  return conn.prepare('SELECT DISTINCT tag, COUNT(*) as count FROM tags GROUP BY tag ORDER BY tag').all();
}

function getBookTags(bookId) {
  const conn = getDb();
  return conn.prepare('SELECT tag FROM tags WHERE book_id = ?').all(bookId).map(t => t.tag);
}

function addTag(bookId, tag) {
  const conn = getDb();
  conn.prepare('INSERT OR IGNORE INTO tags (book_id, tag) VALUES (?, ?)').run(bookId, tag.trim().toLowerCase());
}

function removeTag(bookId, tag) {
  const conn = getDb();
  conn.prepare('DELETE FROM tags WHERE book_id = ? AND tag = ?').run(bookId, tag);
}

function addAudioFile(data) {
  const conn = getDb();
  conn.prepare(`
    INSERT INTO audio_files (id, book_id, chapter_index, file_path, voice, speed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(data.id, data.book_id, data.chapter_index, data.file_path, data.voice, data.speed);
}

function getAudioFiles(bookId) {
  const conn = getDb();
  return conn.prepare('SELECT * FROM audio_files WHERE book_id = ? ORDER BY chapter_index').all(bookId);
}

module.exports = {
  initialize,
  getBooks,
  getBook,
  addBook,
  updateBook,
  deleteBook,
  getProgress,
  updateProgress,
  getHighlights,
  addHighlight,
  deleteHighlight,
  getTags,
  getBookTags,
  addTag,
  removeTag,
  addAudioFile,
  getAudioFiles
};
