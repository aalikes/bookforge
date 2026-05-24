const readwise = require('./readwise');
const notion = require('./notion');
const github = require('./github');
const obsidian = require('./obsidian');
const goodreads = require('./goodreads');

function getStatus() {
  return {
    goodreads: {
      configured: !!process.env.GOODREADS_USER_ID,
      name: 'Goodreads',
      description: 'Import shelves, ratings, and reading status from Goodreads'
    },
    readwise: {
      configured: !!process.env.READWISE_ACCESS_TOKEN,
      name: 'Readwise',
      description: 'Sync highlights and reading progress bidirectionally'
    },
    notion: {
      configured: !!(process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID),
      name: 'Notion',
      description: 'Sync book data, highlights, and reading status to a Notion database'
    },
    github: {
      configured: !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO),
      name: 'GitHub',
      description: 'Push reading notes as markdown to a GitHub repo'
    },
    obsidian: {
      configured: !!(process.env.OBSIDIAN_VAULT_PATH || process.env.OBSIDIAN_REST_API_KEY),
      name: 'Obsidian',
      description: 'Sync notes to your Obsidian vault'
    }
  };
}

async function syncAll(book, highlights, progress) {
  const results = {};
  const status = getStatus();

  if (status.readwise.configured) {
    try {
      results.readwise = await readwise.syncHighlights(book, highlights);
    } catch (err) {
      results.readwise = { success: false, error: err.message };
    }
  }

  if (status.notion.configured) {
    try {
      results.notion = await notion.syncBook(book, highlights, progress);
    } catch (err) {
      results.notion = { success: false, error: err.message };
    }
  }

  if (status.github.configured) {
    try {
      results.github = await github.syncNotes(book, highlights, progress);
    } catch (err) {
      results.github = { success: false, error: err.message };
    }
  }

  if (status.obsidian.configured) {
    try {
      results.obsidian = await obsidian.syncNote(book, highlights, progress);
    } catch (err) {
      results.obsidian = { success: false, error: err.message };
    }
  }

  return results;
}

/**
 * Readwise → Notion pipeline: pull highlights from Readwise and push to Notion.
 */
async function readwiseToNotion() {
  const booksWithHighlights = await readwise.getBooksWithHighlights();
  const results = [];

  for (const { book, highlights } of booksWithHighlights) {
    if (highlights.length === 0) continue;
    try {
      const result = await notion.syncReadwiseHighlights(book, highlights);
      results.push({ title: book.title, ...result });
    } catch (err) {
      results.push({ title: book.title, success: false, error: err.message });
    }
  }

  return {
    success: true,
    booksProcessed: results.length,
    totalHighlights: booksWithHighlights.reduce((sum, bh) => sum + bh.highlights.length, 0),
    results
  };
}

module.exports = {
  readwise,
  notion,
  github,
  obsidian,
  goodreads,
  getStatus,
  syncAll,
  readwiseToNotion
};
