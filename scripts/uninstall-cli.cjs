#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const platform = os.platform();
const homeDir = os.homedir();

console.log('Uninstalling Type Here CLI (th)...\n');

try {
  if (platform === 'win32') {
    const thPath = path.join(homeDir, '.local', 'bin', 'th.cmd');
    
    if (fs.existsSync(thPath)) {
      fs.unlinkSync(thPath);
      console.log(`✅ Removed: ${thPath}`);
    } else {
      console.log('⚠️  CLI not found at:', thPath);
    }
  } else {
    const thPath = path.join(homeDir, '.local', 'bin', 'th');
    
    if (fs.existsSync(thPath)) {
      fs.unlinkSync(thPath);
      console.log(`✅ Removed: ${thPath}`);
    } else {
      console.log('⚠️  CLI not found at:', thPath);
    }
  }

  console.log('\n✅ Uninstallation complete!');
  console.log('\nNote: PATH entries in your shell config were not removed.');
  console.log('They are harmless but you can remove them manually if desired.');
} catch (error) {
  console.error('\n❌ Uninstallation failed:', error.message);
  process.exit(1);
}
