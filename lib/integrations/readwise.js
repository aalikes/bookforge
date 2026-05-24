const fetch = require('node-fetch');

const API_BASE = 'https://readwise.io/api/v2';

async function syncHighlights(book, highlights) {
  const token = process.env.READWISE_ACCESS_TOKEN;
  if (!token) throw new Error('READWISE_ACCESS_TOKEN not configured');

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
    headers: {
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Readwise API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return { success: true, count: highlights.length, response: data };
}

async function getBooks() {
  const token = process.env.READWISE_ACCESS_TOKEN;
  if (!token) throw new Error('READWISE_ACCESS_TOKEN not configured');

  const response = await fetch(`${API_BASE}/books/`, {
    headers: { 'Authorization': `Token ${token}` }
  });

  if (!response.ok) throw new Error(`Readwise API error: ${response.status}`);
  return response.json();
}

module.exports = { syncHighlights, getBooks };
