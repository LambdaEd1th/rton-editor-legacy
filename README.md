# RTON Editor

Browser editor for PopCap/PvZ2 RTON files. The binary bridge is a small
`wasm-bindgen` crate around `serde_rton`, and the interface is a
React + Vite + TypeScript app styled directly with Tailwind CSS. The central
editor uses CodeMirror 6 with JSON, YAML, and TOML language support.

## Commands

```bash
cd rton-editor
cargo install wasm-pack --version 0.15.0 --locked
npm install
npm run dev
```

Build the static site:

```bash
npm run build
```

The generated site lands in `rton-editor/dist/`.

## WASM Layout

The Rust wrapper crate lives at `wasm/rton-editor-wasm/`, matching the
`pam-viewer` wasm wrapper layout. `npm run build:wasm` writes the generated
wasm-pack package to `src/wasm/rton-editor/`, which is ignored and regenerated
for dev/build.

The wrapper depends on `serde_rton` through the tagged GitHub dependency in
`wasm/rton-editor-wasm/Cargo.toml`.

## RtonValue Editing

RTON files are decoded into a type-preserving RtonValue tree. RTIDs are edited
as strings like `RTID(1a.2b.0000000c@name)`. Binary blobs use the
`$BINARY("HEX", len)` string form. Export can write standard RTON or PvZ2's
compact runtime RTON.

The editor can switch between RTON Hex, JSON, YAML, and TOML views. JSON, YAML,
and TOML are text projections of the same RtonValue tree; YAML/TOML can preserve
non-finite floats that JSON cannot represent.
