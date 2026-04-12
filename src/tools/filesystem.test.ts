import {mkdirSync, rmdirSync, rmSync, writeFileSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import process, {chdir} from 'node:process';
import {describe, it, expect, beforeEach, afterEach} from 'bun:test';
import {readFileTool, listDirectoryTool, writeFileTool, deletePathTool, isSafePath} from './filesystem.ts';

let originalCwd: string;
let temporaryDirA: string;
let temporaryDirB: string;

describe('Filesystem Tools', () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    temporaryDirA = mkdtempSync(join(tmpdir(), 'fs-tools-testa-'));
    temporaryDirB = mkdtempSync(join(tmpdir(), 'fs-tools-testb-'));
    chdir(temporaryDirA);
  });

  afterEach(() => {
    chdir(originalCwd);
    rmSync(temporaryDirA, {recursive: true, force: true});
    rmSync(temporaryDirB, {recursive: true, force: true});
  });

  describe('isSafePath', () => {
    it('should return false if path is outside the working dir', () => {
      const file = join(temporaryDirB, 'foo.md');
      const isSafe = isSafePath(file);
      expect(isSafe).toBeFalse();
    });

    it('should return true if path is inside the working dir', () => {
      const file = join(temporaryDirA, 'foo.md');
      const isSafe = isSafePath(file);
      expect(isSafe).toBeTrue();
    });
  });

  describe('readFileTool', () => {
    it('should read the content of an existing file', async () => {
      const fileName = join(temporaryDirA, 'TEST_AGENTS_FILE.md');
      writeFileSync(fileName, '# foo');

      const result = await readFileTool.invoke({path: fileName});

      expect(result).toBe('# foo');
      rmSync(fileName);
    });

    it('should return an error string if the file does not exist', async () => {
      const result = await readFileTool.invoke({path: 'nonexistent.txt'});
      expect(result).toStartWith('Error reading file');
    });
  });

  describe('listDirectoryTool', () => {
    it('should list files and directories correctly', async () => {
      const file = join(temporaryDirA, 'list-files.md');
      writeFileSync(file, '# foo');

      const result = await listDirectoryTool.invoke({path: temporaryDirA});
      expect(result).toContain('[file] list-files.md');

      rmSync(file);
    });

    it('should return an empty string for an empty directory', async () => {
      const dir = join(temporaryDirA, 'emptydir');
      mkdirSync(dir, {recursive: true});
      const result = await listDirectoryTool.invoke({path: 'emptydir'});
      expect(result).toBe('');
      rmdirSync(dir);
    });

    it('should return an error string if the directory does not exist', async () => {
      const result = await listDirectoryTool.invoke({path: '____nonexistentdir'});
      expect(result).toStartWith('Error listing directory');
    });
  });

  describe('writeFileTool', () => {
    it('should write content to a new file and create parent directories', async () => {
      const dir = join(temporaryDirA, 'newdir');
      const file = join(temporaryDirA, 'newdir/newfile.txt');
      const result = await writeFileTool.invoke({path: file, content: 'new content'});
      expect(result).toStartWith('File written');
      rmdirSync(dir, {recursive: true});
    });

    it('should overwrite an existing file', async () => {
      const file = join(temporaryDirA, 'existing.txt');
      writeFileSync('existing.txt', '# foo');
      const result = await writeFileTool.invoke({path: 'existing.txt', content: 'updated content'});
      expect(result).toStartWith('File written');
      rmSync(file);
    });
  });

  describe('deletePathTool', () => {
    it('should delete a file or directory', async () => {
      const file = join(temporaryDirA, 'file_to_delete.txt');
      writeFileSync(file, '# foo');
      const result = await deletePathTool.invoke({path: 'file_to_delete.txt'});
      expect(result).toStartWith('Deleted');
    });
  });
});
