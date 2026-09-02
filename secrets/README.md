# secrets/ — SOPS-encrypted repository secrets

Files here (`*.enc.env`) are safe to commit: every value is encrypted with
[SOPS](https://github.com/getsops/sops) against an [age](https://github.com/FiloSottile/age)
public key. Only the key names stay in cleartext; the values do not.

## The repo also SOPS-encrypts 5 prompt files in place

`CLAUDE.md`, `prompt/instruction/persona.md`, `prompt/instruction/core.md`,
`prompt/instruction/data-driven-execution.md`, `.claude/commands/top5.md` are confidential
prose, not key/value secrets, so they're encrypted whole-file (`sops --input-type binary
--output-type binary`) instead of living in `secrets/`. Same age key as everything else here.

```sh
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
sops -d --input-type binary --output-type binary CLAUDE.md   # read
sops --input-type binary --output-type binary CLAUDE.md      # edit (opens plaintext in $EDITOR, re-encrypts on save)
```

These replace the repo's former `git-crypt` setup (retired 2026-09-02). The old
`designdiff git-crypt key` 1Password item is kept only so old commits that still hold
git-crypt ciphertext can be decrypted if ever needed — it decrypts nothing going forward.

## Decrypt

1. Pull the private age key from 1Password (RITMO vault, item
   `designdiff SOPS age key (keys.txt)`, id `4l77ecm27k65balmyavnwo4ble`):

   ```sh
   op read "op://RITMO/4l77ecm27k65balmyavnwo4ble/credential" > ~/.config/sops/age/keys.txt
   ```

   (The item title has parentheses in it — `op read op://RITMO/<title>/credential` fails with
   "invalid character in secret reference"; use the item id form above instead.)

2. Point SOPS at it and decrypt:

   ```sh
   export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
   sops -d secrets/posthog.enc.env
   ```

   Or export straight into your shell for local dev:

   ```sh
   eval "$(sops -d --output-type dotenv secrets/posthog.enc.env | sed 's/^/export /')"
   ```

## Edit

```sh
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
sops secrets/posthog.enc.env   # opens decrypted in $EDITOR, re-encrypts on save
```

Never hand-edit the ciphertext, and never commit a decrypted copy of these files.

## What's in here

| File | Contents |
| --- | --- |
| `posthog.enc.env` | PostHog Project API Key (`phc_`, US region) as both `POSTHOG_KEY` (desktop build) and `FIGDIFF_POSTHOG_KEY` (MCP server runtime), plus `POSTHOG_HOST`/`FIGDIFF_POSTHOG_HOST`. Same value is also stored directly in 1Password (RITMO vault, item `designdiff PostHog Project API Key`) for people who don't need the repo copy. |

The recipient key is declared in `.sops.yaml` at the repo root — only holders of the private
age key above can decrypt. This is a project-dedicated key, separate from
`ritmo-corporate SOPSキー` (used elsewhere) and from the repo's existing `git-crypt` setup
(`designdiff git-crypt key` in 1Password), which encrypts different files via a different
mechanism (`.gitattributes`-driven, transparent on checkout for anyone with the git-crypt key).
