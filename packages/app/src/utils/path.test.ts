import { describe, expect, test } from "bun:test"
import {
  displayPath,
  expandTilde,
  joinPath,
  modeOf,
  normalizeDriveRoot,
  normalizePath,
  parentOf,
  rootOf,
  tildeOf,
  trimTrailing,
  validateFolderName,
} from "./path"

describe("normalizePath", () => {
  test("collapses repeated forward slashes", () => {
    expect(normalizePath("/a//b///c")).toBe("/a/b/c")
  })

  test("converts backslashes to forward slashes", () => {
    expect(normalizePath("C:\\Users\\foo")).toBe("C:/Users/foo")
  })

  test("preserves UNC double-slash prefix", () => {
    expect(normalizePath("//server//share//x")).toBe("//server/share/x")
  })
})

describe("normalizeDriveRoot", () => {
  test("appends a slash to a bare drive letter", () => {
    expect(normalizeDriveRoot("C:")).toBe("C:/")
  })

  test("leaves rooted drive paths alone", () => {
    expect(normalizeDriveRoot("C:/Users")).toBe("C:/Users")
  })

  test("does not transform non-drive paths", () => {
    expect(normalizeDriveRoot("/etc")).toBe("/etc")
  })
})

describe("trimTrailing", () => {
  test("strips a single trailing slash", () => {
    expect(trimTrailing("/foo/")).toBe("/foo")
  })

  test("preserves root slash", () => {
    expect(trimTrailing("/")).toBe("/")
  })

  test("preserves UNC root", () => {
    expect(trimTrailing("//")).toBe("//")
  })

  test("preserves drive root", () => {
    expect(trimTrailing("C:/")).toBe("C:/")
  })
})

describe("rootOf", () => {
  test("returns / for POSIX absolute paths", () => {
    expect(rootOf("/etc/foo")).toBe("/")
  })

  test("returns // for UNC paths", () => {
    expect(rootOf("//srv/share")).toBe("//")
  })

  test("returns the drive root for Windows paths", () => {
    expect(rootOf("C:/Users")).toBe("C:/")
  })

  test("returns empty string for relative paths", () => {
    expect(rootOf("foo/bar")).toBe("")
  })
})

describe("parentOf", () => {
  test("returns parent for POSIX paths", () => {
    expect(parentOf("/foo/bar")).toBe("/foo")
  })

  test("returns / when stripping the last segment under root", () => {
    expect(parentOf("/foo")).toBe("/")
  })

  test("preserves drive root", () => {
    expect(parentOf("C:/foo")).toBe("C:/")
  })

  test("returns root for the root itself", () => {
    expect(parentOf("/")).toBe("/")
    expect(parentOf("//")).toBe("//")
  })
})

describe("joinPath", () => {
  test("joins with a single separator", () => {
    expect(joinPath("/foo", "bar")).toBe("/foo/bar")
  })

  test("strips trailing slash on base", () => {
    expect(joinPath("/foo/", "bar")).toBe("/foo/bar")
  })

  test("strips leading slash on relative segment", () => {
    expect(joinPath("/foo", "/bar")).toBe("/foo/bar")
  })

  test("handles Windows drive base", () => {
    expect(joinPath("C:\\Users\\foo", "my-project")).toBe("C:/Users/foo/my-project")
  })

  test("returns the other side when one is empty", () => {
    expect(joinPath("", "foo")).toBe("foo")
    expect(joinPath("/foo", "")).toBe("/foo")
  })
})

describe("modeOf", () => {
  test("classifies absolute paths", () => {
    expect(modeOf("/foo")).toBe("absolute")
    expect(modeOf("C:/foo")).toBe("absolute")
    expect(modeOf("//srv/share")).toBe("absolute")
  })

  test("classifies tilde paths", () => {
    expect(modeOf("~")).toBe("tilde")
    expect(modeOf("~/projects")).toBe("tilde")
  })

  test("classifies relative paths", () => {
    expect(modeOf("foo")).toBe("relative")
    expect(modeOf("")).toBe("relative")
  })
})

