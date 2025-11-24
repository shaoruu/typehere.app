#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const distCliDir = path.join(__dirname, '../dist-cli');

// Rename all .js files to .cjs for CommonJS compatibility in ES module package
const files = fs.readdirSync(distCliDir);
files.forEach((file) => {
  if (file.endsWith('.js')) {
    const jsFile = path.join(distCliDir, file);
    const cjsFile = path.join(distCliDir, file.replace('.js', '.cjs'));
    fs.renameSync(jsFile, cjsFile);
    console.log(`Renamed ${file} to ${file.replace('.js', '.cjs')}`);
  }
});

// Add shebang to th.cjs
const thCjsFile = path.join(distCliDir, 'th.cjs');
if (fs.existsSync(thCjsFile)) {
  const content = fs.readFileSync(thCjsFile, 'utf8');
  
  // Only add shebang if it doesn't already exist
  if (!content.startsWith('#!/usr/bin/env node')) {
    const contentWithShebang = '#!/usr/bin/env node\n' + content;
    fs.writeFileSync(thCjsFile, contentWithShebang, 'utf8');
    console.log('Added shebang to th.cjs');
  } else {
    console.log('Shebang already exists in th.cjs');
  }
  
  fs.chmodSync(thCjsFile, '755');
  console.log('Made th.cjs executable');
}

// Update require statements in all .cjs files to use .cjs extensions
const cjsFiles = fs.readdirSync(distCliDir).filter((f) => f.endsWith('.cjs'));
cjsFiles.forEach((file) => {
  const filePath = path.join(distCliDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace require('./crypto') with require('./crypto.cjs')
  content = content.replace(/require\(["']\.\/crypto["']\)/g, 'require("./crypto.cjs")');
  
  fs.writeFileSync(filePath, content, 'utf8');
});
console.log('Updated require statements to use .cjs extensions');
