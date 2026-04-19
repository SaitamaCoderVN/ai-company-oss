/**
 * semantic-search.js — Semantic search across knowledge base and agent memory
 *
 * Provides unified search interface that combines:
 *   1. Vector similarity search (embeddings)
 *   2. Keyword search (FTS5 fallback)
 *   3. Knowledge base file search
 *
 * Used by:
 *   - Dashboard API (/api/memory/search)
 *   - Agent runner (context enrichment before task execution)
 *   - manage-knowledge.sh search command
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { VectorStore, embed, cosineSimilarity } from './embeddings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = path.resolve(__dirname, '..');

const KNOWLEDGE_DIR = path.join(BASE_DIR, 'knowledge');
const MEMORY_DIR = path.join(BASE_DIR, 'memory');

/**
 * SemanticSearch — Unified search across all agent knowledge and memory
 */
class SemanticSearch {
  constructor() {
    this._stores = new Map(); // namespace → VectorStore
  }

  /**
   * Get or create a VectorStore for a namespace
   */
  _getStore(namespace) {
    if (!this._stores.has(namespace)) {
      this._stores.set(namespace, new VectorStore(namespace));
    }
    return this._stores.get(namespace);
  }

  /**
   * Index all knowledge files into vector stores
   * Call this on startup or after knowledge changes
   */
  async indexKnowledge() {
    let indexed = 0;

    // Index shared knowledge
    const sharedDir = path.join(KNOWLEDGE_DIR, 'shared');
    if (fs.existsSync(sharedDir)) {
      const store = this._getStore('knowledge-shared');
      const files = fs.readdirSync(sharedDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const name = file.replace('.md', '');
        const content = fs.readFileSync(path.join(sharedDir, file), 'utf8');

        // Split into chunks for better search granularity
        const chunks = this._chunkText(content, 500);
        for (let i = 0; i < chunks.length; i++) {
          await store.add(`${name}-chunk-${i}`, chunks[i], {
            source: `knowledge/shared/${file}`,
            type: 'knowledge',
            chunk: i,
            total_chunks: chunks.length,
            name,
          });
          indexed++;
        }
      }
    }

    // Index per-agent knowledge
    const agents = ['orchestrator', 'architect', 'design', 'frontend', 'backend',
      'smartcontract', 'researcher', 'tester', 'security', 'devops'];

    for (const agent of agents) {
      const agentDir = path.join(KNOWLEDGE_DIR, agent);
      if (!fs.existsSync(agentDir)) continue;

      const store = this._getStore(`knowledge-${agent}`);
      const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.md'));

      for (const file of files) {
        const name = file.replace('.md', '');
        const content = fs.readFileSync(path.join(agentDir, file), 'utf8');
        const chunks = this._chunkText(content, 500);

        for (let i = 0; i < chunks.length; i++) {
          await store.add(`${name}-chunk-${i}`, chunks[i], {
            source: `knowledge/${agent}/${file}`,
            type: 'knowledge',
            agent,
            chunk: i,
            name,
          });
          indexed++;
        }
      }
    }

    return indexed;
  }

  /**
   * Index an agent's memory file
   */
  async indexMemory(agentName) {
    const memFile = path.join(MEMORY_DIR, agentName, 'MEMORY.md');
    if (!fs.existsSync(memFile)) return 0;

    const content = fs.readFileSync(memFile, 'utf8');
    if (content.trim().length === 0) return 0;

    const store = this._getStore(`memory-${agentName}`);

    // Split memory by sections (## headings)
    const sections = content.split(/^##\s+/m).filter(s => s.trim().length > 0);
    let indexed = 0;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i].trim();
      const title = section.split('\n')[0].trim();
      await store.add(`memory-section-${i}`, section, {
        source: `memory/${agentName}/MEMORY.md`,
        type: 'memory',
        agent: agentName,
        section: title,
      });
      indexed++;
    }

    return indexed;
  }

  /**
   * Search across all knowledge and memory for an agent
   *
   * Searches in order of priority:
   *   1. Agent-specific knowledge
   *   2. Shared knowledge
   *   3. Agent memory
   *
   * @param {string} query - Search query
   * @param {string} agentName - Agent performing the search
   * @param {{ topK?: number, threshold?: number, includeMemory?: boolean }} options
   * @returns {Promise<{ id: string, score: number, text: string, source: string }[]>}
   */
  async search(query, agentName, options = {}) {
    const { topK = 10, threshold = 0.35, includeMemory = true } = options;

    const allResults = [];

    // 1. Agent-specific knowledge
    const agentStore = this._getStore(`knowledge-${agentName}`);
    if (agentStore.stats().documents > 0) {
      const results = await agentStore.search(query, topK, threshold);
      allResults.push(...results.map(r => ({ ...r, priority: 1 })));
    }

    // 2. Shared knowledge
    const sharedStore = this._getStore('knowledge-shared');
    if (sharedStore.stats().documents > 0) {
      const results = await sharedStore.search(query, topK, threshold);
      allResults.push(...results.map(r => ({ ...r, priority: 2 })));
    }

    // 3. Agent memory
    if (includeMemory) {
      const memStore = this._getStore(`memory-${agentName}`);
      if (memStore.stats().documents > 0) {
        const results = await memStore.search(query, topK, threshold);
        allResults.push(...results.map(r => ({ ...r, priority: 3 })));
      }
    }

    // Deduplicate and sort by score (with priority tiebreaker)
    const seen = new Set();
    return allResults
      .filter(r => {
        const key = r.text.substring(0, 100);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) > 0.05) return scoreDiff;
        return a.priority - b.priority; // Lower priority number = higher priority
      })
      .slice(0, topK);
  }

  /**
   * Get relevant context for an agent about to start a task
   * Returns a formatted string to append to the system prompt
   */
  async getRelevantContext(agentName, taskPrompt, maxTokens = 2000) {
    const results = await this.search(taskPrompt, agentName, {
      topK: 5,
      threshold: 0.4,
      includeMemory: true,
    });

    if (results.length === 0) return '';

    const parts = ['# Relevant Context (from knowledge base)\n'];
    let estimatedTokens = 20;

    for (const result of results) {
      const entry = `## ${result.metadata?.name || result.id} (relevance: ${result.score})\n${result.text}\n`;
      const entryTokens = Math.ceil(entry.length / 4); // rough estimate

      if (estimatedTokens + entryTokens > maxTokens) break;

      parts.push(entry);
      estimatedTokens += entryTokens;
    }

    return parts.join('\n');
  }

  /**
   * Split text into overlapping chunks for better search granularity
   */
  _chunkText(text, chunkSize = 500, overlap = 50) {
    const words = text.split(/\s+/);
    const chunks = [];

    for (let i = 0; i < words.length; i += chunkSize - overlap) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      if (chunk.trim().length > 20) { // Skip tiny chunks
        chunks.push(chunk);
      }
    }

    return chunks.length > 0 ? chunks : [text];
  }

  /**
   * Get stats about all vector stores
   */
  stats() {
    const result = {};
    for (const [ns, store] of this._stores) {
      result[ns] = store.stats();
    }
    return result;
  }
}

export default new SemanticSearch();
