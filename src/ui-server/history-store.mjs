import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_ITEMS = 20;

export class HistoryStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, "history.json");
    this.state = { items: [] };
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.state = {
        items: Array.isArray(parsed.items) ? parsed.items : [],
      };
    } catch {
      this.state = { items: [] };
      await this.persist();
    }
    this.loaded = true;
  }

  async persist() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }

  async add(item) {
    await this.load();
    this.state.items = [item, ...this.state.items].slice(0, DEFAULT_MAX_ITEMS);
    await this.persist();
  }

  async list() {
    await this.load();
    return [...this.state.items];
  }
}
