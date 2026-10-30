import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LeadList } from './types.js';

export class ListStorage {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.ensureFile();
  }

  private ensureFile(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      this.writeLists([]);
    }
  }

  public readLists(): LeadList[] {
    this.ensureFile();
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      if (!raw.trim()) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public writeLists(lists: LeadList[]): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpFile = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(lists, null, 2), 'utf8');
    fs.renameSync(tmpFile, this.filePath);
  }
}