describe("tildeOf", () => {
  test("returns ~ when path equals home", () => {
    expect(tildeOf("/Users/foo", "/Users/foo")).toBe("~")
  })

  test("returns ~/rest when path is inside home", () => {
    expect(tildeOf("/Users/foo/projects/x", "/Users/foo")).toBe("~/projects/x")
  })

  test("returns empty string when outside home", () => {
    expect(tildeOf("/etc", "/Users/foo")).toBe("")
  })

  test("is case-insensitive for matching", () => {
    expect(tildeOf("/Users/Foo/x", "/users/foo")).toBe("~/x")
  })

  test("returns empty string when home is empty", () => {
    expect(tildeOf("/etc", "")).toBe("")
  })
})

describe("displayPath", () => {
  test("returns absolute path when input is absolute", () => {
    expect(displayPath("/Users/foo/x", "/Users/foo/x", "/Users/foo")).toBe("/Users/foo/x")
  })

  test("returns tilde form when input is not absolute", () => {
    expect(displayPath("/Users/foo/x", "~", "/Users/foo")).toBe("~/x")
  })

  test("falls back to absolute when tilde does not apply", () => {
    expect(displayPath("/etc", "relative", "/Users/foo")).toBe("/etc")
  })
})

describe("expandTilde", () => {
  test("expands bare tilde", () => {
    expect(expandTilde("~", "/Users/foo")).toBe("/Users/foo")
  })

  test("expands ~/path", () => {
    expect(expandTilde("~/projects", "/Users/foo")).toBe("/Users/foo/projects")
  })

  test("expands ~\\path on Windows-style input", () => {
    expect(expandTilde("~\\projects", "C:\\Users\\foo")).toBe("C:/Users/foo/projects")
  })

  test("leaves non-tilde input untouched (trimmed)", () => {
    expect(expandTilde("  /etc/foo  ", "/Users/foo")).toBe("/etc/foo")
  })

  test("returns input as-is when home is empty", () => {
    expect(expandTilde("~/x", "")).toBe("~/x")
  })
})

describe("validateFolderName", () => {
  test("accepts a normal name", () => {
    expect(validateFolderName("my-project").kind).toBe("ok")
  })

  test("rejects empty / whitespace-only names", () => {
    expect(validateFolderName("").kind).toBe("empty")
    expect(validateFolderName("   ").kind).toBe("empty")
  })

  test("rejects invalid characters", () => {
    expect(validateFolderName("a/b").kind).toBe("invalid-chars")
    expect(validateFolderName("a\\b").kind).toBe("invalid-chars")
    expect(validateFolderName("a?b").kind).toBe("invalid-chars")
    expect(validateFolderName("a:b").kind).toBe("invalid-chars")
  })

  test("rejects . and ..", () => {
    expect(validateFolderName(".").kind).toBe("dot")
    expect(validateFolderName("..").kind).toBe("dot")
  })

  test("rejects leading or trailing whitespace and trailing dot", () => {
    expect(validateFolderName(" leading").kind).toBe("trailing")
    expect(validateFolderName("trailing ").kind).toBe("trailing")
    expect(validateFolderName("trailing.").kind).toBe("trailing")
  })

  test("rejects Windows reserved device names regardless of case or extension", () => {
    expect(validateFolderName("con").kind).toBe("reserved")
    expect(validateFolderName("COM1").kind).toBe("reserved")
    expect(validateFolderName("NUL.txt").kind).toBe("reserved")
  })

  test("rejects overly long names", () => {
    expect(validateFolderName("x".repeat(256)).kind).toBe("too-long")
  })

  test("accepts hidden folders", () => {
    expect(validateFolderName(".hidden").kind).toBe("ok")
  })
})
