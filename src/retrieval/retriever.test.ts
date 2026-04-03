import { describe, it, expect, vi } from 'vitest';
import { retrieve } from './retriever.js';
import { PineconeStore } from '@langchain/pinecone';
import { Document } from '@langchain/core/documents';
import type { AppConfig } from '../types.js';

describe('retrieve', () => {
  const mockConfig: AppConfig = {
    llm: {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 1000,
    },
    planner: {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1000,
    },
    developer: {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1000,
    },
    tester: {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1000,
    },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-ada-002',
      dimensions: 1536,
    },
    pinecone: {
      indexName: 'test-index',
      namespace: 'test-namespace',
    },
    chunking: {
      strategy: 'recursive',
      chunkSize: 1000,
      chunkOverlap: 200,
      batchSize: 1000, // Added batchSize
    },
    retrieval: {
      topK: 3,
      scoreThreshold: 0.7,
    },
    storage: {
      dataDir: './data',
    },
  };

  it('should format context and sources correctly with results', async () => {
    const mockDocsWithScore: [Document, number][] = [
      [new Document({ pageContent: 'content 1', metadata: { source: 'source1.txt' } }), 0.8],
      [new Document({ pageContent: 'content 2', metadata: { source: 'source2.txt' } }), 0.7],
      [new Document({ pageContent: 'content 3', metadata: {} }), 0.6], // Test missing source
    ];

    const mockStore = {
      similaritySearchWithScore: vi.fn().mockResolvedValue(mockDocsWithScore),
    } as unknown as PineconeStore;

    const query = 'test query';
    const result = await retrieve(mockStore, query, mockConfig);

    expect(mockStore.similaritySearchWithScore).toHaveBeenCalledWith(query, mockConfig.retrieval.topK);
    expect(result.context).toContain(`[Source 1: source1.txt — relevance: 80%]
content 1`);
    expect(result.context).toContain(`[Source 2: source2.txt — relevance: 70%]
content 2`);
    expect(result.context).toContain(`[Source 3: unknown — relevance: 60%]
content 3`);
    expect(result.sources).toEqual([
      { content: 'content 1', source: 'source1.txt', score: 0.8 },
      { content: 'content 2', source: 'source2.txt', score: 0.7 },
      { content: 'content 3', source: 'unknown', score: 0.6 },
    ]);
  });

  it('should return fallback message when no results are found', async () => {
    const mockStore = {
      similaritySearchWithScore: vi.fn().mockResolvedValue([]),
    } as unknown as PineconeStore;

    const query = 'test query';
    const result = await retrieve(mockStore, query, mockConfig);

    expect(mockStore.similaritySearchWithScore).toHaveBeenCalledWith(query, mockConfig.retrieval.topK);
    expect(result.context).toBe('No documents have been ingested yet. Run `code-agent ingest <path>` first.');
    expect(result.sources).toEqual([]);
  });
});
