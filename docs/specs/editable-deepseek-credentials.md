# Spec: Editable DeepSeek credentials launch

## Objective

Let a Harness user edit and rotate the `deepseek-official` API key in the Models page even when Windows or the launching shell defines `DEEPSEEK_API_KEY`.

## Public command

```sh
npx dsh-devkit launch --profile web
```

`--harness <source-checkout>` keeps using `pnpm dsh`; otherwise the existing PATH-first and unversioned npm fallback order remains unchanged.

## Behavior

- Start Harness with `--profile <name>`.
- Copy the launch environment and remove only `DEEPSEEK_API_KEY`, matched case-insensitively on Windows and exactly on POSIX.
- Never read, print, persist, or mutate the removed value.
- Leave every other environment variable unchanged.
- Do not alter direct `dsh` or `npx @deepseek-ai/dsh` launches; the behavior is opt-in through `dsh-devkit launch`.
- Preserve `--dry-run` so users can inspect the command without starting Harness.

## Testing

- Argument parsing accepts `launch`, `--profile`, `--harness`, and `--dry-run`.
- Environment projection handles Windows names case-insensitively, preserves differently cased POSIX names, and never mutates the input object.
- `launch` forwards the selected profile and sanitized environment to the existing Harness runner.
- Existing source-checkout, PATH, and npm fallback tests continue to pass.

## Boundaries

- Never delete or edit user- or machine-scoped environment variables.
- Never expose secret values in output, errors, tests, or dry-run commands.
- Never monkeypatch Harness credential providers or claim to create a security boundary.
- The official launch behavior remains available when an environment-sourced key is intentional, such as CI or a one-run override.

## Success criteria

- A fresh child launched through `dsh-devkit launch` does not inherit `DEEPSEEK_API_KEY`, so Harness reports that credential as writable and can persist a replacement in its managed credential store.
- All repository tests, lint checks, package verification, portability checks, and production dependency audit pass.
