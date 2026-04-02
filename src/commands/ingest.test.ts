import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ingestCommand } from './ingest.js';
import { loadConfig, validateConfig } from '../config.js';
import * as fs from 'fs'; // Import as namespace
import * as path from 'path'; // Import as namespace
import { ingestFile } from '../ingest/pipeline.js';
import chalk from 'chalk';
import { Command } from 'commander'; // Import Command

// Mock dependencies
vi.mock('../config.js', () => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));
vi.mock('path', () => ({
  resolve: vi.fn((path) => path), // Mock resolve to return the path directly for testing
}));
vi.mock('../ingest/pipeline.js', () => ({
  ingestFile: vi.fn(),
}));
vi.mock('chalk', () => ({
  default: {
    bold: vi.fn((text) => text),
    red: vi.fn((text) => text),
    cyan: vi.fn((text) => text),
    green: vi.fn((text) => text),
  },
}));

describe('ingestCommand', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;
  let processStdoutWriteSpy: any;

  const defaultConfig = {
    pinecone: { indexName: 'test-index', namespace: 'test-namespace' },
    chunking: { strategy: 'recursive', chunkSize: 1000, chunkOverlap: 200 },
  };

  let program: Command; // Declare program here

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    processStdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    chalk.level = 0; // Disable chalk colors for consistent snapshot testing

    program = new Command(); // Create a new Command instance for each test suite
    program.exitOverride(); // Prevent process.exit from terminating the test runner
    program.addCommand(ingestCommand); // Add the ingestCommand as a subcommand

    // Default mock implementations for loadConfig and validateConfig
    vi.mocked(loadConfig).mockImplementation((overrides: any = {}) => {
      return {
        ...defaultConfig,
        chunking: { ...defaultConfig.chunking, ...overrides.chunking },
      } as any;
    });
    vi.mocked(validateConfig).mockReturnValue(undefined);

    // Default mock for ingestFile
    vi.mocked(ingestFile).mockResolvedValue({
      source: 'test-file.md',
      chunkCount: 10,
    } as any);
  });

  it('should ingest a file with default chunking options', async () => {
    const filePath = './docs/test-file.md';
    vi.spyOn(path, 'resolve').mockReturnValue(filePath);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    await program.parseAsync(['node', 'test', 'ingest', filePath]); // Parse with the root program

    expect(path.resolve).toHaveBeenCalledWith(filePath);
    expect(fs.existsSync).toHaveBeenCalledWith(filePath);
    expect(loadConfig).toHaveBeenCalledWith({});
    expect(validateConfig).toHaveBeenCalledTimes(1);
    expect(ingestFile).toHaveBeenCalledWith(filePath, defaultConfig, expect.any(Function));
    expect(consoleLogSpy).toHaveBeenCalledWith('\nRAG Starter — Ingestion\n');
    expect(consoleLogSpy).toHaveBeenCalledWith('  ✔ test-file.md');
    expect(consoleLogSpy).toHaveBeenCalledWith('     10 chunks embedded');
    expect(consoleLogSpy).toHaveBeenCalledWith('     Pinecone index: test-index');
    expect(consoleLogSpy).toHaveBeenCalledWith('     Namespace: test-namespace');
    expect(consoleLogSpy).toHaveBeenCalledWith(); // Expect no arguments for the last console.log()
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should ingest a file with custom chunking options', async () => {
    const filePath = './docs/another.pdf';
    vi.spyOn(path, 'resolve').mockReturnValue(filePath);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const customConfig = {
      ...defaultConfig,
      chunking: { strategy: 'recursive', chunkSize: 500, chunkOverlap: 50 },
    };

    await program.parseAsync(['node', 'test', 'ingest', filePath, '--chunk-size', '500', '--chunk-overlap', '50']);

    expect(path.resolve).toHaveBeenCalledWith(filePath);
    expect(fs.existsSync).toHaveBeenCalledWith(filePath);
    expect(loadConfig).toHaveBeenCalledWith({
      chunking: { strategy: 'recursive', chunkSize: 500, chunkOverlap: 50 },
    });
    expect(validateConfig).toHaveBeenCalledWith(customConfig);
    expect(ingestFile).toHaveBeenCalledWith(filePath, customConfig, expect.any(Function));
  });

  it('should exit with error if file does not exist', async () => {
    const filePath = './non-existent.txt';
    vi.spyOn(path, 'resolve').mockReturnValue(filePath);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    await program.parseAsync(['node', 'test', 'ingest', filePath]);

    expect(path.resolve).toHaveBeenCalledWith(filePath);
    expect(fs.existsSync).toHaveBeenCalledWith(filePath);
    expect(consoleErrorSpy).toHaveBeenCalledWith(`\n✖  File not found: ${filePath}\n`);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should exit with error if ingestion fails', async () => {
    const filePath = './docs/fail.md';
    const errorMessage = 'Ingestion pipeline failed';
    vi.spyOn(path, 'resolve').mockReturnValue(filePath);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.mocked(ingestFile).mockRejectedValue(new Error(errorMessage));

    await program.parseAsync(['node', 'test', 'ingest', filePath]);

    expect(path.resolve).toHaveBeenCalledWith(filePath);
    expect(fs.existsSync).toHaveBeenCalledWith(filePath);
    expect(ingestFile).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(`\n  ✖ Ingestion failed: ${errorMessage}\n`);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should display progress messages during ingestion', async () => {
    const filePath = './docs/progress.md';
    vi.spyOn(path, 'resolve').mockReturnValue(filePath);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    let progressCallback: (msg: string) => void = () => {};
    vi.mocked(ingestFile).mockImplementation((_path: any, _config: any, callback: any) => {
      progressCallback = callback;
      return Promise.resolve({
        source: 'progress.md',
        chunkCount: 5,
      } as any);
    });

    const parsePromise = program.parseAsync(['node', 'test', 'ingest', filePath]);

    // Simulate progress messages
    progressCallback('Loading document');
    progressCallback('Splitting into chunks');
    progressCallback('Embedding chunks');

    await parsePromise;

    // Simplified expectations for process.stdout.write
    expect(processStdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('\r')); // Check for clearLine
    expect(processStdoutWriteSpy).toHaveBeenCalledWith('  → Loading document');
    expect(processStdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('\r')); // Check for clearLine
    expect(processStdoutWriteSpy).toHaveBeenCalledWith('  → Splitting into chunks');
    expect(processStdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('\r')); // Check for clearLine
    expect(processStdoutWriteSpy).toHaveBeenCalledWith('  → Embedding chunks');
    expect(processStdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('\r')); // Check for clearLine
  });
});
