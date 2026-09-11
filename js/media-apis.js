/**
 * Phonics Flash — Media APIs & Voice Recorder Engine
 * ==================================================
 * Integrates stock image search, clipart, AI image generation,
 * and microphone audio recording.
 *
 * Sources:
 *  - Wikimedia Commons Clipart (Free, Zero-Key, CORS enabled)
 *  - Pollinations AI (Free, Zero-Key instant generation)
 *  - Pixabay API (Photos & Vectors, free key)
 *  - Unsplash API (High-res photography, free key)
 *  - Google Imagen 3 (Ultra quality AI via Gemini API key)
 *  - Microphone Voice Recorder (HTML5 MediaRecorder)
 */

window.MediaAPIs = (() => {
  const PIXABAY_STORAGE_KEY = 'phonics-flash-pixabay-key';
  const UNSPLASH_STORAGE_KEY = 'phonics-flash-unsplash-key';
  const GEMINI_STORAGE_KEY = 'phonics-flash-gemini-key';

  // ── 1. API Key Helpers ──────────────────────────────────────
  function getPixabayKey() {
    return (localStorage.getItem(PIXABAY_STORAGE_KEY) ||
      (typeof PIXABAY_CONFIG !== 'undefined' ? PIXABAY_CONFIG.apiKey : '') || '').trim();
  }
  function setPixabayKey(val) {
    if (val) localStorage.setItem(PIXABAY_STORAGE_KEY, val.trim());
    else localStorage.removeItem(PIXABAY_STORAGE_KEY);
  }

  function getUnsplashKey() {
    return (localStorage.getItem(UNSPLASH_STORAGE_KEY) ||
      (typeof UNSPLASH_CONFIG !== 'undefined' ? UNSPLASH_CONFIG.accessKey : '') || '').trim();
  }
  function setUnsplashKey(val) {
    if (val) localStorage.setItem(UNSPLASH_STORAGE_KEY, val.trim());
    else localStorage.removeItem(UNSPLASH_STORAGE_KEY);
  }

  function getGeminiKey() {
    return (localStorage.getItem(GEMINI_STORAGE_KEY) ||
      (typeof GEMINI_CONFIG !== 'undefined' ? GEMINI_CONFIG.apiKey : '') || '').trim();
  }
  function setGeminiKey(val) {
    if (val) localStorage.setItem(GEMINI_STORAGE_KEY, val.trim());
    else localStorage.removeItem(GEMINI_STORAGE_KEY);
  }

  // ── 2. Clipart Search (Wikimedia Commons, Zero-Key) ────────
  async function searchClipart(query) {
    if (!query || !query.trim()) return [];
    const term = query.trim();
    // Search Wikimedia Commons with origin=*
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term + ' clipart')}&gsrnamespace=6&format=json&origin=*&prop=imageinfo&iiprop=url|thumburl&iiurlwidth=320&gsrlimit=24`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Wikimedia error: ${res.status}`);
      const data = await res.json();
      if (!data.query || !data.query.pages) return [];

      const results = [];
      for (const pageId of Object.keys(data.query.pages)) {
        const page = data.query.pages[pageId];
        if (page.imageinfo && page.imageinfo[0]) {
          const info = page.imageinfo[0];
          // Filter out svg files without thumbs or non-image files
          if (info.thumburl || info.url) {
            results.push({
              id: pageId,
              title: page.title.replace(/^File:/i, ''),
              thumb: info.thumburl || info.url,
              full: info.url,
              source: 'Wikimedia Commons'
            });
          }
        }
      }
      return results;
    } catch (e) {
      console.warn('[MediaAPIs] Wikimedia clipart search failed:', e);
      return [];
    }
  }

  // ── 3. Free AI Generation (Pollinations, Zero-Key) ──────────
  function getFlashcardPrompt(word) {
    return `Cute colorful cartoon illustration of ${word.trim()} on clean pure white background, educational vector flashcard style, simple bold shapes for children`;
  }

  function generatePollinationsUrl(prompt) {
    const seed = Math.floor(Math.random() * 1000000);
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&seed=${seed}`;
  }

  async function fetchPollinationsImage(prompt) {
    const imgUrl = generatePollinationsUrl(prompt);
    const res = await fetch(imgUrl);
    if (!res.ok) throw new Error('Pollinations generation failed');
    const blob = await res.blob();
    return blob;
  }

  // ── 4. Google Imagen 3 (Gemini API) ─────────────────────────
  async function generateGoogleImagen(prompt, customKey = null) {
    const key = customKey || getGeminiKey();
    if (!key) throw new Error('Google Gemini API Key is required for Imagen 3.');

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(key)}`;

    const payload = {
      instances: [
        { prompt: prompt }
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: '1:1'
      }
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Imagen error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    if (data.predictions && data.predictions[0] && data.predictions[0].bytesBase64Encoded) {
      const base64 = data.predictions[0].bytesBase64Encoded;
      const mime = data.predictions[0].mimeType || 'image/png';
      const dataUrl = `data:${mime};base64,${base64}`;
      const blobRes = await fetch(dataUrl);
      return blobRes.blob();
    }

    throw new Error('No image returned from Google Imagen');
  }

  // ── 5. Pixabay API Search ───────────────────────────────────
  async function searchPixabay(query, customKey = null) {
    const key = customKey || getPixabayKey();
    if (!key) throw new Error('Pixabay API Key is required.');
    if (!query || !query.trim()) return [];

    const url = `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query.trim())}&image_type=all&safesearch=true&per_page=24`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Pixabay error (${res.status})`);
    const data = await res.json();
    if (!data.hits) return [];

    return data.hits.map(hit => ({
      id: hit.id,
      title: hit.tags,
      thumb: hit.previewURL,
      full: hit.webformatURL,
      source: 'Pixabay'
    }));
  }

  // ── 6. Unsplash API Search ──────────────────────────────────
  async function searchUnsplash(query, customKey = null) {
    const key = customKey || getUnsplashKey();
    if (!key) throw new Error('Unsplash Access Key is required.');
    if (!query || !query.trim()) return [];

    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query.trim())}&client_id=${encodeURIComponent(key)}&per_page=24`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Unsplash error (${res.status})`);
    const data = await res.json();
    if (!data.results) return [];

    return data.results.map(photo => ({
      id: photo.id,
      title: photo.alt_description || photo.description || 'Photo',
      thumb: photo.urls.small,
      full: photo.urls.regular,
      source: 'Unsplash'
    }));
  }

  // ── 7. Microphone Voice Recorder (HTML5 MediaRecorder) ──────
  class MicrophoneRecorder {
    constructor() {
      this.mediaRecorder = null;
      this.audioChunks = [];
      this.stream = null;
      this.isRecording = false;
    }

    static isSupported() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    }

    async start() {
      if (!MicrophoneRecorder.isSupported()) {
        throw new Error('Microphone recording is not supported in this browser.');
      }
      this.audioChunks = [];
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Probe best supported MIME type dynamically
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/aac',
        'audio/ogg;codecs=opus',
        'audio/ogg'
      ];
      const supportedType = (typeof MediaRecorder.isTypeSupported === 'function')
        ? candidates.find(type => MediaRecorder.isTypeSupported(type))
        : null;

      this.mimeType = supportedType || 'audio/webm';
      // If supportedType is null (e.g. Safari iOS), pass empty options so browser uses native container
      this.mediaRecorder = new MediaRecorder(this.stream, supportedType ? { mimeType: supportedType } : {});
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(100); // chunk every 100ms
      this.isRecording = true;
    }

    async stop() {
      return new Promise((resolve, reject) => {
        if (!this.mediaRecorder || !this.isRecording) {
          return reject(new Error('Not recording'));
        }

        this.mediaRecorder.onstop = () => {
          const rawMime = this.mediaRecorder.mimeType || this.mimeType || 'audio/webm';
          const mimeType = rawMime.split(';')[0];
          const audioBlob = new Blob(this.audioChunks, { type: mimeType });
          this.isRecording = false;

          // Stop all audio tracks to release microphone
          if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
          }

          resolve(audioBlob);
        };

        this.mediaRecorder.stop();
      });
    }

    cancel() {
      if (this.mediaRecorder && this.isRecording) {
        this.mediaRecorder.stop();
      }
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }
      this.audioChunks = [];
      this.isRecording = false;
    }
  }

  return {
    getPixabayKey,
    setPixabayKey,
    getUnsplashKey,
    setUnsplashKey,
    getGeminiKey,
    setGeminiKey,
    searchClipart,
    getFlashcardPrompt,
    generatePollinationsUrl,
    fetchPollinationsImage,
    generateGoogleImagen,
    searchPixabay,
    searchUnsplash,
    MicrophoneRecorder
  };
})();
