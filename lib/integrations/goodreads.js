const fetch = require('node-fetch');
const { parse } = require('csv-parse/sync');
const { parseStringPromise } = require('xml2js');

/**
 * Goodreads Integration
 *
 * Since Goodreads retired their API (Dec 2020), we support:
 * 1. CSV import — user exports from goodreads.com/review/import
 * 2. RSS feed — pull shelves via public RSS (goodreads.com/review/list_rss/USER_ID)
 * 3. Profile scrape — basic shelf counts from public profile
 */

const RSS_BASE = 'https://www.goodreads.com/review/list_rss';

/**
 * Parse a Goodreads CSV export into structured book data.
 * Goodreads CSV columns: Book Id, Title, Author, Author l-f, Additional Authors,
 * ISBN, ISBN13, My Rating, Average Rating, Publisher, Binding, Number of Pages,
 * Year Published, Original Publication Year, Date Read, Date Added, Bookshelves,
 * Bookshelves with positions, Exclusive Shelf, My Review, Spoiler, Private Notes,
 * Read Count, Owned Copies
 */
function parseCSV(csvContent) {
  // Goodreads exports ISBNs as ="VALUE" which confuses CSV parsers.
  // Strip the leading = before parsing.
  const cleaned = csvContent.replace(/="([^"]*)"/g, '"$1"');

  const records = parse(cleaned, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true
  });

  return records.map(row => ({
    goodreads_id: row['Book Id'] || '',
    title: row['Title'] || 'Unknown',
    author: row['Author'] || row['Author l-f'] || 'Unknown',
    isbn: (row['ISBN'] || '').replace(/[="]/g, ''),
    isbn13: (row['ISBN13'] || '').replace(/[="]/g, ''),
    my_rating: parseInt(row['My Rating']) || 0,
    average_rating: parseFloat(row['Average Rating']) || 0,
    publisher: row['Publisher'] || '',
    pages: parseInt(row['Number of Pages']) || 0,
    year_published: row['Year Published'] || row['Original Publication Year'] || '',
    date_read: row['Date Read'] || '',
    date_added: row['Date Added'] || '',
    shelves: (row['Bookshelves'] || '').split(',').map(s => s.trim()).filter(Boolean),
    exclusive_shelf: row['Exclusive Shelf'] || '',
    review: row['My Review'] || '',
    private_notes: row['Private Notes'] || '',
    read_count: parseInt(row['Read Count']) || 0,
    reading_status: mapShelfToStatus(row['Exclusive Shelf'] || '')
  }));
}

function mapShelfToStatus(shelf) {
  switch (shelf.toLowerCase().trim()) {
    case 'read': return 'finished';
    case 'currently-reading': return 'currently-reading';
    case 'to-read': return 'to-read';
    default: return 'to-read';
  }
}

/**
 * Fetch a user's shelf via Goodreads RSS feed.
 * @param {string} userId - Goodreads user ID (numeric)
 * @param {string} shelf - Shelf name: read, currently-reading, to-read, or custom
 * @param {number} page - Page number (default 1, 200 items per page)
 */
async function fetchShelfRSS(userId, shelf = 'read', page = 1) {
  if (!userId) throw new Error('GOODREADS_USER_ID not configured');

  const url = `${RSS_BASE}/${userId}?shelf=${encodeURIComponent(shelf)}&page=${page}&per_page=200`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'BookForge/1.0' }
  });

  if (!response.ok) {
    throw new Error(`Goodreads RSS error: ${response.status} — check if user ID ${userId} is valid and profile is public`);
  }

  const xml = await response.text();
  const parsed = await parseStringPromise(xml, { explicitArray: false });
  const channel = parsed.rss && parsed.rss.channel;
  if (!channel || !channel.item) return [];

  const items = Array.isArray(channel.item) ? channel.item : [channel.item];

  return items.map(item => ({
    goodreads_id: item.book_id || '',
    title: cleanTitle(item.title || ''),
    author: item.author_name || 'Unknown',
    isbn: (item.isbn || '').trim(),
    pages: parseInt(item.num_pages) || 0,
    average_rating: parseFloat(item.average_rating) || 0,
    my_rating: parseInt(item.user_rating) || 0,
    date_read: item.user_read_at || '',
    date_added: item.user_date_added || '',
    shelves: (item.user_shelves || '').split(',').map(s => s.trim()).filter(Boolean),
    description: stripHtml(item.book_description || ''),
    cover_url: item.book_large_image_url || item.book_medium_image_url || item.book_small_image_url || '',
    goodreads_url: item.link || '',
    reading_status: mapShelfToStatus(shelf),
    review: stripHtml(item.user_review || '')
  }));
}

/**
 * Fetch all shelves for a user (read, currently-reading, to-read).
 */
async function fetchAllShelves(userId) {
  const shelves = ['read', 'currently-reading', 'to-read'];
  const allBooks = [];
  const seen = new Set();

  for (const shelf of shelves) {
    try {
      const books = await fetchShelfRSS(userId, shelf);
      for (const book of books) {
        const key = book.goodreads_id || book.title;
        if (!seen.has(key)) {
          seen.add(key);
          allBooks.push(book);
        }
      }
    } catch (err) {
      console.warn(`Failed to fetch shelf "${shelf}":`, err.message);
    }
  }

  return allBooks;
}

/**
 * Get reading stats summary from imported Goodreads data.
 */
function getStats(books) {
  const byStatus = { 'finished': 0, 'currently-reading': 0, 'to-read': 0 };
  let totalPages = 0;
  let totalRated = 0;
  let ratingSum = 0;

  for (const b of books) {
    if (byStatus[b.reading_status] !== undefined) byStatus[b.reading_status]++;
    if (b.pages) totalPages += b.pages;
    if (b.my_rating > 0) { totalRated++; ratingSum += b.my_rating; }
  }

  return {
    total: books.length,
    byStatus,
    totalPages,
    averageRating: totalRated > 0 ? (ratingSum / totalRated).toFixed(1) : 0,
    totalRated
  };
}

function cleanTitle(title) {
  return title.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').trim();
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { parseCSV, fetchShelfRSS, fetchAllShelves, getStats, mapShelfToStatus };
