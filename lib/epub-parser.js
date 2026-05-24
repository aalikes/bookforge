const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

let EPub;
try {
  EPub = require('epub2').EPub || require('epub2');
} catch (e) {
  EPub = null;
}

async function parse(filePath) {
  if (!EPub) {
    return { metadata: extractBasicMetadata(filePath), coverPath: '' };
  }

  return new Promise((resolve, reject) => {
    const epub = new EPub(filePath);

    epub.on('end', () => {
      const metadata = {
        title: epub.metadata.title || path.basename(filePath, '.epub'),
        author: epub.metadata.creator || 'Unknown',
        description: epub.metadata.description || '',
        language: epub.metadata.language || 'en',
        publisher: epub.metadata.publisher || '',
        published_date: epub.metadata.date || ''
      };

      let coverPath = '';
      if (epub.metadata.cover) {
        try {
          const coverId = epub.metadata.cover;
          epub.getImage(coverId, (err, data, mimeType) => {
            if (!err && data) {
              const ext = mimeType === 'image/png' ? '.png' : '.jpg';
              coverPath = path.join('uploads', `cover-${uuidv4()}${ext}`);
              fs.writeFileSync(coverPath, data);
            }
            resolve({ metadata, coverPath });
          });
          return;
        } catch (coverErr) {
          // Fall through to resolve without cover
        }
      }

      resolve({ metadata, coverPath });
    });

    epub.on('error', (err) => {
      console.warn('EPUB parse error:', err.message);
      resolve({
        metadata: extractBasicMetadata(filePath),
        coverPath: ''
      });
    });

    epub.parse();
  });
}

async function getChapters(filePath) {
  if (!EPub) {
    return [{ title: 'Chapter 1', content: '<p>EPUB reader not available. Install epub2 package.</p>' }];
  }

  return new Promise((resolve, reject) => {
    const epub = new EPub(filePath);

    epub.on('end', () => {
      const flow = epub.flow || [];
      const chapterPromises = flow.map(chapter => {
        return new Promise((chResolve) => {
          epub.getChapter(chapter.id, (err, text) => {
            if (err) {
              chResolve({ title: chapter.title || chapter.id, content: '' });
            } else {
              chResolve({ title: chapter.title || chapter.id, content: text || '' });
            }
          });
        });
      });

      Promise.all(chapterPromises).then(chapters => {
        resolve(chapters.filter(c => c.content.length > 0));
      });
    });

    epub.on('error', () => {
      resolve([]);
    });

    epub.parse();
  });
}

async function convert(filePath, targetFormat) {
  const supportedFormats = ['txt', 'html'];

  if (!supportedFormats.includes(targetFormat)) {
    throw new Error(`Conversion to ${targetFormat} is not supported. Supported: ${supportedFormats.join(', ')}`);
  }

  const chapters = await getChapters(filePath);

  if (targetFormat === 'txt') {
    const text = chapters.map(ch => {
      const title = ch.title ? `\n${'='.repeat(60)}\n${ch.title}\n${'='.repeat(60)}\n\n` : '';
      const content = ch.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return title + content;
    }).join('\n\n');

    const outputPath = path.join('uploads', `converted-${uuidv4()}.txt`);
    fs.writeFileSync(outputPath, text);
    return { outputPath };
  }

  if (targetFormat === 'html') {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Converted Book</title>
  <style>
    body { max-width: 800px; margin: 2rem auto; padding: 0 1rem; font-family: Georgia, serif; line-height: 1.8; color: #333; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
    .chapter { margin-bottom: 3rem; }
    .chapter-title { font-size: 1.5rem; color: #555; margin-top: 2rem; }
  </style>
</head>
<body>
${chapters.map(ch => `
  <div class="chapter">
    ${ch.title ? `<h2 class="chapter-title">${ch.title}</h2>` : ''}
    ${ch.content}
  </div>
`).join('\n')}
</body>
</html>`;

    const outputPath = path.join('uploads', `converted-${uuidv4()}.html`);
    fs.writeFileSync(outputPath, html);
    return { outputPath };
  }
}

function extractBasicMetadata(filePath) {
  return {
    title: path.basename(filePath, path.extname(filePath)),
    author: 'Unknown',
    description: '',
    language: 'en',
    publisher: '',
    published_date: ''
  };
}

module.exports = { parse, getChapters, convert };
