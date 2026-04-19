/**
 * embeddings.js — Local vector embeddings for AI Agent Company
 *
 * Uses @xenova/transformers to run embedding models locally on CPU/GPU.
 * No API keys needed, no network dependency, runs on M4 Pro.
 *
 * Model: all-MiniLM-L6-v2 (384 dimensions, ~23MB, very fast)
 * - Good balance of quality and speed for knowledge/memory search
 * - First load downloads model (~23MB), then cached locally
 *
 * Usage:
 *   import { embed, embedBatch, cosineSimilarity, searchByVector } from './embeddings.js';
 *
 *   const vec = await embed("How to handle JWT auth?");
 *   const results = searchByVector(vec, storedVectors, topK=5);
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Vector storage path
const VECTOR_STORE_DIR = path.join(__dirname, '..', 'data', 'vectors');

// Lazy-loaded pipeline
let _pipeline = null;
let _pipelineLoading = null;

/**
 * Get or initialize the embedding pipeline (lazy singleton)
 * First call downloads model (~23MB), subsequent calls use cache
 */
async function getPipeline() {
  if (_pipeline) return _pipeline;

  if (_pipelineLoading) return _pipelineLoading;

  _pipelineLoading = (async () => {
    try {
      // Dynamic import to avoid issues if not installed
      const { pipeline } = await import('@xenova/transformers');

      console.log('[embeddings] Loading model: all-MiniLM-L6-v2...');
      _pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        // Cache models in the project directory
        cache_dir: path.join(__dirname, '..', 'data', 'models'),
      });
      console.log('[embeddings] Model loaded successfully');
      return _pipeline;
    } catch (error) {
      // Fallback: if @xenova/transformers not installed, use simple TF-IDF-like vectors
      console.warn('[embeddings] @xenova/transformers not available, using fallback hash vectors');
      console.warn('[embeddings] Install for real embeddings: npm install @xenova/transformers');
      _pipeline = 'fallback';
      return _pipeline;
    }
  })();

  return _pipelineLoading;
}

/**
 * Generate embedding vector for a single text
 * @param {string} text - Input text
 * @returns {Promise<Float32Array>} - Embedding vector (384 dims or 128 dims for fallback)
 */
export async function embed(text) {
  const pipe = await getPipeline();

  if (pipe === 'fallback') {
    return fallbackEmbed(text);
  }

  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return output.data;
}

/**
 * Generate embeddings for multiple texts (batched for efficiency)
 * @param {string[]} texts - Array of input texts
 * @returns {Promise<Float32Array[]>} - Array of embedding vectors
 */
export async function embedBatch(texts) {
  const pipe = await getPipeline();

  if (pipe === 'fallback') {
    return texts.map(t => fallbackEmbed(t));
  }

  const results = [];
  // Process in batches of 32 for memory efficiency
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    for (const text of batch) {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      results.push(output.data);
    }
  }
  return results;
}

/**
 * Compute cosine similarity between two vectors
 * @param {Float32Array|number[]} a
 * @param {Float32Array|number[]} b
 * @returns {number} - Similarity score between -1 and 1
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Search for most similar vectors in a collection
 * @param {Float32Array} queryVec - Query embedding
 * @param {{ id: string, vector: Float32Array|number[], text?: string }[]} collection
 * @param {number} topK - Number of results to return
 * @param {number} threshold - Minimum similarity score (0-1)
 * @returns {{ id: string, score: number, text?: string }[]}
 */
