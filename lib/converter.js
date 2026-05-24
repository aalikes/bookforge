/**
 * Format Converter — EPUB → PDF, HTML → PDF
 * Uses pdfkit for PDF generation and epub2 for EPUB parsing.
 */
const PDFDocument = require('pdfkit');
const { convert } = require('html-to-text');
const fs = require('fs');
const path = require('path');
const epubParser = require('./epub-parser');

const OUTPUT_DIR = path.join(__dirname, '..', 'conversions');

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Convert EPUB to PDF
 */
async function epubToPdf(epubPath, outputFilename) {
  ensureOutputDir();
  const chapters = await epubParser.getChapters(epubPath);
  if (!chapters || chapters.length === 0) {
    throw new Error('No chapters found in EPUB file');
  }

  const outputPath = path.join(OUTPUT_DIR, outputFilename);
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  // Title page
  const metadata = await epubParser.parse(epubPath);
  doc.fontSize(28).font('Helvetica-Bold')
    .text(metadata.metadata.title || 'Untitled', { align: 'center' });
  doc.moveDown(2);
  doc.fontSize(16).font('Helvetica')
    .text(metadata.metadata.author || 'Unknown Author', { align: 'center' });
  doc.addPage();

  // Chapters
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    if (i > 0) doc.addPage();

    // Chapter title
    doc.fontSize(20).font('Helvetica-Bold')
      .text(chapter.title || `Chapter ${i + 1}`, { align: 'left' });
    doc.moveDown(1);

    // Convert HTML content to plain text for PDF
    const plainText = convert(chapter.content || '', {
      wordwrap: false,
      selectors: [
        { selector: 'img', format: 'skip' },
        { selector: 'a', options: { ignoreHref: true } }
      ]
    });

    doc.fontSize(12).font('Helvetica')
      .text(plainText, { align: 'left', lineGap: 4 });
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

/**
 * Get supported conversion options for a given format
 */
function getConversionOptions(sourceFormat) {
  const options = {
    'EPUB': ['PDF'],
    'TXT': ['PDF'],
    'HTML': ['PDF'],
    'HTM': ['PDF']
  };
  return options[sourceFormat.toUpperCase()] || [];
}

/**
 * Convert a book file to target format
 */
async function convert_book(filePath, sourceFormat, targetFormat, outputFilename) {
  const src = sourceFormat.toUpperCase();
  const tgt = targetFormat.toUpperCase();

  if (src === 'EPUB' && tgt === 'PDF') {
    return epubToPdf(filePath, outputFilename);
  }

  if ((src === 'TXT' || src === 'HTML' || src === 'HTM') && tgt === 'PDF') {
    return textToPdf(filePath, outputFilename);
  }

  throw new Error(`Conversion from ${src} to ${tgt} is not supported`);
}

/**
 * Convert TXT/HTML to PDF
 */
async function textToPdf(filePath, outputFilename) {
  ensureOutputDir();
  const content = fs.readFileSync(filePath, 'utf-8');
  const outputPath = path.join(OUTPUT_DIR, outputFilename);

  const plainText = filePath.endsWith('.txt') ? content : convert(content, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } }
    ]
  });

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  doc.fontSize(12).font('Helvetica')
    .text(plainText, { align: 'left', lineGap: 4 });

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

module.exports = {
  epubToPdf,
  textToPdf,
  convert: convert_book,
  getConversionOptions
};
