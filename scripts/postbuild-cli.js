#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const thFile = path.join(__dirname, '../dist-cli/th.js');

if (fs.existsSync(thFile)) {
  const content = fs.readFileSync(thFile, 'utf8');
  const contentWithShebang = '#!/usr/bin/env node\n' + content;
  fs.writeFileSync(thFile, contentWithShebang, 'utf8');
  fs.chmodSync(thFile, '755');
  console.log('Added shebang to dist-cli/th.js and made it executable');
}
