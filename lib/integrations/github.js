const fetch = require('node-fetch');

const API_BASE = 'https://api.github.com';

function getHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };
}

function generateMarkdown(book, highlights, progress) {
  let md = `# ${book.title}\n\n`;
  md += `**Author:** ${book.author}\n`;
  md += `**Format:** ${book.format}\n`;

  if (book.language) md += `**Language:** ${book.language}\n`;
  if (book.publisher) md += `**Publisher:** ${book.publisher}\n`;
  if (book.published_date) md += `**Published:** ${book.published_date}\n`;

  if (progress) {
    md += `\n## Reading Progress\n\n`;
    md += `- **Progress:** ${Math.round(progress.percentage || 0)}%\n`;
    md += `- **Chapter:** ${progress.chapter_index || 0}\n`;
    md += `- **Last Updated:** ${progress.updated_at || 'N/A'}\n`;
  }

  if (book.description) {
    md += `\n## Description\n\n${book.description}\n`;
  }

  if (highlights && highlights.length > 0) {
    md += `\n## Highlights\n\n`;
    for (const h of highlights) {
      md += `> ${h.text}\n\n`;
      if (h.note) md += `*Note: ${h.note}*\n\n`;
      md += `---\n\n`;
    }
  }

  md += `\n---\n*Synced from BookForge on ${new Date().toISOString()}*\n`;
  return md;
}

async function syncNotes(book, highlights, progress) {
  const repo = process.env.GITHUB_REPO;
  if (!repo) throw new Error('GITHUB_REPO not configured');

  const markdown = generateMarkdown(book, highlights, progress);
  const safeName = book.title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
  const filePath = `reading-notes/${safeName}.md`;

  // Check if file exists
  let sha;
  try {
    const existing = await fetch(`${API_BASE}/repos/${repo}/contents/${filePath}`, {
      headers: getHeaders()
    });
    if (existing.ok) {
      const data = await existing.json();
      sha = data.sha;
    }
  } catch (e) {
    // File doesn't exist
  }

  const body = {
    message: `Update reading notes: ${book.title}`,
    content: Buffer.from(markdown).toString('base64'),
    branch: 'main'
  };

  if (sha) body.sha = sha;

  const response = await fetch(`${API_BASE}/repos/${repo}/contents/${filePath}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return {
    success: true,
    path: filePath,
    url: data.content ? data.content.html_url : null,
    updated: !!sha
  };
}

module.exports = { syncNotes, generateMarkdown };
