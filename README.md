# RTON Editor

Browser editor for PopCap/PvZ2 RTON files. The binary bridge is a small
`wasm-bindgen` crate around the local `serde_rton` crate, and the interface is a
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

## JSON Bridge

RTON files are decoded into `serde_rton::Value` and shown as pretty JSON.
RTIDs are edited as strings like `RTID(1a.2b.0000000c@name)`. Binary blobs use
the `$BINARY("HEX", len)` string form. Export can write standard RTON or PvZ2's
compact runtime RTON.

The editor can switch between JSON, YAML, and TOML views. JSON remains the
canonical internal text form, while YAML/TOML edits are parsed in a background
worker and synchronized back to JSON before RTON export. Plain text formats are
semantic representations; original numeric widths, string cache tags, and some
binary tag choices are not preserved exactly.
