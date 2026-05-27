import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import { existsSync, statSync } from "fs"
import { rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

type RequestInitLite = {
  method?: string
  body?: BodyInit
}

function request(route: string, directory: string, query?: Record<string, string>, init?: RequestInitLite) {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(url, {
      method: init?.method,
      body: init?.body,
      headers: {
        "x-opencode-directory": directory,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
    }),
    context,
  )
}

function mkdirRequest(directory: string, body: unknown) {
  return request(FilePaths.mkdir, directory, undefined, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("file HttpApi", () => {
  test("serves read endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "hello")

    const [list, content, status] = await Promise.all([
      request(FilePaths.list, tmp.path, { path: "." }),
      request(FilePaths.content, tmp.path, { path: "hello.txt" }),
      request(FilePaths.status, tmp.path),
    ])

    expect(list.status).toBe(200)
    expect(await list.json()).toContainEqual(
      expect.objectContaining({ name: "hello.txt", path: "hello.txt", type: "file" }),
    )

    expect(content.status).toBe(200)
    expect(await content.json()).toMatchObject({ type: "text", content: "hello" })

    expect(status.status).toBe(200)
    expect(await status.json()).toContainEqual({ path: "hello.txt", added: 1, removed: 0, status: "added" })
  })

  test("serves search endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "needle")

    const [text, files, symbols] = await Promise.all([
      request(FilePaths.findText, tmp.path, { pattern: "needle" }),
      request(FilePaths.findFile, tmp.path, { query: "hello", type: "file" }),
      request(FilePaths.findSymbol, tmp.path, { query: "hello" }),
    ])

    expect(text.status).toBe(200)
    expect(await text.json()).toContainEqual(expect.objectContaining({ line_number: 1 }))

    expect(files.status).toBe(200)
    expect(await files.json()).toContain("hello.txt")

    expect(symbols.status).toBe(200)
    expect(await symbols.json()).toEqual([])
  })
})

describe("file HttpApi mkdir", () => {
  test("creates a new directory inside the instance", async () => {
    await using tmp = await tmpdir({ git: true })
    const target = path.join(tmp.path, "new-folder")

    const res = await mkdirRequest(tmp.path, { path: target })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ path: target, created: true })
    expect(statSync(target).isDirectory()).toBe(true)
  })

  test("is idempotent: existing directory reports created=false", async () => {
    await using tmp = await tmpdir({ git: true })
    const target = path.join(tmp.path, "exists-already")
    await Bun.write(path.join(target, ".keep"), "x")

    const res = await mkdirRequest(tmp.path, { path: target })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ path: target, created: false })
  })

  test("rejects path that escapes both project and home", async () => {
    await using tmp = await tmpdir({ git: true })
    // /etc is outside both the test tmp dir and the user's home directory.
    const res = await mkdirRequest(tmp.path, { path: "/etc/opencode-sandbox-test-should-fail" })
    expect(res.status).toBe(403)
    expect(existsSync("/etc/opencode-sandbox-test-should-fail")).toBe(false)
  })

  test("resolves relative paths against the instance directory", async () => {
    await using tmp = await tmpdir({ git: true })

    const res = await mkdirRequest(tmp.path, { path: "subdir-from-relative" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(true)
    expect(body.path).toBe(path.join(tmp.path, "subdir-from-relative"))
    expect(statSync(body.path).isDirectory()).toBe(true)
  })

  test("expands ~ to the user's home directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const home = os.homedir()
    const stamp = "opencode-mkdir-test-" + Math.random().toString(36).slice(2, 8)
    const rel = path.join(".cache", stamp)
    const absolute = path.join(home, rel)

    try {
      const res = await mkdirRequest(tmp.path, { path: `~/${rel}` })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.path).toBe(absolute)
      expect(statSync(absolute).isDirectory()).toBe(true)
    } finally {
      await rm(absolute, { recursive: true, force: true })
    }
  })

  test("rejects an empty or whitespace-only path", async () => {
    await using tmp = await tmpdir({ git: true })
    const res = await mkdirRequest(tmp.path, { path: "   " })
    expect(res.status).toBe(400)
  })

  test("rejects when an existing file is in the way", async () => {
    await using tmp = await tmpdir({ git: true })
    const target = path.join(tmp.path, "conflict.txt")
    await writeFile(target, "I am a file")

    const res = await mkdirRequest(tmp.path, { path: target })
    expect(res.status).toBe(400)
  })
})
