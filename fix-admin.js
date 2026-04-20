import fs from 'fs';

const filePath = 'admin.html';
let content = fs.readFileSync(filePath, 'utf8');

// Remove backslashes before backticks and ${
// The actual file contains \` and \${
const fixed = content.replace(/\\`/g, '`').replace(/\\\${/g, '${');

fs.writeFileSync(filePath, fixed);
console.log('Fixed admin.html syntax errors.');
