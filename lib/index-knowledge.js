#!/usr/bin/env node
/**
 * index-knowledge.js — Indexes all knowledge and memory into vector stores
 *
 * Run on startup to populate semantic search indices.
 * Called by start-company.sh or can be run standalone:
 *   node lib/index-knowledge.js
 *
 * This indexes:
 *   - knowledge/shared/*.md → knowledge-shared vector store
 *   - knowledge/{agent}/*.md → knowledge-{agent} vector store
 *   - memory/{agent}/MEMORY.md → memory-{agent} vector store
 */

import semanticSearch from './semantic-search.js';

const AGENTS = [
  'orchestrator', 'architect', 'design', 'frontend', 'backend',
  'smartcontract', 'researcher', 'tester', 'security', 'devops'
];

async function main() {
  console.log('[index-knowledge] Starting knowledge indexing...');
  const startTime = Date.now();

  // Index all knowledge files
  try {
    const knowledgeCount = await semanticSearch.indexKnowledge();
    console.log(`[index-knowledge] Indexed ${knowledgeCount} knowledge chunks`);
  } catch (err) {
    console.warn(`[index-knowledge] Knowledge indexing warning: ${err.message}`);
  }

  // Index all agent memories
  let memoryCount = 0;
  for (const agent of AGENTS) {
    try {
      const count = await semanticSearch.indexMemory(agent);
      if (count > 0) {
        memoryCount += count;
        console.log(`[index-knowledge] Indexed ${count} memory sections for ${agent}`);
      }
    } catch (err) {
      // Memory files may not exist yet — that's fine
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[index-knowledge] Done in ${elapsed}s — ${memoryCount} memory sections indexed`);

  // Print stats
  const stats = semanticSearch.stats();
  const totalDocs = Object.values(stats).reduce((sum, s) => sum + (s.documents || 0), 0);
  console.log(`[index-knowledge] Total documents in vector stores: ${totalDocs}`);

  return { knowledgeCount: totalDocs, memoryCount, elapsed };
}

// Run if called directly
main().catch(err => {
  console.error('[index-knowledge] Fatal error:', err);
  process.exit(1);
});

export default main;
