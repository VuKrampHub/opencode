import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useMutation } from "@tanstack/solid-query"
import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { displayPath, expandTilde, joinPath, trimTrailing, validateFolderName } from "@/utils/path"

export interface DialogCreateFolderProps {
  /**
   * Called with the absolute path of the resolved folder. The dialog closes
   * itself before invoking this callback. `created` is `false` if a folder
   * already existed at the resolved path (no-op).
   */
  onCreated: (path: string, info: { created: boolean }) => void
}

type State = {
  parent: string
  name: string
  nameTouched: boolean
}

export function DialogCreateFolder(props: DialogCreateFolderProps) {
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const dialog = useDialog()
  const language = useLanguage()

  const home = createMemo(() => sync.data.path.home || "")
  // The initial parent is the user's home directory; fall back to the active
  // project's directory if the server hasn't sent the home path yet (e.g.
  // remote/headless deployments).
  const defaultParent = createMemo(() => sync.data.path.home || sync.data.path.directory || "")

  const [store, setStore] = createStore<State>({
    parent: defaultParent(),
    name: "",
    nameTouched: false,
  })

  const nameValidation = createMemo(() => validateFolderName(store.name))

  // The inline error stays hidden until the user has interacted with the
  // submit (or left the field blank after typing) to avoid a hostile UI on
  // first render.
  const nameError = createMemo(() => {
    if (!store.nameTouched) return ""
    const v = nameValidation()
    switch (v.kind) {
      case "ok":
        return ""
      case "empty":
        return language.t("dialog.createFolder.error.empty")
      case "invalid-chars":
        return language.t("dialog.createFolder.error.invalid")
      case "reserved":
        return language.t("dialog.createFolder.error.reserved")
      case "dot":
        return language.t("dialog.createFolder.error.dot")
      case "trailing":
        return language.t("dialog.createFolder.error.trailing")
      case "too-long":
        return language.t("dialog.createFolder.error.tooLong")
    }
  })

  // Preview the resolved, normalized absolute path the server will receive.
  // The server expands `~` again — the duplication is deliberate so the
  // preview matches the actual outcome.
  const resolvedPath = createMemo(() => {
    const parent = trimTrailing(expandTilde(store.parent, home()))
    const name = store.name.trim()
    if (!parent || !name) return ""
    return joinPath(parent, name)
  })

  // Render the preview in the same form (absolute vs `~/...`) the user typed,
  // so the path they see is the path they typed.
  const preview = createMemo(() => {
    const full = resolvedPath()
    if (!full) return ""
    return displayPath(full, store.parent, home())
  })

  const mutation = useMutation(() => ({
    mutationFn: async () => {
      const full = resolvedPath()
      // The submit button is disabled when validation fails, but guard here
      // too so a stray keyboard submit can't escape validation.
      if (nameValidation().kind !== "ok" || !full) {
        throw new Error("invalid")
      }
      // Pass the expanded parent as `directory` so InstanceMiddleware can
      // resolve an existing instance; pass the resolved absolute path as
      // `path` so the server doesn't double-resolve a tilde.
      const directory = trimTrailing(expandTilde(store.parent, home()))
      const res = await sdk.client.file.mkdir({ directory, path: full })
      const data = res.data
      if (!data?.path) throw new Error(language.t("dialog.createFolder.error.failed"))
      return data
    },
    onSuccess: (data) => {
      dialog.close()
      props.onCreated(data.path, { created: data.created })
    },
  }))

  // We surface the server error message verbatim only when our own validation
  // accepted the input; "invalid" is the sentinel from mutationFn above.
  const submitError = createMemo(() => {
    const err = mutation.error
    if (!err) return ""
    if (err.message === "invalid") return ""
    return err.message || language.t("dialog.createFolder.error.failed")
  })

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    setStore("nameTouched", true)
    if (mutation.isPending) return
    if (nameValidation().kind !== "ok") return
    mutation.mutate()
  }

  function pickParent() {
    dialog.show(
      () => (
        <DialogSelectDirectory
          title={language.t("dialog.createFolder.parentPickerTitle")}
          onSelect={(result) => {
            if (typeof result === "string") setStore("parent", result)
          }}
        />
      ),
      () => undefined,
    )
  }

  const submitDisabled = createMemo(
    () => mutation.isPending || nameValidation().kind !== "ok" || !store.parent.trim(),
  )

  return (
    <Dialog title={language.t("dialog.createFolder.title")} class="w-full max-w-[480px] mx-auto">
      <form onSubmit={handleSubmit} class="flex flex-col gap-4 p-4">
        <div class="flex items-end gap-2">
          <div class="flex-1 min-w-0">
            <TextField
              type="text"
              label={language.t("dialog.createFolder.parentLabel")}
              placeholder={home() || "/"}
              value={store.parent}
              onChange={(v) => setStore("parent", v)}
              disabled={mutation.isPending}
            />
          </div>
          <Tooltip value={language.t("dialog.createFolder.parentPickerLabel")} placement="top">
            <IconButton
              type="button"
              icon="folder"
              variant="ghost"
              onClick={pickParent}
              disabled={mutation.isPending}
              aria-label={language.t("dialog.createFolder.parentPickerLabel")}
            />
          </Tooltip>
        </div>

        <TextField
          autofocus
          type="text"
          label={language.t("dialog.createFolder.label")}
          placeholder={language.t("dialog.createFolder.placeholder")}
          value={store.name}
          onChange={(v) => {
            setStore("name", v)
            // Hide the inline error while the user is still typing; submit
            // will re-mark touched on its next attempt.
            if (mutation.error) mutation.reset()
          }}
          error={nameError()}
          disabled={mutation.isPending}
        />

        <Show when={preview()}>
          <div class="flex flex-col gap-1">
            <span class="text-12-regular text-text-weak">{language.t("dialog.createFolder.previewLabel")}</span>
            <code class="text-12-mono text-text-strong break-all rounded-md bg-bg-base-base px-2 py-1 border border-border-base-base">
              {preview()}
            </code>
          </div>
        </Show>

        <Show when={submitError()}>
          <p class="text-12-regular text-text-critical" role="alert">
            {submitError()}
          </p>
        </Show>

        <div class="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => dialog.close()} disabled={mutation.isPending}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitDisabled()}>
            {mutation.isPending ? language.t("common.loading") : language.t("dialog.createFolder.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}


