import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

export function readFixture(name: string): Promise<Buffer> {
  return readFile(fixturePath(name));
}
