# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |

## Reporting a vulnerability

If you discover a security issue in LeoDomino, please report it privately to the project maintainers. Do not open a public issue for vulnerabilities that could put players at risk.

Include:

- Affected version
- Description of the issue
- Steps to reproduce (if available)
- Impact assessment

## Known advisory (v1.0)

### DevDependency chain: `brace-expansion` (GHSA-mh99-v99m-4gvg)

`npm audit` reports **8 high-severity** findings. They are **one advisory chain**, not eight separate bugs.

**Root cause:** [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) — denial of service via unbounded brace expansion in `brace-expansion`.

**Dependency path (development / build tooling only):**

```
vite-plugin-pwa@1.3.0
  → workbox-build@7.4.1
    → @trickfilm400/rollup-plugin-off-main-thread@3.0.0-pre1
      → ejs@3.1.10
        → jake@10.9.4
          → filelist@1.0.6
            → minimatch@5.1.9
              → brace-expansion@2.1.4   ← vulnerable copy
```

A separate, patched `brace-expansion@5.0.9` already exists elsewhere in the same tree (via `workbox-build` → `glob` → `minimatch@10.x`). Only the nested `2.1.4` copy is flagged.

### Why this is non-blocking for LeoDomino v1.0

- The advisory is confined to **`devDependencies`** (the Vite PWA build stack).
- It does **not** appear in production `dependencies` (`react`, `react-dom`, fonts).
- Shipping Version 1.0 does not require changing the PWA stack or freezing gameplay/engine work around this audit noise.

### Why there is no runtime risk

- `brace-expansion` is **not** shipped in the browser / PWA client bundle.
- Players never execute this code. Offline play, match save, AI, and UI do not call it.
- The vulnerable path is pulled because `ejs` lists `jake` as a dependency; `ejs` itself does not load `jake` / `brace-expansion` for normal template rendering used at build time.
- Exploitation requires feeding malicious brace patterns into `brace-expansion`. That is not an attack surface for end users of LeoDomino.

### Why `npm audit fix --force` is intentionally avoided

- npm’s forced remediation **downgrades** `vite-plugin-pwa` from `1.3.0` to `1.2.0` (labeled a breaking change).
- That would alter the approved PWA stack without fixing a player-facing risk.
- LeoDomino policy for v1.0: **do not modify dependencies** for this advisory; leave the current PWA stack unchanged.

### Accepted stance

Treat the finding as **known, accepted, non-blocking** for Version 1.0 release. Revisit only when upstream publishes stable fixes (see below).

---

## Future Maintenance

### Revisit nested `brace-expansion` advisory

**Status:** Deferred (accepted for v1.0)

**When to revisit:**

- After `workbox-build`, `vite-plugin-pwa`, and/or `@trickfilm400/rollup-plugin-off-main-thread` publish releases that no longer pull vulnerable `brace-expansion` via `ejs` → `jake` → `filelist` → `minimatch@5`.
- Or when a safe, non-force remediation path exists (for example a targeted npm `overrides` pin) that keeps `vite-plugin-pwa@1.3.x` and passes `npm run build` + PWA verification.

**Out of scope until then:**

- No dependency updates solely for this advisory
- No `npm audit fix --force`
- No PWA stack changes
- No gameplay / engine / AI / UI changes related to this item

**Verification when revisited:**

1. `npm audit` (confirm the chain is gone or reduced)
2. `npm run build`
3. Confirm service worker, web manifest, and icons still generate correctly
4. Smoke-test offline install / update behavior
