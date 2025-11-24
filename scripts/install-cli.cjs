#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const platform = os.platform();
const homeDir = os.homedir();

console.log('Installing Type Here CLI (th)...\n');

const distCliPath = path.join(__dirname, '../dist-cli/th.js');

if (!fs.existsSync(distCliPath)) {
  console.error('Error: dist-cli/th.js not found. Please run "pnpm run build:cli" first.');
  process.exit(1);
}

try {
  if (platform === 'win32') {
    const binDir = path.join(homeDir, '.local', 'bin');
    const thPath = path.join(binDir, 'th.cmd');

    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    const batchScript = `@echo off\nnode "${distCliPath}" %*`;
    fs.writeFileSync(thPath, batchScript);

    console.log(`✅ Installed to: ${thPath}`);
    console.log(`\nAdd to PATH:`);
    console.log(`  setx PATH "%PATH%;${binDir}"`);
  } else {
    const binDir = path.join(homeDir, '.local', 'bin');
    const thPath = path.join(binDir, 'th');

    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    if (fs.existsSync(thPath)) {
      fs.unlinkSync(thPath);
    }

    fs.symlinkSync(distCliPath, thPath);
    fs.chmodSync(thPath, '755');

    console.log(`✅ Installed to: ${thPath}`);

    const shell = process.env.SHELL || '';
    let rcFile = '';

    if (shell.includes('zsh')) {
      rcFile = path.join(homeDir, '.zshrc');
    } else if (shell.includes('bash')) {
      rcFile = path.join(homeDir, '.bashrc');
    } else if (shell.includes('fish')) {
      rcFile = path.join(homeDir, '.config', 'fish', 'config.fish');
    }

    const pathExport = `export PATH="$HOME/.local/bin:$PATH"`;
    const fishPathExport = `set -gx PATH $HOME/.local/bin $PATH`;

    if (rcFile && fs.existsSync(rcFile)) {
      const content = fs.readFileSync(rcFile, 'utf8');
      const pathLine = shell.includes('fish') ? fishPathExport : pathExport;

      if (!content.includes('.local/bin')) {
        fs.appendFileSync(rcFile, `\n# Type Here CLI\n${pathLine}\n`);
        console.log(`✅ Added to PATH in ${path.basename(rcFile)}`);
        console.log(`\nReload your shell: source ${rcFile}`);
      } else {
        console.log(`✅ PATH already configured in ${path.basename(rcFile)}`);
      }
    } else {
      console.log(`\n⚠️  Could not detect shell RC file.`);
      console.log(`Manually add to your shell config:`);
      console.log(`  ${pathExport}`);
    }
  }

  console.log(`\n✅ Installation complete!`);
  console.log(`Run: th`);
} catch (error) {
  console.error(`\n❌ Installation failed:`, error.message);
  process.exit(1);
}