export function searchByVector(queryVec, collection, topK = 5, threshold = 0.3) {
  const scored = collection.map(item => ({
    id: item.id,
    score: cosineSimilarity(queryVec, item.vector),
    text: item.text || '',
  }));

  return scored
    .filter(item => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// =============================================================================
// Vector Store — Persistent storage for embedded documents
// =============================================================================

/**
 * VectorStore — File-based vector database for knowledge and memory
 *
 * Stores vectors as JSON files in data/vectors/{namespace}/
 * Each namespace is an agent or "shared"
 */
export class VectorStore {
  constructor(namespace = 'shared') {
    this.namespace = namespace;
    this.storePath = path.join(VECTOR_STORE_DIR, namespace);
    this.indexPath = path.join(this.storePath, '_index.json');
    this._index = null;
  }

  /**
   * Ensure store directory exists and load index
   */
  _ensureStore() {
    if (!fs.existsSync(this.storePath)) {
      fs.mkdirSync(this.storePath, { recursive: true });
    }

    if (!this._index) {
      if (fs.existsSync(this.indexPath)) {
        this._index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      } else {
        this._index = { documents: [], version: 1, updated_at: null };
      }
    }
  }

  _saveIndex() {
    this._index.updated_at = new Date().toISOString();
    fs.writeFileSync(this.indexPath, JSON.stringify(this._index, null, 2));
  }

  /**
   * Add a document to the vector store
   * @param {string} id - Unique document ID
   * @param {string} text - Document text
   * @param {{ source?: string, type?: string, agent?: string }} metadata
   */
  async add(id, text, metadata = {}) {
    this._ensureStore();

    const vector = await embed(text);

    // Store vector as separate file (for large collections)
    const vecFile = path.join(this.storePath, `${id}.vec.json`);
    fs.writeFileSync(vecFile, JSON.stringify({
      id,
      vector: Array.from(vector),
      text: text.substring(0, 500), // Preview
      metadata,
      created_at: new Date().toISOString(),
    }));

    // Update index
    const existing = this._index.documents.findIndex(d => d.id === id);
    const entry = {
      id,
      text_preview: text.substring(0, 100),
      metadata,
      dimensions: vector.length,
    };

    if (existing >= 0) {
      this._index.documents[existing] = entry;
    } else {
      this._index.documents.push(entry);
    }

    this._saveIndex();
    return { id, dimensions: vector.length };
  }

  /**
   * Remove a document from the vector store
   */
  remove(id) {
    this._ensureStore();

    const vecFile = path.join(this.storePath, `${id}.vec.json`);
    if (fs.existsSync(vecFile)) {
      fs.unlinkSync(vecFile);
    }

    this._index.documents = this._index.documents.filter(d => d.id !== id);
    this._saveIndex();
  }

  /**
   * Search for similar documents
   * @param {string} query - Search query text
   * @param {number} topK - Number of results
   * @param {number} threshold - Minimum similarity
   * @returns {Promise<{ id: string, score: number, text: string, metadata: object }[]>}
   */
  async search(query, topK = 5, threshold = 0.3) {
    this._ensureStore();

    if (this._index.documents.length === 0) return [];

    const queryVec = await embed(query);

    // Load all vectors
    const collection = [];
    for (const doc of this._index.documents) {
      const vecFile = path.join(this.storePath, `${doc.id}.vec.json`);
      if (fs.existsSync(vecFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(vecFile, 'utf8'));
          collection.push({
            id: data.id,
            vector: data.vector,
            text: data.text,
            metadata: data.metadata,
          });
        } catch {}
      }
    }

    const results = searchByVector(queryVec, collection, topK, threshold);

    // Enrich with metadata
    return results.map(r => {
      const doc = collection.find(c => c.id === r.id);
      return {
        id: r.id,
        score: Math.round(r.score * 1000) / 1000,
        text: doc?.text || '',
        metadata: doc?.metadata || {},
      };
    });
  }

  /**
   * Get stats about the store
   */
  stats() {
    this._ensureStore();
    return {
      namespace: this.namespace,
      documents: this._index.documents.length,
      updated_at: this._index.updated_at,
    };
  }

  /**
   * Re-embed all documents (call after model change)
   */
  async reindex() {
    this._ensureStore();

    let count = 0;
    for (const doc of this._index.documents) {
      const vecFile = path.join(this.storePath, `${doc.id}.vec.json`);
      if (fs.existsSync(vecFile)) {
        const data = JSON.parse(fs.readFileSync(vecFile, 'utf8'));
        if (data.text) {
          const vector = await embed(data.text);
          data.vector = Array.from(vector);
          data.dimensions = vector.length;
          fs.writeFileSync(vecFile, JSON.stringify(data));
          count++;
        }
      }
    }
    return count;
  }
}

// =============================================================================
// Fallback embedding (when @xenova/transformers not installed)
// Uses character-level hashing to create pseudo-vectors.
// Not semantically meaningful, but enables the API to work.
// =============================================================================

function fallbackEmbed(text) {
  const DIM = 128;
  const vec = new Float32Array(DIM);
  const normalized = text.toLowerCase().trim();

  // Simple character n-gram hashing
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    for (let d = 0; d < 4; d++) {
      const idx = ((code * (i + 1) * (d + 7)) % DIM + DIM) % DIM;
      vec[idx] += 1.0 / (1 + Math.log(1 + i));
    }

    // Bigrams
    if (i < normalized.length - 1) {
      const code2 = normalized.charCodeAt(i + 1);
      const idx = ((code * 31 + code2 * 37) % DIM + DIM) % DIM;
      vec[idx] += 0.5;
    }
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) vec[i] /= norm;
  }

  return vec;
}

export default { embed, embedBatch, cosineSimilarity, searchByVector, VectorStore };
