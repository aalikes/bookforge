require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./lib/database');
const epubParser = require('./lib/epub-parser');
const ttsEngine = require('./lib/tts-engine');
const integrations = require('./lib/integrations');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
['uploads', 'audio', 'data'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/audio', express.static('audio'));

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.epub', '.pdf', '.mobi', '.txt', '.html', '.htm', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// Initialize database
db.initialize();

// ============================================================
// Health Check
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.1.0' });
});

// ============================================================
// Books API
// ============================================================
app.get('/api/books', (req, res) => {
  try {
    const { search, tag, sort, order, status } = req.query;
    const books = db.getBooks({ search, tag, sort, order, status });
    res.json(books);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/books/stats', (req, res) => {
  try {
    res.json(db.getReadingStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/books/:id', (req, res) => {
  try {
    const book = db.getBook(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/books/upload', upload.single('book'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    let metadata = {
      title: path.basename(req.file.originalname, ext),
      author: 'Unknown',
      description: '',
      language: 'en',
      publisher: '',
      published_date: '',
      cover_path: ''
    };

    if (ext === '.epub') {
      try {
        const parsed = await epubParser.parse(filePath);
        metadata = { ...metadata, ...parsed.metadata };
        if (parsed.coverPath) {
          metadata.cover_path = parsed.coverPath;
        }
      } catch (parseErr) {
        console.warn('EPUB parse warning:', parseErr.message);
      }
    }

    const bookId = uuidv4();
    const book = db.addBook({
      id: bookId,
      ...metadata,
      file_path: filePath,
      file_name: req.file.originalname,
      file_size: req.file.size,
      format: ext.replace('.', '').toUpperCase()
    });

    res.json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/books/:id', (req, res) => {
  try {
    const book = db.updateBook(req.params.id, req.body);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/books/:id/status', (req, res) => {
  try {
    const { reading_status } = req.body;
    const valid = ['to-read', 'currently-reading', 'finished', 'abandoned'];
    if (!valid.includes(reading_status)) {
      return res.status(400).json({ error: `Invalid status. Valid: ${valid.join(', ')}` });
    }
    const book = db.updateBook(req.params.id, { reading_status });
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/books/:id/rating', (req, res) => {
  try {
    const { my_rating } = req.body;
    if (my_rating < 0 || my_rating > 5) {
      return res.status(400).json({ error: 'Rating must be 0-5' });
    }
    const book = db.updateBook(req.params.id, { my_rating });
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/books/:id', (req, res) => {
  try {
    const book = db.getBook(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    // Delete associated files
    if (book.file_path && fs.existsSync(book.file_path)) {
      fs.unlinkSync(book.file_path);
    }
    if (book.cover_path && fs.existsSync(book.cover_path)) {
      fs.unlinkSync(book.cover_path);
    }

    db.deleteBook(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// EPUB Reader API
// ============================================================
app.get('/api/books/:id/content', async (req, res) => {
  try {
    const book = db.getBook(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    if (book.format === 'EPUB') {
      const chapters = await epubParser.getChapters(book.file_path);
      res.json({ chapters });
    } else if (book.format === 'TXT') {
      const text = fs.readFileSync(book.file_path, 'utf-8');
      res.json({ chapters: [{ title: book.title, content: text }] });
    } else {
      res.json({ chapters: [], message: `Direct reading not supported for ${book.format} format. Download the file instead.` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/books/:id/file', (req, res) => {
  try {
    const book = db.getBook(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.sendFile(path.resolve(book.file_path));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Reading Progress API
// ============================================================
app.get('/api/books/:id/progress', (req, res) => {
  try {
    const progress = db.getProgress(req.params.id);
    res.json(progress || { book_id: req.params.id, position: 0, percentage: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/books/:id/progress', (req, res) => {
  try {
    const { position, percentage, chapter_index } = req.body;
    const progress = db.updateProgress(req.params.id, { position, percentage, chapter_index });
    res.json(progress);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Highlights & Annotations API
// ============================================================
app.get('/api/books/:id/highlights', (req, res) => {
  try {
    const highlights = db.getHighlights(req.params.id);
    res.json(highlights);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/books/:id/highlights', (req, res) => {
  try {
    const { text, note, chapter_index, position, color } = req.body;
    const highlight = db.addHighlight({
      id: uuidv4(),
      book_id: req.params.id,
      text,
      note: note || '',
      chapter_index,
      position,
      color: color || '#ffeb3b'
    });
    res.json(highlight);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/highlights/:id', (req, res) => {
  try {
    db.deleteHighlight(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Tags API
// ============================================================
app.get('/api/tags', (req, res) => {
  try {
    const tags = db.getTags();
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/books/:id/tags', (req, res) => {
  try {
    const { tag } = req.body;
    db.addTag(req.params.id, tag);
    const tags = db.getBookTags(req.params.id);
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/books/:id/tags/:tag', (req, res) => {
  try {
    db.removeTag(req.params.id, req.params.tag);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Audiobook / TTS API
// ============================================================
app.post('/api/books/:id/tts/generate', async (req, res) => {
  try {
    const book = db.getBook(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const { voice, speed, chapter_index } = req.body;

    let text;
    if (book.format === 'EPUB') {
      const chapters = await epubParser.getChapters(book.file_path);
      if (chapter_index !== undefined && chapters[chapter_index]) {
        text = chapters[chapter_index].content;
      } else {
        text = chapters.map(c => c.content).join('\n\n');
      }
    } else if (book.format === 'TXT') {
      text = fs.readFileSync(book.file_path, 'utf-8');
    } else {
      return res.status(400).json({ error: `TTS not supported for ${book.format} format` });
    }

    // Strip HTML tags for TTS
    text = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    const audioPath = await ttsEngine.generate({
      text,
      bookId: req.params.id,
      chapterIndex: chapter_index,
      voice: voice || 'default',
      speed: speed || 1.0
    });

    db.addAudioFile({
      id: uuidv4(),
      book_id: req.params.id,
      chapter_index: chapter_index !== undefined ? chapter_index : -1,
      file_path: audioPath,
      voice: voice || 'default',
      speed: speed || 1.0
    });

    res.json({ audioPath: `/audio/${path.basename(audioPath)}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/books/:id/tts/files', (req, res) => {
  try {
    const files = db.getAudioFiles(req.params.id);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Integrations API
// ============================================================
app.get('/api/integrations/status', (req, res) => {
  res.json(integrations.getStatus());
});

// --- Goodreads ---
app.post('/api/integrations/goodreads/import-csv', upload.single('book'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    const books = integrations.goodreads.parseCSV(csvContent);

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const grBook of books) {
      const existing = db.findBookByGoodreadsId(grBook.goodreads_id) ||
                       db.findBookByTitle(grBook.title);

      if (existing) {
        db.updateBook(existing.id, {
          reading_status: grBook.reading_status,
          my_rating: grBook.my_rating,
          goodreads_id: grBook.goodreads_id,
          pages: grBook.pages,
          date_read: grBook.date_read,
          review: grBook.review
        });
        if (grBook.shelves.length > 0) {
          for (const shelf of grBook.shelves) {
            db.addTag(existing.id, shelf);
          }
        }
        updated++;
      } else {
        const bookId = uuidv4();
        db.addBook({
          id: bookId,
          title: grBook.title,
          author: grBook.author,
          description: grBook.review || '',
          publisher: grBook.publisher,
          file_path: 'goodreads-import',
          file_name: `${grBook.title}.goodreads`,
          file_size: 0,
          format: 'GOODREADS',
          reading_status: grBook.reading_status,
          my_rating: grBook.my_rating,
          goodreads_id: grBook.goodreads_id,
          pages: grBook.pages,
          date_read: grBook.date_read,
          review: grBook.review
        });
        if (grBook.shelves.length > 0) {
          for (const shelf of grBook.shelves) {
            db.addTag(bookId, shelf);
          }
        }
        imported++;
      }
    }

    // Clean up the uploaded CSV
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ok */ }

    res.json({
      success: true,
      imported,
      updated,
      skipped,
      total: books.length,
      stats: integrations.goodreads.getStats(books)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/integrations/goodreads/import-rss', async (req, res) => {
  try {
    const userId = req.body.user_id || process.env.GOODREADS_USER_ID;
    if (!userId) return res.status(400).json({ error: 'Goodreads user ID required' });

    const shelf = req.body.shelf || 'read';
    const books = await integrations.goodreads.fetchShelfRSS(userId, shelf);

    let imported = 0;
    let updated = 0;

    for (const grBook of books) {
      const existing = db.findBookByGoodreadsId(grBook.goodreads_id) ||
                       db.findBookByTitle(grBook.title);

      if (existing) {
        db.updateBook(existing.id, {
          reading_status: grBook.reading_status,
          my_rating: grBook.my_rating,
          goodreads_id: grBook.goodreads_id,
          pages: grBook.pages,
          date_read: grBook.date_read,
          review: grBook.review
        });
        updated++;
      } else {
        const bookId = uuidv4();
        db.addBook({
          id: bookId,
          title: grBook.title,
          author: grBook.author,
          description: grBook.description || '',
          file_path: 'goodreads-import',
          file_name: `${grBook.title}.goodreads`,
          file_size: 0,
          format: 'GOODREADS',
          reading_status: grBook.reading_status,
          my_rating: grBook.my_rating,
          goodreads_id: grBook.goodreads_id,
          pages: grBook.pages,
          date_read: grBook.date_read,
          review: grBook.review
        });
        imported++;
      }
    }

    res.json({
      success: true,
      shelf,
      imported,
      updated,
      total: books.length,
      stats: integrations.goodreads.getStats(books)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/integrations/goodreads/import-all', async (req, res) => {
  try {
    const userId = req.body.user_id || process.env.GOODREADS_USER_ID;
    if (!userId) return res.status(400).json({ error: 'Goodreads user ID required' });

    const allBooks = await integrations.goodreads.fetchAllShelves(userId);

    let imported = 0;
    let updated = 0;

    for (const grBook of allBooks) {
      const existing = db.findBookByGoodreadsId(grBook.goodreads_id) ||
                       db.findBookByTitle(grBook.title);

      if (existing) {
        db.updateBook(existing.id, {
          reading_status: grBook.reading_status,
          my_rating: grBook.my_rating,
          goodreads_id: grBook.goodreads_id,
          pages: grBook.pages,
          date_read: grBook.date_read
        });
        updated++;
      } else {
        const bookId = uuidv4();
        db.addBook({
          id: bookId,
          title: grBook.title,
          author: grBook.author,
          description: grBook.description || '',
          file_path: 'goodreads-import',
          file_name: `${grBook.title}.goodreads`,
          file_size: 0,
          format: 'GOODREADS',
          reading_status: grBook.reading_status,
          my_rating: grBook.my_rating,
          goodreads_id: grBook.goodreads_id,
          pages: grBook.pages,
          date_read: grBook.date_read,
          review: grBook.review || ''
        });
        imported++;
      }
    }

    res.json({
      success: true,
      imported,
      updated,
      total: allBooks.length,
      stats: integrations.goodreads.getStats(allBooks)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Readwise ---
app.post('/api/integrations/readwise/sync', async (req, res) => {
  try {
    const { book_id } = req.body;
    const book = db.getBook(book_id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const highlights = db.getHighlights(book_id);
    const result = await integrations.readwise.syncHighlights(book, highlights);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/integrations/readwise/import', async (req, res) => {
  try {
    const result = await integrations.readwise.importHighlights();

    let importedHighlights = 0;
    for (const { book, highlights } of result.data) {
      let existingBook = db.findBookByTitle(book.title);
      if (!existingBook) {
        const bookId = uuidv4();
        db.addBook({
          id: bookId,
          title: book.title,
          author: book.author || 'Unknown',
          description: '',
          file_path: 'readwise-import',
          file_name: `${book.title}.readwise`,
          file_size: 0,
          format: 'READWISE'
        });
        existingBook = db.getBook(bookId);
      }

      for (const h of highlights) {
        try {
          db.addHighlight({
            id: uuidv4(),
            book_id: existingBook.id,
            text: h.text,
            note: h.note || '',
            chapter_index: 0,
            position: h.location || 0,
            color: h.color || '#ffeb3b',
            source: 'readwise'
          });
          importedHighlights++;
        } catch (e) { /* skip duplicate highlights */ }
      }
    }

    res.json({
      success: true,
      books: result.books,
      totalHighlights: result.totalHighlights,
      importedHighlights
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Readwise → Notion Pipeline ---
app.post('/api/integrations/readwise-to-notion', async (req, res) => {
  try {
    const result = await integrations.readwiseToNotion();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Notion ---
app.post('/api/integrations/notion/sync', async (req, res) => {
  try {
    const { book_id } = req.body;
    const book = db.getBook(book_id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const highlights = db.getHighlights(book_id);
    const progress = db.getProgress(book_id);
    const result = await integrations.notion.syncBook(book, highlights, progress);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/integrations/notion/pages', async (req, res) => {
  try {
    const pages = await integrations.notion.getPages();
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GitHub ---
app.post('/api/integrations/github/sync', async (req, res) => {
  try {
    const { book_id } = req.body;
    const book = db.getBook(book_id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const highlights = db.getHighlights(book_id);
    const progress = db.getProgress(book_id);
    const result = await integrations.github.syncNotes(book, highlights, progress);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Obsidian ---
app.post('/api/integrations/obsidian/sync', async (req, res) => {
  try {
    const { book_id } = req.body;
    const book = db.getBook(book_id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const highlights = db.getHighlights(book_id);
    const progress = db.getProgress(book_id);
    const result = await integrations.obsidian.syncNote(book, highlights, progress);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/integrations/sync-all', async (req, res) => {
  try {
    const { book_id } = req.body;
    const book = db.getBook(book_id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const highlights = db.getHighlights(book_id);
    const progress = db.getProgress(book_id);
    const results = await integrations.syncAll(book, highlights, progress);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// EPUB Conversion API
// ============================================================
app.post('/api/books/:id/convert', async (req, res) => {
  try {
    const book = db.getBook(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const { target_format } = req.body;
    if (!target_format) return res.status(400).json({ error: 'target_format required' });

    if (book.format !== 'EPUB') {
      return res.status(400).json({ error: 'Only EPUB source files are supported for conversion' });
    }

    const result = await epubParser.convert(book.file_path, target_format.toLowerCase());
    res.json({ download_path: `/uploads/${path.basename(result.outputPath)}`, format: target_format });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Start Server
// ============================================================
app.listen(PORT, () => {
  console.log(`BookForge running at http://localhost:${PORT}`);
});
