# Keyboard Assets Generator

A browser-based Three.js tool for generating piano/synth keyboard PNG assets for plugin GUIs.

## Features

- Arbitrary note range (`E1` to `F5`, `B1` to `C5`, etc.)
- Low B / Low E / High C / High F range presets
- Parametric white-key cutouts derived from neighboring black-key positions
- White/black key dimensions, gap, thickness, front radius and colors
- Pressed-key angle preview and export
- Orthographic or perspective camera controls
- Ambient + directional lighting and shadows
- Transparent or solid background
- Exact output pixel size and 1x / 2x / 4x render scale
- Full keyboard PNG export
- Per-note pressed keyboard ZIP export
- Individual key up/down PNG ZIP export
- Optional alpha-bound cropping for individual assets
- JSON preset save/load

## GitHub Pages

The repository includes `.github/workflows/pages.yml`. Pushes to `main` deploy the static site with GitHub Pages.

Expected URL: `https://hugelton.github.io/KeyboardAssetsGenerator/`

## Notes

The app is intentionally build-free. Three.js and JSZip are loaded from jsDelivr, so GitHub Pages can serve the repository directly.
