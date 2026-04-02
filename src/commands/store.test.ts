
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeCommand } from './store';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs'; // Import specific functions
import * as config from '../config';
import { Pinecone } from '@pinecone-database/pinecone';
import { resolve, join } from 'path';

// Mock the entire fs module
vi.mock('fs');

// Mock config module
vi.mock('../config', () => ({
  loadConfig: vi.fn(),
}));

// Mock Pinecone client
const mockDeleteAll = vi.fn();
const mockNamespace = vi.fn(() => ({
  deleteAll: mockDeleteAll,
}));
const mockIndex = vi.fn(() => ({
  deleteAll: mockDeleteAll,
  namespace: mockNamespace,
}));
vi.mock('@pinecone-database/pinecone', () => ({
  Pinecone: vi.fn(() => ({
    index: mockIndex,
  })),
}));

describe('storeCommand', () => {
  let consoleLogSpy: any;
  let consoleWarnSpy: any;
  const mockDataDir = '/tmp/test-data';
  const mockDocsDir = resolve(mockDataDir, 'documents');

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Reset and mock implementations for fs functions
    vi.mocked(existsSync).mockReset();
    vi.mocked(readdirSync).mockReset();
    vi.mocked(readFileSync).mockReset();
    vi.mocked(unlinkSync).mockReset();

    // Mock loadConfig to return a consistent config
    vi.mocked(config.loadConfig).mockReturnValue({
      storage: {
        dataDir: mockDataDir,
      },
      pinecone: {
        indexName: 'test-index',
        namespace: 'test-namespace', // Include namespace for testing
      },
    } as any); // Cast to any to avoid strict type checking for partial config

    // Set a mock for process.env.PINECONE_API_KEY
    process.env.PINECONE_API_KEY = 'test-pinecone-api-key';
  });

  describe('store list', () => {
    it('should log "No documents ingested yet." if docs directory does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await storeCommand.parseAsync(['node', 'test', 'list']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No documents ingested yet.'));
      expect(vi.mocked(existsSync)).toHaveBeenCalledWith(mockDocsDir);
      expect(vi.mocked(readdirSync)).not.toHaveBeenCalled();
    });

    it('should log "No documents ingested yet." if docs directory is empty', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([]);

      await storeCommand.parseAsync(['node', 'test', 'list']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No documents ingested yet.'));
      expect(vi.mocked(existsSync)).toHaveBeenCalledWith(mockDocsDir);
      expect(vi.mocked(readdirSync)).toHaveBeenCalledWith(mockDocsDir);
    });

    it('should list ingested documents with their details', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(['doc1.json', 'doc2.json'] as any);
      vi.mocked(readFileSync)
        .mockReturnValueOnce(JSON.stringify({
          source: 'path/to/doc1.txt',
          chunkCount: 5,
          format: 'txt',
          ingestedAt: new Date().toISOString(),
        }))
        .mockReturnValueOnce(JSON.stringify({
          source: 'path/to/doc2.pdf',
          chunkCount: 10,
          format: 'pdf',
          ingestedAt: new Date().toISOString(),
        }));

      await storeCommand.parseAsync(['node', 'test', 'list']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('2 documents in registry:'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('path/to/doc1.txt'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('5 chunks · TXT'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('path/to/doc2.pdf'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('10 chunks · PDF'));
      expect(vi.mocked(readFileSync)).toHaveBeenCalledWith(join(mockDocsDir, 'doc1.json'), 'utf-8');
      expect(vi.mocked(readFileSync)).toHaveBeenCalledWith(join(mockDocsDir, 'doc2.json'), 'utf-8');
    });
  });

  describe('store clear', () => {
    it('should log "Nothing to clear." if docs directory does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await storeCommand.parseAsync(['node', 'test', 'clear']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing to clear.'));
      expect(vi.mocked(existsSync)).toHaveBeenCalledWith(mockDocsDir);
      expect(vi.mocked(readdirSync)).not.toHaveBeenCalled();
      expect(Pinecone).not.toHaveBeenCalled();
      expect(vi.mocked(unlinkSync)).not.toHaveBeenCalled();
    });

    it('should log "Nothing to clear." if docs directory is empty', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([]);

      await storeCommand.parseAsync(['node', 'test', 'clear']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing to clear.'));
      expect(vi.mocked(existsSync)).toHaveBeenCalledWith(mockDocsDir);
      expect(vi.mocked(readdirSync)).toHaveBeenCalledWith(mockDocsDir);
      expect(Pinecone).not.toHaveBeenCalled();
      expect(vi.mocked(unlinkSync)).not.toHaveBeenCalled();
    });

    it('should clear documents from Pinecone (with namespace) and local registry', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(['doc1.json', 'doc2.json'] as any);

      await storeCommand.parseAsync(['node', 'test', 'clear']);

      expect(Pinecone).toHaveBeenCalledWith({ apiKey: 'test-pinecone-api-key' });
      expect(mockIndex).toHaveBeenCalledWith('test-index');
      expect(mockNamespace).toHaveBeenCalledWith('test-namespace');
      expect(mockDeleteAll).toHaveBeenCalledTimes(1); // Called on namespace
      expect(vi.mocked(unlinkSync)).toHaveBeenCalledWith(join(mockDocsDir, 'doc1.json'));
      expect(vi.mocked(unlinkSync)).toHaveBeenCalledWith(join(mockDocsDir, 'doc2.json'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Cleared 2 document records and removed vectors from Pinecone.'));
    });

    it('should clear documents from Pinecone (without namespace) and local registry', async () => {
      // Override config to not have a namespace
      vi.mocked(config.loadConfig).mockReturnValue({
        storage: {
          dataDir: mockDataDir,
        },
        pinecone: {
          indexName: 'test-index',
          // No namespace
        },
      } as any);

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(['doc1.json'] as any);

      await storeCommand.parseAsync(['node', 'test', 'clear']);

      expect(Pinecone).toHaveBeenCalledWith({ apiKey: 'test-pinecone-api-key' });
      expect(mockIndex).toHaveBeenCalledWith('test-index');
      expect(mockNamespace).not.toHaveBeenCalled(); // Namespace should not be called
      expect(mockDeleteAll).toHaveBeenCalledTimes(1); // Called directly on index
      expect(vi.mocked(unlinkSync)).toHaveBeenCalledWith(join(mockDocsDir, 'doc1.json'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Cleared 1 document record and removed vectors from Pinecone.'));
    });

    it('should clear local documents even if Pinecone deletion fails', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(['doc1.json'] as any);
      mockDeleteAll.mockRejectedValueOnce(new Error('Pinecone error')); // Simulate Pinecone failure

      await storeCommand.parseAsync(['node', 'test', 'clear']);

      expect(Pinecone).toHaveBeenCalledWith({ apiKey: 'test-pinecone-api-key' });
      expect(mockIndex).toHaveBeenCalledWith('test-index');
      expect(mockNamespace).toHaveBeenCalledWith('test-namespace');
      expect(mockDeleteAll).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Warning: Pinecone vectors could not be deleted: Pinecone error'));
      expect(vi.mocked(unlinkSync)).toHaveBeenCalledWith(join(mockDocsDir, 'doc1.json'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Cleared 1 local document record.'));
    });
  });
});
