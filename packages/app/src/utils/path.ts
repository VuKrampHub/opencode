/**
 * Cross-platform path helpers for the web/desktop app.
 *
 * The server normalizes paths server-side, but the UI also needs to:
 *   - render a stable preview of where a created/selected path will live
 *   - validate user-typed paths before submitting
 *   - expand `~` to the user's home directory
 *   - tolerate both POSIX and Windows separators (drag-and-drop, paste,
 *     server responses)
 *
 * These helpers intentionally avoid `node:path` so they work in the browser.
 */

/** Replace `\\` with `/` and collapse repeated separators (preserving UNC `//`). */
export function normalizePath(input: string) {
  const v = input.replaceAll("\\", "/")
  if (v.startsWith("//") && !v.startsWith("///")) return "//" + v.slice(2).replace(/\/+/g, "/")
  return v.replace(/\/+/g, "/")
}

/** Ensure Windows drive roots like `C:` are written as `C:/`. */
export function normalizeDriveRoot(input: string) {
  const v = normalizePath(input)
  if (/^[A-Za-z]:$/.test(v)) return v + "/"
  return v
}

/**
 * Trim a single trailing slash, preserving filesystem roots (`/`, `//`, `C:/`).
 */
export function trimTrailing(input: string) {
  const v = normalizeDriveRoot(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v
  return v.replace(/\/+$/, "")
}

/**
 * Detect the filesystem root prefix for an absolute path.
 * Returns `""` for relative paths.
 */
export function rootOf(input: string) {
  const v = normalizeDriveRoot(input)
  if (v.startsWith("//")) return "//"
  if (v.startsWith("/")) return "/"
  if (/^[A-Za-z]:\//.test(v)) return v.slice(0, 3)
  return ""
}

/** Return the parent directory of `input`. Roots map to themselves. */
export function parentOf(input: string) {
  const v = trimTrailing(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v

  const i = v.lastIndexOf("/")
  if (i <= 0) return "/"
  if (i === 2 && /^[A-Za-z]:/.test(v)) return v.slice(0, 3)
  return v.slice(0, i)
}

/** Join `base` and `rel`, normalizing separators. */
export function joinPath(base: string | undefined, rel: string) {
  const b = trimTrailing(base ?? "")
  const r = trimTrailing(rel).replace(/^\/+/, "")
  if (!b) return r
  if (!r) return b
  if (b.endsWith("/")) return b + r
  return b + "/" + r
}

/** Classify a user-typed path for picker resolution. */
export function modeOf(input: string) {
  const raw = normalizeDriveRoot(input.trim())
  if (!raw) return "relative" as const
  if (raw.startsWith("~")) return "tilde" as const
  if (rootOf(raw)) return "absolute" as const
  return "relative" as const
}

/** Return the tilde-relative form of `absolute` if it's inside `home`. */
export function tildeOf(absolute: string, home: string) {
  const full = trimTrailing(absolute)
  if (!home) return ""

  const hn = trimTrailing(home)
  const lc = full.toLowerCase()
  const hc = hn.toLowerCase()
  if (lc === hc) return "~"
  if (lc.startsWith(hc + "/")) return "~" + full.slice(hn.length)
  return ""
}

/** Choose a display form for `path` based on the user's current input mode. */
export function displayPath(path: string, input: string, home: string) {
  const full = trimTrailing(path)
  if (modeOf(input) === "absolute") return full
  return tildeOf(full, home) || full
}

/** Expand `~` and `~/...` against the user's home directory. */
export function expandTilde(input: string, home: string) {
  const v = input.trim()
  if (!home) return v
  if (v === "~") return home
  if (v.startsWith("~/") || v.startsWith("~\\")) return joinPath(home, v.slice(2))
  return v
}

/**
 * Characters that are illegal in directory names across major platforms.
 * - Control chars (U+0000-U+001F, U+007F): not safe in any filesystem.
 * - `<>:"|?*`: reserved on Windows.
 * - `/` and `\`: directory separators.
 */
export const INVALID_NAME_CHARS = /[<>:"|?*/\\\x00-\x1F\x7F]/

/** Windows-reserved device names that can't be used as a folder name. */
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
])

export type FolderNameValidation =
  | { kind: "ok" }
  | { kind: "empty" }
  | { kind: "invalid-chars" }
  | { kind: "reserved" }
  | { kind: "dot" }
  | { kind: "trailing" }
  | { kind: "too-long" }

/**
 * Validate a single folder name (no path separators allowed). The dialog calls
 * this on every keystroke so it must be fast and total.
 */
export function validateFolderName(raw: string): FolderNameValidation {
  const name = raw.trim()
  if (!name) return { kind: "empty" }
  if (INVALID_NAME_CHARS.test(name)) return { kind: "invalid-chars" }
  if (name === "." || name === "..") return { kind: "dot" }
  // Windows disallows trailing dot or space, and a leading space is at minimum
  // a UX trap that loses the leading whitespace silently.
  if (name.endsWith(".") || name.endsWith(" ") || name !== raw) return { kind: "trailing" }
  // Windows reserved device names (case-insensitive, including with extension).
  const base = name.split(".")[0]?.toLowerCase() ?? ""
  if (WINDOWS_RESERVED_NAMES.has(base)) return { kind: "reserved" }
  // 255 is the typical per-segment cap on ext4/HFS+/NTFS in bytes; we cap on
  // characters as a conservative proxy.
  if (name.length > 255) return { kind: "too-long" }
  return { kind: "ok" }
}
