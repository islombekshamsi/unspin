import { randomBytes } from "node:crypto";
import { access, constants, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError, type BlobStore } from "@/contracts";
import { assertBlobKey } from "./blob-keys";

/**
 * Private filesystem blob store. Files live under `root` (outside public/), are written
 * atomically (temp file + rename) with mode 0600 in 0700 directories, and are addressed
 * only by validated server-generated keys.
 */
export class FilesystemBlobStore implements BlobStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Validates the key, then verifies the resolved path is strictly inside the root. */
  pathFor(key: string): string {
    assertBlobKey(key);
    const resolved = path.resolve(this.root, ...key.split("/"));
    if (!resolved.startsWith(this.root + path.sep)) throw new AppError("internal", "Invalid storage key.");
    return resolved;
  }

  async put(key: string, bytes: Uint8Array) {
    const file = this.pathFor(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(tmp, bytes, { mode: 0o600, flag: "wx" });
      await rename(tmp, file);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw new AppError("persistence_unavailable", "The file could not be stored.", { retryable: true, cause: e });
    }
  }

  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.pathFor(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string) {
    try {
      await unlink(this.pathFor(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  /** Creates the root if needed and checks it is writable; never throws. */
  async ready(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await access(this.root, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}
