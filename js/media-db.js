/**
 * Phonics Flash — Media Storage & Blob URL Lifecycle Engine
 * =========================================================
 * Backed by Dexie.js (IndexedDB).
 * Stores binary images, user uploads, and microphone audio recordings safely
 * without exceeding browser localStorage 5MB quota.
 * 
 * Aggressively manages Object URL lifecycles (URL.revokeObjectURL) to prevent
 * memory leaks when reviewing dozens of high-res flashcards.
 */

window.MediaDB = (() => {
  let db = null;

  // ── 1. Blob URL Manager (Aggressive Lifecycle Cleanup) ────────
  class BlobURLManager {
    constructor() {
      this.activeUrls = new Map(); // id -> blobUrl
    }

    get(id, blob) {
      if (!id || !blob) return '';
      if (this.activeUrls.has(id)) {
        return this.activeUrls.get(id);
      }
      const url = URL.createObjectURL(blob);
      this.activeUrls.set(id, url);
      return url;
    }

    revoke(id) {
      if (this.activeUrls.has(id)) {
        const url = this.activeUrls.get(id);
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          console.warn('[BlobURLManager] Error revoking URL:', e);
        }
        this.activeUrls.delete(id);
      }
    }

    revokeAll() {
      for (const [id, url] of this.activeUrls.entries()) {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          console.warn('[BlobURLManager] Error revoking URL:', e);
        }
      }
      const count = this.activeUrls.size;
      this.activeUrls.clear();
      if (count > 0) {
        console.debug(`[BlobURLManager] Revoked ${count} active object URLs.`);
      }
    }
  }

  const urlManager = new BlobURLManager();

  // ── 2. Dexie Database Initialization ────────────────────────
  function getDb() {
    if (db) return db;
    if (typeof Dexie === 'undefined') {
      console.error('[MediaDB] Dexie is not loaded! Ensure dexie.min.js CDN is included.');
      return null;
    }
    db = new Dexie('PhonicsFlashDB');
    db.version(1).stores({
      media: 'id, createdAt, mimeType',
      curriculum: 'id, updatedAt'
    });
    return db;
  }

  // ── 3. Helper: Identify Media URI scheme ─────────────────────
  function isMediaId(str) {
    return typeof str === 'string' && str.startsWith('media:');
  }

  function parseMediaId(str) {
    if (!isMediaId(str)) return str;
    return str.substring('media:'.length);
  }

  // ── 4. Save Binary Blob or File ──────────────────────────────
  /**
   * Save a File or Blob into IndexedDB.
   * @param {Blob|File} fileOrBlob - Binary data
   * @param {string} prefix - 'img' or 'audio'
   * @returns {Promise<string>} Prefixed media URI: e.g. "media:img_1726000000000_abc"
   */
  async function saveMediaBlob(fileOrBlob, prefix = 'img') {
    const database = getDb();
    if (!database) throw new Error('Database not initialized');
    if (!(fileOrBlob instanceof Blob)) {
      throw new Error('Invalid file or blob');
    }

    const id = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const record = {
      id: id,
      blob: fileOrBlob,
      mimeType: fileOrBlob.type || (prefix === 'img' ? 'image/jpeg' : 'audio/mp3'),
      size: fileOrBlob.size,
      createdAt: Date.now()
    };

    await database.media.put(record);
    return `media:${id}`;
  }

  // ── 5. Retrieve Binary Blob ──────────────────────────────────
  async function getMediaBlob(mediaUriOrId) {
    const database = getDb();
    if (!database) return null;
    const rawId = parseMediaId(mediaUriOrId);
    const record = await database.media.get(rawId);
    return record ? record.blob : null;
  }

  // ── 6. Resolve Media URI to Playable/Displayable URL ─────────
  /**
   * Converts a media URI (media:img_...) or plain URL into an active browser URL.
   * If it's already http/https/data/relative, returns as-is.
   * If it's media:..., resolves from Dexie and caches via BlobURLManager.
   */
  async function resolveMediaUrl(uri) {
    if (!uri) return '';
    if (!isMediaId(uri)) return uri;

    const rawId = parseMediaId(uri);
    // Return cached URL if already created
    if (urlManager.activeUrls.has(rawId)) {
      return urlManager.activeUrls.get(rawId);
    }

    const blob = await getMediaBlob(rawId);
    if (!blob) {
      console.warn(`[MediaDB] Blob not found for ID: ${rawId}`);
      return '';
    }

    return urlManager.get(rawId, blob);
  }

  // ── 7. Delete Media Blob ─────────────────────────────────────
  async function deleteMedia(mediaUriOrId) {
    const database = getDb();
    if (!database) return;
    const rawId = parseMediaId(mediaUriOrId);
    urlManager.revoke(rawId);
    await database.media.delete(rawId);
  }

  // ── 8. URL Lifecycle Management ──────────────────────────────
  function revokeMediaUrl(mediaUriOrId) {
    const rawId = parseMediaId(mediaUriOrId);
    urlManager.revoke(rawId);
  }

  function revokeAllUrls() {
    urlManager.revokeAll();
  }

  // ── 9. Convert Data URL or Blob to base64 (for export) ────────
  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function base64ToBlob(base64Data, defaultMime = 'image/png') {
    const res = await fetch(base64Data);
    return res.blob();
  }

  return {
    getDb,
    isMediaId,
    parseMediaId,
    saveMediaBlob,
    getMediaBlob,
    resolveMediaUrl,
    deleteMedia,
    revokeMediaUrl,
    revokeAllUrls,
    blobToBase64,
    base64ToBlob
  };
})();
