/**
 * Replace padding-bottom: 8px with 20px only inside <h1> opening tags.
 */
const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '..', 'src', 'templates'),
  path.join(__dirname, '..', 'src', 'components'),
];

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      walk(full, files);
    } else if (name.endsWith('.hbs')) {
      files.push(full);
    }
  }
  return files;
}

let fixedCount = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    const content = fs.readFileSync(file, 'utf8');
    const fixed = content.replace(
      /(<h1[^>]*?)padding-bottom:\s*8px/gi,
      '$1padding-bottom: 20px'
    );
    if (fixed !== content) {
      fs.writeFileSync(file, fixed);
      console.log('Fixed:', path.relative(path.join(__dirname, '..'), file));
      fixedCount++;
    }
  }
}

// header partial: add padding-bottom if missing on h1
const headerPath = path.join(__dirname, '..', 'src', 'components', 'header.hbs');
let header = fs.readFileSync(headerPath, 'utf8');
const headerH1 =
  /<h1 style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 28px; font-weight: bold; line-height: 34px; color: \{\{brand\.colors\.headerText\}\};">/;
if (headerH1.test(header) && !header.includes('padding-bottom: 20px')) {
  header = header.replace(
    headerH1,
    '<h1 style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 28px; font-weight: bold; line-height: 34px; color: {{brand.colors.headerText}}; padding-bottom: 20px;">'
  );
  fs.writeFileSync(headerPath, header);
  console.log('Fixed: src/components/header.hbs (added padding-bottom: 20px)');
  fixedCount++;
}

const remaining = [];
for (const root of roots) {
  for (const file of walk(root)) {
    const content = fs.readFileSync(file, 'utf8');
    if (/<h1[^>]*padding-bottom:\s*8px/i.test(content)) {
      remaining.push(path.relative(path.join(__dirname, '..'), file));
    }
  }
}

if (remaining.length) {
  console.error('Still have h1 with padding-bottom 8px:', remaining);
  process.exit(1);
}
console.log(`Done. ${fixedCount} file(s) updated.`);
