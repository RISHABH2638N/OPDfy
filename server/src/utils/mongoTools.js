import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Database Tools >=100.3 accept a YAML config; JSON is valid YAML.
// Keep credentials out of process arguments and remove the private file afterwards.
export function runMongoTool(command, uri, args, execute = spawnSync) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opd-mongo-tool-"));
  const config = path.join(directory, "connection.yml");
  try {
    fs.writeFileSync(config, JSON.stringify({ uri }), { flag: "wx", mode: 0o600 });
    return execute(command, ["--config", config, ...args], {
      stdio: "pipe", encoding: "utf8", timeout: 30 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024, windowsHide: true, shell: false,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
