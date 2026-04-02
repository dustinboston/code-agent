/**
 * Document loading utilities for the ingestion pipeline.
 *
 * This module handles reading files from the filesystem and converting them
 * into LangChain `Document` objects that the rest of the pipeline can process.
 * Supported formats are PDF, plain text (.txt), and Markdown (.md / .mdx).
 * PDF loading is delegated to LangChain's `PDFLoader`; text-based formats are
 * read directly with Node's `fs/promises` API.
 */
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { Document } from "@langchain/core/documents";
import { readFile } from "fs/promises";
import { extname } from "path";

// Canonical list of file extensions accepted by `loadDocument`.
const SUPPORTED_FORMATS = [".txt", ".md", ".mdx", ".pdf"];

/**
 * Loads a file from disk and returns its content as an array of `Document` objects.
 *
 * - **PDF**: each page is extracted as a separate `Document` by `PDFLoader`.
 * - **TXT / MD / MDX**: the entire file is read as a single `Document`.
 *
 * @param filePath - Absolute or relative path to the file to load.
 * @returns A promise that resolves to an array of `Document` objects containing
 *   the file's text content and source metadata.
 * @throws {Error} If the file's extension is not in `SUPPORTED_FORMATS`.
 */
export async function loadDocument(filePath: string): Promise<Document[]> {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case ".pdf": {
      const loader = new PDFLoader(filePath);
      return loader.load();
    }
    case ".txt":
    case ".md":
    case ".mdx": {
      const content = await readFile(filePath, "utf-8");
      return [new Document({ pageContent: content, metadata: { source: filePath } })];
    }
    default:
      throw new Error(
        `Unsupported file format: "${ext}". Supported formats: ${SUPPORTED_FORMATS.join(", ")}`
      );
  }
}

/**
 * Maps a file path's extension to a normalized format identifier string.
 *
 * Normalizes aliases to a single label — for example, both `.md` and `.mdx`
 * map to `"md"`. This normalized value is stored in chunk metadata so
 * consumers don't need to handle every raw extension variant.
 *
 * @param filePath - Path to the file (only the extension is examined).
 * @returns A lowercase format string (e.g. `"pdf"`, `"txt"`, `"md"`), or
 *   `"unknown"` if the extension is not recognized.
 */
export function detectFormat(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "pdf",
    ".txt": "txt",
    ".md": "md",
    ".mdx": "md",
  };
  return map[ext] ?? "unknown";
}
