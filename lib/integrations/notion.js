const fetch = require('node-fetch');

const API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function getHeaders() {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) throw new Error('NOTION_API_KEY not configured');
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
  };
}

/**
 * Sync a book to Notion with rich properties.
 * Creates or updates a page in the configured database.
 */
async function syncBook(book, highlights, progress) {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) throw new Error('NOTION_DATABASE_ID not configured');

  const existing = await findExistingPage(databaseId, book.title);

  const properties = {
    'Title': { title: [{ text: { content: book.title } }] },
    'Author': { rich_text: [{ text: { content: book.author || 'Unknown' } }] },
    'Format': { rich_text: [{ text: { content: book.format || '' } }] },
    'Language': { rich_text: [{ text: { content: book.language || 'en' } }] }
  };

  if (progress) {
    properties['Progress'] = { number: progress.percentage || 0 };
  }

  if (book.reading_status) {
    properties['Status'] = { select: { name: formatStatus(book.reading_status) } };
  }

  if (book.my_rating && book.my_rating > 0) {
    properties['Rating'] = { number: book.my_rating };
  }

  if (book.pages) {
    properties['Pages'] = { number: book.pages };
  }

  if (highlights && highlights.length > 0) {
    properties['Highlights'] = { number: highlights.length };
  }

  if (book.date_read) {
    try {
      const d = new Date(book.date_read);
      if (!isNaN(d.getTime())) {
        properties['Date Read'] = { date: { start: d.toISOString().split('T')[0] } };
      }
    } catch (e) { /* skip invalid dates */ }
  }

  const children = buildPageContent(book, highlights);

  let result;
  if (existing) {
    result = await fetch(`${API_BASE}/pages/${existing.id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ properties })
    });

    if (children.length > 0) {
      await appendBlocks(existing.id, children);
    }
  } else {
    result = await fetch(`${API_BASE}/pages`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
        children: children.slice(0, 100)
      })
    });
  }

  if (!result.ok) {
    const text = await result.text();
    throw new Error(`Notion API error: ${result.status} - ${text}`);
  }

  const data = await result.json();
  return { success: true, pageId: data.id, updated: !!existing };
}

/**
 * Sync Readwise highlights for a book directly to Notion.
 * Creates a rich page with all highlights organized by book.
 */
async function syncReadwiseHighlights(bookData, highlights) {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) throw new Error('NOTION_DATABASE_ID not configured');

  const existing = await findExistingPage(databaseId, bookData.title);

  const properties = {
    'Title': { title: [{ text: { content: bookData.title } }] },
    'Author': { rich_text: [{ text: { content: bookData.author || 'Unknown' } }] },
    'Highlights': { number: highlights.length },
    'Source': { rich_text: [{ text: { content: bookData.source || 'Readwise' } }] }
  };

  if (bookData.category) {
    properties['Category'] = { select: { name: bookData.category } };
  }

  const children = [];

  children.push({
    object: 'block',
    type: 'callout',
    callout: {
      icon: { emoji: '📚' },
      rich_text: [{
        text: {
          content: `${highlights.length} highlight${highlights.length !== 1 ? 's' : ''} imported from Readwise`
        }
      }]
    }
  });

  if (bookData.cover_url) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ text: { content: `Cover: ${bookData.cover_url}` } }]
      }
    });
  }

  children.push({
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ text: { content: 'Highlights' } }] }
  });

  for (const h of highlights.slice(0, 80)) {
    children.push({
      object: 'block',
      type: 'quote',
      quote: {
        rich_text: [{ text: { content: h.text.slice(0, 2000) } }],
        color: mapHighlightColor(h.color)
      }
    });

    if (h.note) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            text: { content: `💭 ${h.note.slice(0, 2000)}` },
            annotations: { italic: true, color: 'gray' }
          }]
        }
      });
    }

    if (h.tags && h.tags.length > 0) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            text: { content: `🏷️ ${h.tags.join(', ')}` },
            annotations: { color: 'gray' }
          }]
        }
      });
    }
  }

  let result;
  if (existing) {
    result = await fetch(`${API_BASE}/pages/${existing.id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ properties })
    });
    await appendBlocks(existing.id, children);
  } else {
    result = await fetch(`${API_BASE}/pages`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
        children: children.slice(0, 100)
      })
    });
  }

  if (!result.ok) {
    const text = await result.text();
    throw new Error(`Notion API error: ${result.status} - ${text}`);
  }

  const data = await result.json();
  return { success: true, pageId: data.id, updated: !!existing, highlightCount: highlights.length };
}

