# Contributing

Use Node.js 22 or newer and npm. Run `npm ci`, then `npm run check` and `npm run package` before submitting a change.

Keep provider-specific behavior under `src/auth`, `src/models`, and `src/transport`; keep pure parsing and resolution logic covered by colocated Node tests. Do not commit `out/`, VSIX files, tokens, prompts, or captured responses.
