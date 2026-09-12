# App-tools authentication

This packaging repair restores the native `codex_app` tools, including `read_thread`, in the separately signed Modex app. It applies to every mod selection and is not an optional UI mod.

Stock Codex authenticates the tool connection's peer, parent, and grandparent against OpenAI's signing identity. The bundled Node and CLI retain their vendor signatures, but the outer Modex app has the user's Developer ID. Stock therefore rejects the connection with `untrusted-code-signing-identity`, and the MCP server reports `Codex app tools pipe closed` before exposing its tools.

The repair leaves the vendor authorizer unchanged. Only the dynamic app-tools pipe receives a fallback for that exact rejection. The fallback requires:

- A valid OpenAI-signed `node` peer, identified through the socket audit token.
- A valid OpenAI-signed `codex` parent.
- The current server process as the grandparent, with a valid signature matching the bundle ID and signing team embedded during packaging.
- Stable process ancestry and signatures throughout validation.

Missing identities, invalid descriptors, unrelated ancestors, changed signatures, and native errors remain denied. The existing stock success path is preserved. There is no environment-variable trust override. Browser and Computer Use authorization are unchanged.

`compatibility.json` gates the stock main bundle, native authorizer, CLI, and Node bytes. The transform changes one uniquely matched app-tools call site after the selected UI mods compose. Packaging compiles a separate Node-API addon, signs it with the same selected Developer ID, and seals it into the new app. The original vendor binaries are not modified.

The transform locates the app-tools entrypoint by its ordered `callTool`, `listTools`, `pipePath`, and `socketPeerAuthorizer` parameter contract, capturing the zero-argument factory instead of hardcoding minified names. Tests exercise real source and renamed bindings. Missing, ambiguous, already-patched, or changed parameter contracts fail closed. Manual verification uses the baseline version and byte gates; `update` and `--current-source` inspect current stock while retaining signatures, structural contracts, and native process-chain validation.

The 26.903.71938 (8576) adaptation changed binding names while preserving the stock factory's descriptor validation, packaged-mode checks, and native call contract. Its vendor authorizer's machine code and constant/string sections match build 8109; Node and CLI still carry the OpenAI team with identifiers `node` and `codex`. Real-bundle tests also check that the separate host-services and browser-use call sites keep their stock defaults. For a newer build, verify the actual native contract and process chain rather than assuming those earlier binary comparisons still apply.

Build requirements: macOS Command Line Tools (`xcrun clang++`) and Node development headers installed under `/opt/homebrew/include/node` or `/usr/local/include/node`. The addon uses stable Node-API version 8. Run the normal root verifier and preparation commands; preparation `--check` validates these prerequisites before producing an app. Unsigned inspection packaging also requires the intended Developer ID so the compiled identity is concrete.

Run `bun test mods/app-tools-auth` for adapter and native tests. Signed process-chain tests additionally require the configured Developer ID. Verify a staged app with an isolated profile before adoption: the `codex_app` MCP server must become ready and expose `read_thread`; merely loading the addon or passing a code-signature check is insufficient.

```sh
bun mods/app-tools-auth/verify-native.mjs \
  --node /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node \
  --codex /Applications/ChatGPT.app/Contents/Resources/codex \
  --signing-identity "$CODEX_MODS_SIGN_IDENTITY"
```

The signed verifier uses disposable copies and an isolated profile. It checks a successful vendor process chain and rejects the wrong host bundle, host team, peer signature, parent signature, and unrelated ancestor. It does not alter the installed app. The root verifier supplies the selected stock source to the real-bundle adapter test; that test is skipped in a plain test run without `APP_TOOLS_AUTH_SOURCE`.

Set `APP_TOOLS_AUTH_PREVIOUS_ARCHIVE` to a pristine build 8109 `app.asar` when running the test suite to exercise the same transform against the previous real bundle as well. Vendor archives stay outside the repository.
