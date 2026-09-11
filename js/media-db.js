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
      mimeType: fileOrBlob.type || (prefix === 'img' ? 'image/jpeg' : 'audio/mpeg'),
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
    if (!base64Data || typeof base64Data !== 'string') {
      throw new Error('Invalid base64 data');
    }
    // If it is a full data URI, use fetch directly
    if (base64Data.startsWith('data:')) {
      const res = await fetch(base64Data);
      return res.blob();
    }
    // Otherwise construct standard data URI with specified defaultMime
    const dataUri = `data:${defaultMime};base64,${base64Data.trim()}`;
    const res = await fetch(dataUri);
    return res.blob();
  }

  // ── 10. IndexedDB Curriculum Table Persistence ───────────────
  async function saveCurriculumRecord(book) {
    const database = getDb();
    if (!database || !book || !book.id) return;
    await database.curriculum.put({
      id: book.id,
      updatedAt: book.updatedAt || Date.now(),
      data: JSON.parse(JSON.stringify(book))
    });
  }

  async function saveAllCurriculaRecords(curriculaList) {
    const database = getDb();
    if (!database || !Array.isArray(curriculaList)) return;
    const records = curriculaList.map(book => ({
      id: book.id,
      updatedAt: book.updatedAt || Date.now(),
      data: JSON.parse(JSON.stringify(book))
    }));
    const newKeys = new Set(records.map(r => r.id));

    // Synchronize keys: delete removed curricula records so deleted books do not resurrect (N5)
    await database.transaction('rw', database.curriculum, async () => {
      const existingKeys = await database.curriculum.toCollection().primaryKeys();
      const toDelete = existingKeys.filter(k => !newKeys.has(k));
      if (toDelete.length > 0) {
        await database.curriculum.bulkDelete(toDelete);
      }
      if (records.length > 0) {
        await database.curriculum.bulkPut(records);
      }
    });
  }

  async function getAllCurriculaRecords() {
    const database = getDb();
    if (!database) return [];
    try {
      const records = await database.curriculum.toArray();
      return records.map(r => r.data).filter(Boolean);
    } catch (e) {
      console.warn('[MediaDB] Failed to load curricula from IndexedDB:', e);
      return [];
    }
  }

  async function deleteCurriculumRecord(bookId) {
    const database = getDb();
    if (!database || !bookId) return;
    await database.curriculum.delete(bookId);
  }

  // ── 11. Cascading Media Deletion & Orphan Pruning ─────────────
  async function deleteCardMedia(card) {
    if (!card) return;
    if (card.image && isMediaId(card.image)) {
      await deleteMedia(card.image);
    }
    if (card.audio && isMediaId(card.audio)) {
      await deleteMedia(card.audio);
    }
  }

  async function deleteUnitMedia(unit) {
    if (!unit) return;
    const cards = [...(unit.words || []), ...(unit.extraWords || []), ...(unit.sightWords || [])];
    for (const card of cards) {
      await deleteCardMedia(card);
    }
  }

  async function deleteCurriculumMedia(book) {
    if (!book || !Array.isArray(book.levels)) return;
    for (const lvl of book.levels) {
      if (Array.isArray(lvl.units)) {
        for (const u of lvl.units) {
          await deleteUnitMedia(u);
        }
      }
    }
  }

  async function pruneOrphanedMedia(curriculaList) {
    const database = getDb();
    if (!database || !Array.isArray(curriculaList)) return;
    try {
      const referenced = new Set();
      curriculaList.forEach(book => {
        (book.levels || []).forEach(lvl => {
          (lvl.units || []).forEach(u => {
            const allCards = [...(u.words || []), ...(u.extraWords || []), ...(u.sightWords || [])];
            allCards.forEach(w => {
              if (isMediaId(w.image)) referenced.add(parseMediaId(w.image));
              if (isMediaId(w.audio)) referenced.add(parseMediaId(w.audio));
            });
          });
        });
      });

      const allKeys = await database.media.toCollection().primaryKeys();
      for (const key of allKeys) {
        if (!referenced.has(key)) {
          await deleteMedia(key);
        }
      }
    } catch (e) {
      console.warn('[MediaDB] Orphan media pruning failed:', e);
    }
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
    base64ToBlob,
    saveCurriculumRecord,
    saveAllCurriculaRecords,
    getAllCurriculaRecords,
    deleteCurriculumRecord,
    deleteCardMedia,
    deleteUnitMedia,
    deleteCurriculumMedia,
    pruneOrphanedMedia
  };
})();
