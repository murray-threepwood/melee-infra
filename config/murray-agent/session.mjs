import fs from "node:fs";
import path from "node:path";

const EMPTY = {
  slug: "",
  url: "",
  conversationId: "",
  lastTestCommand: "",
  lastMission: "",
  lastJobId: "",
  awaiting_instruction: false,
};

export function createSessionStore({
  filePath = process.env.MURRAY_SESSION_PATH ||
    "/var/lib/murray-agent/session.json",
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
      const row = all[String(chatId)] || {};
      return { ...EMPTY, ...row };
    },
    patch(chatId, fields) {
      const all = load();
      const key = String(chatId);
      all[key] = { ...EMPTY, ...(all[key] || {}), ...fields };
      save(all);
      return all[key];
    },
  };
}
