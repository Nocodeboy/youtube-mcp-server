import fs from "node:fs/promises";
import path from "node:path";

export type AuditEntry = {
  timestamp: string;
  tool: string;
  outcome: "allowed" | "blocked" | "failed";
  target?: Record<string, unknown>;
  detail?: string;
};

/**
 * Append-only local record of every mutating call.
 *
 * Writes here change a real YouTube channel and are driven by a model that may have read
 * untrusted text (video comments, descriptions) earlier in the same context. When something
 * unexpected shows up on the channel, this file is the only way to reconstruct what the
 * server actually did and when.
 *
 * Logging must never take down a write that already succeeded, so failures are swallowed
 * after one warning on stderr.
 */
export class AuditLog {
  constructor(private readonly filePath: string) {}

  async record(entry: Omit<AuditEntry, "timestamp">): Promise<void> {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, line, { mode: 0o600 });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[audit] could not write to ${this.filePath}: ${reason}`);
    }
  }
}
