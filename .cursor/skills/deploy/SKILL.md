# Deploy

Build the Electron app as a `.app` bundle (no DMG) and copy it to `/Applications`.

## Steps

1. Run the build with `--dir` to skip DMG packaging:

```bash
pnpm build:electron --dir
```

2. Copy the built app to `/Applications`, replacing any existing version:

```bash
rm -rf "/Applications/Type Here.app"
cp -R "release/0.0.1/mac-arm64/Type Here.app" "/Applications/Type Here.app"
```

3. Verify the app was installed:

```bash
ls -la "/Applications/Type Here.app"
```

4. Report success to the user with the installed path.

## Notes

- The `--dir` flag tells electron-builder to output an unpacked app directory instead of a DMG.
- The output path is `release/0.0.1/mac-arm64/Type Here.app` on Apple Silicon. If the build output differs (e.g. `release/0.0.1/mac/Type Here.app` on Intel), adjust the copy source accordingly. Check `release/0.0.1/` contents if the expected path doesn't exist.
- If the app is currently running, the user should quit it before deploying.
