const fetch = require('node-fetch');

const API_BASE = 'https://readwise.io/api/v2';

function getToken() {
  const token = process.env.READWISE_ACCESS_TOKEN;
  if (!token) throw new Error('READWISE_ACCESS_TOKEN not configured');
  return token;
}

function headers() {
  return {
    'Authorization': `Token ${getToken()}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Push highlights from BookForge to Readwise.
 */
async function syncHighlights(book, highlights) {
  if (!highlights || highlights.length === 0) {
    return { success: true, message: 'No highlights to sync', count: 0 };
  }

  const payload = {
    highlights: highlights.map(h => ({
      text: h.text,
      title: book.title,
      author: book.author,
      source_type: 'bookforge',
      category: 'books',
      note: h.note || '',
      highlighted_at: h.created_at
    }))
  };

  const response = await fetch(`${API_BASE}/highlights/`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Readwise API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return { success: true, count: highlights.length, response: data };
}

/**
 * Get all books from Readwise library (paginated).
 */
async function getBooks(category) {
  const allBooks = [];
  let nextUrl = `${API_BASE}/books/?page_size=100${category ? `&category=${category}` : ''}`;

  while (nextUrl) {
    const response = await fetch(nextUrl, { headers: headers() });
    if (!response.ok) throw new Error(`Readwise API error: ${response.status}`);
    const data = await response.json();
    allBooks.push(...(data.results || []));
    nextUrl = data.next;
  }

  return allBooks;
}

/**
 * Pull all highlights from Readwise (paginated).
 * Optionally filter by book_id.
 */
async function getHighlights(bookId) {
  const allHighlights = [];
  let nextUrl = `${API_BASE}/highlights/?page_size=100${bookId ? `&book_id=${bookId}` : ''}`;

  while (nextUrl) {
    const response = await fetch(nextUrl, { headers: headers() });
    if (!response.ok) throw new Error(`Readwise API error: ${response.status}`);
    const data = await response.json();
    allHighlights.push(...(data.results || []));
    nextUrl = data.next;
  }

  return allHighlights;
}

/**
 * Get books with their highlights from Readwise.
 * Returns array of { book, highlights } objects.
 */
async function getBooksWithHighlights() {
  const books = await getBooks('books');
  const allHighlights = await getHighlights();

  const highlightsByBook = {};
  for (const h of allHighlights) {
    const bid = h.book_id;
    if (!highlightsByBook[bid]) highlightsByBook[bid] = [];
    highlightsByBook[bid].push({
      id: h.id,
      text: h.text,
      note: h.note || '',
      location: h.location || 0,
      location_type: h.location_type || '',
      highlighted_at: h.highlighted_at,
      color: h.color || '',
      tags: (h.tags || []).map(t => t.name)
    });
  }

  return books.map(b => ({
    book: {
      readwise_id: b.id,
      title: b.title,
      author: b.author,
      category: b.category,
      source: b.source,
      cover_url: b.cover_image_url,
      highlights_count: b.num_highlights,
      last_highlight_at: b.last_highlight_at
    },
    highlights: highlightsByBook[b.id] || []
  }));
}

/**
 * Import Readwise highlights into BookForge's highlight store.
 * Returns summary of what was imported.
 */
async function importHighlights() {
  const booksWithHighlights = await getBooksWithHighlights();
  return {
    success: true,
    books: booksWithHighlights.length,
    totalHighlights: booksWithHighlights.reduce((sum, bh) => sum + bh.highlights.length, 0),
    data: booksWithHighlights
  };
}

module.exports = {
  syncHighlights,
  getBooks,
  getHighlights,
  getBooksWithHighlights,
  importHighlights
};
