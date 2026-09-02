# secret/ — SOPS-encrypted repository secrets

Files here (`*.enc.env`) are safe to commit: every value is encrypted with
[SOPS](https://github.com/getsops/sops) against an [age](https://github.com/FiloSottile/age)
public key. Only the key names stay in cleartext; the values do not.

## Prerequisites

Install these before following the steps below (not managed by `.mise.toml` — mise has no
first-party plugin for either):

```sh
brew install sops
brew install --cask 1password-cli   # `op`
```

## The repo also SOPS-encrypts 5 prompt files in place

`CLAUDE.md`, `prompt/instruction/persona.md`, `prompt/instruction/core.md`,
`prompt/instruction/data-driven-execution.md`, `.claude/commands/top5.md` are confidential
prose, not key/value secrets, so they're encrypted whole-file (`sops --input-type binary
--output-type binary`) instead of living in `secret/`. Same age key as everything else here.

```sh
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
sops -d --input-type binary --output-type binary CLAUDE.md   # read
sops --input-type binary --output-type binary CLAUDE.md      # edit (opens plaintext in $EDITOR, re-encrypts on save)
```

**Unlike the retired `git-crypt` setup, nothing decrypts these on checkout.** git-crypt's
clean/smudge filter can't carry over to SOPS (SOPS re-encrypts non-deterministically on every
write, so a filter round-trip would show spurious diffs on every checkout). That means after a
fresh clone, or until you decrypt them, these 5 files — including `CLAUDE.md` itself — show up
as raw SOPS ciphertext to anyone/anything reading them (including Claude Code, which loads
`CLAUDE.md` at session start). **Run the decrypt command above on all 5 files right after
cloning if you need them readable.**

These replace the repo's former `git-crypt` setup (retired 2026-09-02). The old
`designdiff git-crypt key` 1Password item is kept only so old commits that still hold
git-crypt ciphertext can be decrypted if ever needed — it decrypts nothing going forward.

## Decrypt

1. Create the SOPS config directory with owner-only permissions, then pull the private age key
   from 1Password (RITMO vault, item `designdiff SOPS age key (keys.txt)`, id
   `4l77ecm27k65balmyavnwo4ble`) into it:

   ```sh
   mkdir -p -m 700 ~/.config/sops/age
   (umask 077 && op read "op://RITMO/4l77ecm27k65balmyavnwo4ble/credential" > ~/.config/sops/age/keys.txt)
   ```

   (The item title has parentheses in it — `op read op://RITMO/<title>/credential` fails with
   "invalid character in secret reference"; use the item id form above instead.)

   **If `~/.config/sops/age/keys.txt` already holds a different identity** (e.g. the
   `ritmo-corporate SOPSキー`), the command above overwrites it. Fetch into a separate file
   instead and point `SOPS_AGE_KEY_FILE` at it for this repo only:

   ```sh
   mkdir -p -m 700 ~/.config/sops/age
   (umask 077 && op read "op://RITMO/4l77ecm27k65balmyavnwo4ble/credential" > ~/.config/sops/age/designdiff-keys.txt)
   export SOPS_AGE_KEY_FILE=~/.config/sops/age/designdiff-keys.txt
   ```

2. Point SOPS at it and decrypt:

   ```sh
   export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
   sops -d secret/posthog.enc.env
   ```

   Or load straight into your shell for local dev — use `sops exec-env`, not a hand-rolled
   `eval`/`export` pipeline: `secret/posthog.enc.env` decrypts to two leading SOPS comment
   lines, and piping those through `sed 's/^/export /'` turns each into a bare `export` (a
   comment-only line loses its `#...` under `export`'s own word-splitting), which prints every
   variable already exported in your shell — a real information leak, not just noise.

   ```sh
   sops exec-env secret/posthog.enc.env "${SHELL:-/bin/sh}"
   ```

## Edit

```sh
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
sops secret/posthog.enc.env   # opens decrypted in $EDITOR, re-encrypts on save
```

Never hand-edit the ciphertext, and never commit a decrypted copy of these files. `secret/*.env`
(everything except `*.enc.env`) is gitignored as a backstop, but the discipline is: never write
a decrypted copy inside the repo tree at all.

## What's in here

| File | Contents |
| --- | --- |
| `posthog.enc.env` | PostHog Project API Key (`phc_`, US region) as both `POSTHOG_KEY` (desktop build, wired via `electron.vite.config.ts`) and `FIGDIFF_POSTHOG_KEY` (MCP server runtime, wired via `app/mcp-server/src/telemetry.ts` — lands with PR #120 `feat/posthog-telemetry`), plus `POSTHOG_HOST`/`FIGDIFF_POSTHOG_HOST`. Same value is also stored directly in 1Password (RITMO vault, item `designdiff PostHog Project API Key`) for people who don't need the repo copy. |

The recipient key is declared in `.sops.yaml` at the repo root — only holders of the private
age key above can decrypt. This is a project-dedicated key, separate from
`ritmo-corporate SOPSキー` (used elsewhere) and from the repo's retired `git-crypt` setup
(`designdiff git-crypt key` in 1Password, kept only for old commits).
