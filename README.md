# RTON Editor Legacy

RTON Editor Legacy is a browser-based editor for PopCap/PvZ2 RTON files. It combines a
Rust `wasm-bindgen` bridge around [`serde_rton`](https://github.com/LambdaEd1th/serde_rton)
with a React, Vite, TypeScript, Tailwind CSS frontend.

The tool is designed for inspecting, editing, and exporting RTON data without
leaving the browser.

## Features

- Open `.rton`, `.dat`, `.json`, `.yaml`, `.yml`, and `.toml` files.
- Drag files or folders into the app while preserving relative paths.
- Browse loaded files in a searchable tree.
- Edit RTON as a type-preserving RtonValue tree.
- Switch between RTON Hex, JSON, YAML, and TOML views.
- Use a lightweight Hex editor with HEX/ASCII editing, search, replace, and
  offset navigation.
- Export Standard or Compact RTON, optionally encrypted for PvZ2 runtime use.
- Batch export selected files to RTON, JSON, YAML, or TOML.
- Deploy the static app to GitHub Pages through GitHub Actions.

## Requirements

- Node.js 22 or newer.
- Rust stable with the `wasm32-unknown-unknown` target.
- `wasm-pack` 0.15.0.

Install the Rust target and wasm-pack:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.0 --locked
```

## Development

```bash
npm install
npm run dev
```

`npm run dev` automatically builds the WebAssembly package before starting Vite.

## Build

```bash
npm run build
```

The production site is written to `dist/`.

## WASM Layout

The Rust wrapper crate lives in:

```text
wasm/rton-editor-wasm/
```

The generated `wasm-pack` package is written to:

```text
src/wasm/rton-editor/
```

That generated directory is ignored by Git and recreated by `npm run build:wasm`.
This mirrors the wasm wrapper layout used by `pam-viewer`.

## RTON Model

RTON files are decoded into a type-preserving RtonValue tree before being shown
in the UI. This keeps integer widths, floating-point values, RTIDs, binary blobs,
arrays, and objects explicit in the editor.

JSON, YAML, and TOML are text projections of the same RtonValue tree. YAML and
TOML can represent non-finite floating-point values such as `Infinity` and `NaN`;
JSON cannot, so JSON preview/export reports an error for those values.

## License

RTON Editor Legacy is licensed under the GNU Affero General Public License v3.0 or
later. See [LICENSE](./LICENSE) for the full license text.
