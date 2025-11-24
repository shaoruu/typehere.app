# Type Here CLI (th)

A command-line interface for accessing your Type Here notes with vim integration.

## Features

- Interactive TUI with search and filtering
- Encrypted note storage in `~/.typehere/`
- Edit notes directly in vim
- Fuzzy search with support for hidden notes
- Two-way sync with Electron app
- Password-protected encryption

## Installation

### Option 1: Quick Install (Recommended)

```bash
# Install dependencies
pnpm install

# Build and install CLI to ~/.local/bin
pnpm run install:cli
```

This will:

- Build the TypeScript CLI
- Install to `~/.local/bin/th`
- Add to your PATH automatically (zsh/bash/fish)
- Work immediately after reloading your shell

### Option 2: Global Link (Development)

```bash
# Install dependencies
pnpm install

# Build the CLI
pnpm run build:cli

# Link globally
pnpm link --global
```

Or use npm:

```bash
npm link
```

## Usage

### First Time Setup

1. Open the Electron app and set a master password
2. The app will create encrypted notes in `~/.typehere/`
3. Run `th` in your terminal and enter the same password

### Running the CLI

Simply run:

```bash
th
```

This opens an interactive interface where you can:

- **Type to search** - Filter notes as you type
- **↑/↓ or j/k** - Navigate through notes
- **Enter** - Open selected note in vim
- **Ctrl+N** - Create a new note
- **Ctrl+C** - Exit

### Hidden Notes

Hidden notes require at least 5 characters to match (prefix search) or an exact title match if less than 5 characters.

### Workspaces

Notes are organized by workspace, displayed as `[workspace]` next to the note title.

## File Structure

```
~/.typehere/
  notes/
    *.enc           # Encrypted note files (hashed filenames)
  .metadata.enc     # Encrypted metadata (timestamps, workspaces, etc.)
  .id-map.enc       # Encrypted note ID to filename mapping
  .salt             # Salt for key derivation
```

## Security

- All notes are encrypted with AES-256
- Filenames are hashed (SHA-256) to prevent leakage
- Password is never stored, only a hash for verification
- Temp files for vim are cleaned up immediately after editing
- Master password is shared between Electron app and CLI

## Password Recovery

If you forget your password:

1. Delete the encrypted directory: `rm -rf ~/.typehere`
2. Open the Electron app
3. Set a new password
4. Notes from IndexedDB will be re-synced to disk

Note: IndexedDB in the Electron app is the source of truth. The filesystem is a mirror for CLI access.

## Troubleshooting

### "No encrypted notes found"

Run the Electron app first to initialize the encrypted storage.

### "Incorrect password"

Make sure you're using the same password you set in the Electron app. To reset: `rm -rf ~/.typehere`

### Vim not found

Make sure vim is installed and in your PATH:

```bash
which vim
```

## Development

The CLI is written in TypeScript for better maintainability:

- Source: `cli/th.ts` and `cli/crypto.ts`
- Compiled output: `dist-cli/`

After making changes, rebuild:

```bash
pnpm run build:cli
```

### Uninstall

If you used `pnpm run install:cli`:

```bash
pnpm run uninstall:cli
```

If you used global link:

```bash
pnpm unlink --global th
```

Or with npm:

```bash
npm unlink -g th
```
