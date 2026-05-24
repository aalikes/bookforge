const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

function generateNote(book, highlights, progress) {
  let md = `---\n`;
  md += `title: "${book.title}"\n`;
  md += `author: "${book.author}"\n`;
  md += `format: "${book.format}"\n`;
  md += `language: "${book.language || 'en'}"\n`;

  if (book.publisher) md += `publisher: "${book.publisher}"\n`;
  if (book.published_date) md += `published: "${book.published_date}"\n`;
  if (progress) md += `progress: ${Math.round(progress.percentage || 0)}\n`;

  md += `synced: "${new Date().toISOString()}"\n`;
  md += `tags:\n  - book\n  - bookforge\n`;
  md += `---\n\n`;

  md += `# ${book.title}\n\n`;
  md += `**Author:** ${book.author}\n\n`;

  if (progress) {
    md += `## Reading Progress\n\n`;
    md += `Progress:: ${Math.round(progress.percentage || 0)}%\n`;
    md += `Chapter:: ${progress.chapter_index || 0}\n\n`;
  }

  if (book.description) {
    md += `## Description\n\n${book.description}\n\n`;
  }

  if (highlights && highlights.length > 0) {
    md += `## Highlights\n\n`;
    for (const h of highlights) {
      md += `> [!quote]\n> ${h.text}\n`;
      if (h.note) md += `>\n> **Note:** ${h.note}\n`;
      md += `\n`;
    }
  }

  return md;
}

async function syncNote(book, highlights, progress) {
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
  const apiKey = process.env.OBSIDIAN_REST_API_KEY;
  const apiUrl = process.env.OBSIDIAN_REST_API_URL;

  const markdown = generateNote(book, highlights, progress);
  const safeName = book.title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');

  // Try local vault first
  if (vaultPath) {
    return syncToLocalVault(vaultPath, safeName, markdown);
  }

  // Try REST API (Local REST API plugin)
  if (apiKey && apiUrl) {
    return syncViaRestApi(apiUrl, apiKey, safeName, markdown);
  }

  throw new Error('No Obsidian sync method configured. Set OBSIDIAN_VAULT_PATH or OBSIDIAN_REST_API_KEY.');
}

function syncToLocalVault(vaultPath, fileName, content) {
  const notesDir = path.join(vaultPath, 'BookForge');
  if (!fs.existsSync(notesDir)) {
    fs.mkdirSync(notesDir, { recursive: true });
  }

  const filePath = path.join(notesDir, `${fileName}.md`);
  const existed = fs.existsSync(filePath);
  fs.writeFileSync(filePath, content, 'utf-8');

  return {
    success: true,
    path: filePath,
    method: 'local',
    updated: existed
  };
}

async function syncViaRestApi(apiUrl, apiKey, fileName, content) {
  const vaultPath = `/BookForge/${fileName}.md`;

  const response = await fetch(`${apiUrl}/vault${vaultPath}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'text/markdown'
    },
    body: content
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Obsidian REST API error: ${response.status} - ${text}`);
  }

  return {
    success: true,
    path: vaultPath,
    method: 'rest-api',
    updated: true
  };
}

module.exports = { syncNote, generateNote };
