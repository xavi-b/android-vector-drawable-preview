# Android Vector Drawable Preview

Preview Android `<vector>` XML in VS Code and Cursor. Open a drawable and choose **Android Vector Drawable: Open Preview**, or click the eye icon in the editor title. The preview stays next to the file and updates as you type.

Night mode reads `values-night` and `color-night`. Mirror flips the icon the way `android:autoMirrored` does in an RTL layout. Copy SVG and Export SVG write the picture you are looking at, including the mirror when it is on.

## Run it

```bash
npm install
npm test
```

In VS Code or Cursor, open this folder and start **Run Extension**. The extension host opens `samples/ic_info.xml`. The eye icon appears when the active XML file contains a `<vector>` or `<animated-vector>`.

`npm run gallery` writes `dist/preview-harness.html`, a local page with the same preview controls and every file under `samples/`.

## What it draws

- Viewport, `dp` size, alpha, and `autoMirrored`
- Paths: fill, stroke, alphas, caps, joins, miter limit, fill type, and trim
- Group pivot, rotation, scale, and translation, in the same order as Android
- Clip paths, applied to the siblings that follow them
- Linear, radial, and sweep gradients
- Tint and `src_in`, `src_over`, `src_atop`, `multiply`, `screen`, and `add`
- `@color`, `@android:color`, `@dimen`, color state lists, and the app theme from `AndroidManifest.xml`
- A static picture of an animated vector, including `@drawable` references

Theme attributes the app does not set fall back to the Material 3 baseline palette. Unresolved colors are drawn in magenta and listed under the artboard.

Animated vectors are not played. Trimmed paths are flattened to line segments, and a trim keeps only the first contour, matching the framework. A stroke width of 0 is a 1px hairline.
