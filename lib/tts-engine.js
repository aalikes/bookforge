const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const AUDIO_DIR = path.join(__dirname, '..', 'audio');

const VOICES = {
  default: { name: 'Default (Browser)', type: 'browser' },
  'en-us-male': { name: 'English (US) Male', lang: 'en-US', pitch: 0.9 },
  'en-us-female': { name: 'English (US) Female', lang: 'en-US', pitch: 1.1 },
  'en-gb-male': { name: 'English (UK) Male', lang: 'en-GB', pitch: 0.9 },
  'en-gb-female': { name: 'English (UK) Female', lang: 'en-GB', pitch: 1.1 },
  'fr-female': { name: 'French Female', lang: 'fr-FR', pitch: 1.1 },
  'es-male': { name: 'Spanish Male', lang: 'es-ES', pitch: 0.9 }
};

function getVoices() {
  return Object.entries(VOICES).map(([id, v]) => ({ id, name: v.name }));
}

async function generate({ text, bookId, chapterIndex, voice, speed }) {
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }

  const chapterSuffix = chapterIndex !== undefined && chapterIndex >= 0 ? `-ch${chapterIndex}` : '';
  const filename = `${bookId}${chapterSuffix}-${uuidv4().slice(0, 8)}.json`;
  const outputPath = path.join(AUDIO_DIR, filename);

  // Server-side: generate a TTS manifest that the browser client will use
  // with the Web Speech API. For production, this could use a cloud TTS API.
  const maxChars = 5000;
  const truncatedText = text.length > maxChars ? text.slice(0, maxChars) + '...' : text;

  const manifest = {
    bookId,
    chapterIndex: chapterIndex !== undefined ? chapterIndex : -1,
    voice: voice || 'default',
    speed: speed || 1.0,
    text: truncatedText,
    fullLength: text.length,
    truncated: text.length > maxChars,
    createdAt: new Date().toISOString(),
    type: 'browser-tts-manifest'
  };

  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
  return outputPath;
}

module.exports = { generate, getVoices, VOICES };
