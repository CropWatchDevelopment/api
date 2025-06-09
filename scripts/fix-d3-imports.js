#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function fixD3Imports(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace the TypeScript-generated require patterns with native import()
  content = content.replace(
    /await Promise\.resolve\(\)\.then\(\(\) => __importStar\(require\('([^']+)'\)\)\)/g,
    "await import('$1')"
  );
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Fixed D3 imports in: ${filePath}`);
}

// Fix the chart files
const chartFiles = [
  'dist/src/pdf/pdf-parts/drawBetterChartWithD3.js',
  'dist/src/pdf/pdf-parts/drawChartWithD3VariableHeight.js'
];

chartFiles.forEach(file => {
  const fullPath = path.join(process.cwd(), file);
  if (fs.existsSync(fullPath)) {
    fixD3Imports(fullPath);
  } else {
    console.log(`File not found: ${fullPath}`);
  }
});

console.log('D3 import fixes complete!');
