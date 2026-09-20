import fs from "node:fs/promises";
import path from "node:path";
import type { Credentials } from "google-auth-library";

/** Owner read/write only. The file holds a refresh token with write access to the channel. */
const TOKEN_FILE_MODE = 0o600;

export class TokenStore {
  constructor(private readonly filePath: string) {}

  get location(): string {
    return this.filePath;
  }

  async read(): Promise<Credentials | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Credentials;
      if (!parsed || typeof parsed !== "object") return null;
      if (!parsed.refresh_token && !parsed.access_token) return null;
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      // A corrupt token file should not be fatal: the server can still run read-only.
      console.error(`[auth] ignoring unreadable token file at ${this.filePath}: ${String(error)}`);
      return null;
    }
  }

  /**
   * Persist credentials with restrictive permissions.
   *
   * `fs.writeFile`'s `mode` only applies when the file is *created*, so an existing file keeps
   * whatever mode it had — including a world-readable 0644 left behind by an older version of
   * this server. The explicit chmod is what actually fixes that case.
   */
  async write(credentials: Credentials): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(credentials, null, 2), {
      mode: TOKEN_FILE_MODE,
    });
    try {
      await fs.chmod(this.filePath, TOKEN_FILE_MODE);
    } catch {
      // Windows and some mounted filesystems do not support chmod; the write still happened.
    }
  }

  /** Merge in refreshed fields without dropping a refresh_token Google omitted from the reply. */
  async merge(update: Credentials): Promise<void> {
    const existing = (await this.read()) ?? {};
    const merged: Credentials = { ...existing, ...update };
    if (!merged.refresh_token && existing.refresh_token) {
      merged.refresh_token = existing.refresh_token;
    }
    await this.write(merged);
  }

  async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }
}
