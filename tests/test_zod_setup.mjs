import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, "../config/murray-agent/package.json"));
const { z } = require("zod");

test("zod schema validation operates deterministically in murray-agent stack", () => {
  const schema = z.object({
    id: z.string().min(1),
    status: z.enum(["running", "done", "failed"]),
  });

  const valid = schema.parse({ id: "123", status: "running" });
  assert.equal(valid.id, "123");
  assert.equal(valid.status, "running");

  assert.throws(() => {
    schema.parse({ id: "", status: "unknown" });
  });
});
