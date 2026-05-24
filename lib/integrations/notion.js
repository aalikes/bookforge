const fetch = require('node-fetch');

const API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function getHeaders() {
  const apiKey = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  if (!apiKey) throw new Error('NOTION_TOKEN not configured');
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
  };
}

async function syncBook(book, highlights, progress) {
  const databaseId = process.env.NOTION_BOOKFORGE_DB_ID || process.env.NOTION_DATABASE_ID;
  if (!databaseId) throw new Error('NOTION_BOOKFORGE_DB_ID not configured');

  // Check if page already exists for this book
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
        quote: {
          rich_text: [{ text: { content: h.text.slice(0, 2000) } }]
        }
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

  let result;
  if (existing) {
    result = await fetch(`${API_BASE}/pages/${existing.id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ properties })
    });
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

async function findExistingPage(databaseId, title) {
  const response = await fetch(`${API_BASE}/databases/${databaseId}/query`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      filter: {
        property: 'Title',
        title: { equals: title }
      },
      page_size: 1
    })
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data.results && data.results.length > 0 ? data.results[0] : null;
}

module.exports = { syncBook };
