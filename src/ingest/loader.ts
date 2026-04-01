import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { Document } from "@langchain/core/documents";
import { readFile } from "fs/promises";
import { extname } from "path";

const SUPPORTED_FORMATS = [".txt", ".md", ".mdx", ".pdf"];

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
