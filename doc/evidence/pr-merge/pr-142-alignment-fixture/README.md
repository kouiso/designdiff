# PR142 alignment fixture

`source.png` is the 1080x2340 manual capture reviewed for this receipt. It contains no visible personal information. `shifted-left-2px.png` is generated from it with the fixed translation in `expected.json`.

Run the independent pixel checks with:

```sh
node script/repro-pr142-alignment-fixture.mjs
```

To regenerate the shifted input from `source.png`:

```sh
node script/repro-pr142-alignment-fixture.mjs --write-shifted
```

The script does not import FigDiff comparison code or consume a FigDiff verdict. It checks identical-image diff, the known shifted-image diff, and exact agreement between the stored shifted input and the independently calculated two-pixel translation. The expected translation is fixture data, so a source self-verdict cannot change the oracle's expectation.
