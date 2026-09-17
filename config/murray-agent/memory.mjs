import fs from "node:fs";
import path from "node:path";

const MAX_MESSAGES = 20;

export function createMemory({
  filePath = process.env.MURRAY_MEMORY_PATH ||
    "/var/lib/murray-agent/memory.json",
} = {}) {
  function load() {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(raw);
      return data && typeof data === "object" ? data : {};
    } catch {
      return {};
    }
  }

  function save(data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
  }

  return {
    get(chatId) {
      const all = load();
      const rows = all[String(chatId)] || [];
      return Array.isArray(rows) ? rows.slice(-MAX_MESSAGES) : [];
    },
    append(chatId, role, content) {
      const all = load();
      const key = String(chatId);
      const rows = Array.isArray(all[key]) ? all[key] : [];
      rows.push({ role, content: String(content ?? "") });
      all[key] = rows.slice(-MAX_MESSAGES);
      save(all);
    },
  };
}