/**
 * Query all pages from the Notion database (for import back to BookForge).
 */
async function getPages() {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) throw new Error('NOTION_DATABASE_ID not configured');

  const allPages = [];
  let startCursor;

  do {
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;

    const response = await fetch(`${API_BASE}/databases/${databaseId}/query`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error(`Notion API error: ${response.status}`);
    const data = await response.json();
    allPages.push(...(data.results || []));
    startCursor = data.has_more ? data.next_cursor : null;
  } while (startCursor);

  return allPages.map(page => ({
    notion_id: page.id,
    title: extractTitle(page.properties),
    author: extractText(page.properties, 'Author'),
    status: extractSelect(page.properties, 'Status'),
    rating: extractNumber(page.properties, 'Rating'),
    progress: extractNumber(page.properties, 'Progress'),
    highlights_count: extractNumber(page.properties, 'Highlights'),
    last_edited: page.last_edited_time
  }));
}

// Helper functions

function buildPageContent(book, highlights) {
  const children = [];

  if (book.description) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ text: { content: book.description.slice(0, 2000) } }]
      }
    });
  }

  if (highlights && highlights.length > 0) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: 'Highlights' } }] }
    });

    for (const h of highlights.slice(0, 50)) {
      children.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: [{ text: { content: h.text.slice(0, 2000) } }] }
      });
      if (h.note) {
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ text: { content: `Note: ${h.note.slice(0, 2000)}` } }]
          }
        });
      }
    }
  }

  return children;
}

async function appendBlocks(pageId, blocks) {
  const batches = [];
  for (let i = 0; i < blocks.length; i += 100) {
    batches.push(blocks.slice(i, i + 100));
  }

  for (const batch of batches) {
    const response = await fetch(`${API_BASE}/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ children: batch })
    });
    if (!response.ok) {
      const text = await response.text();
      console.warn(`Notion append blocks warning: ${response.status} - ${text}`);
    }
  }
}

async function findExistingPage(databaseId, title) {
  const response = await fetch(`${API_BASE}/databases/${databaseId}/query`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      filter: { property: 'Title', title: { equals: title } },
      page_size: 1
    })
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data.results && data.results.length > 0 ? data.results[0] : null;
}

function formatStatus(status) {
  switch (status) {
    case 'finished': return 'Finished';
    case 'currently-reading': return 'Currently Reading';
    case 'to-read': return 'To Read';
    case 'abandoned': return 'Abandoned';
    default: return status;
  }
}

function mapHighlightColor(color) {
  const map = {
    'yellow': 'yellow_background',
    'blue': 'blue_background',
    'pink': 'pink_background',
    'orange': 'orange_background'
  };
  return map[(color || '').toLowerCase()] || 'default';
}

function extractTitle(properties) {
  const p = properties['Title'];
  if (!p || !p.title || p.title.length === 0) return '';
  return p.title.map(t => t.plain_text).join('');
}

function extractText(properties, name) {
  const p = properties[name];
  if (!p || !p.rich_text || p.rich_text.length === 0) return '';
  return p.rich_text.map(t => t.plain_text).join('');
}

function extractSelect(properties, name) {
  const p = properties[name];
  return (p && p.select && p.select.name) || '';
}

function extractNumber(properties, name) {
  const p = properties[name];
  return (p && typeof p.number === 'number') ? p.number : 0;
}

module.exports = { syncBook, syncReadwiseHighlights, getPages };
