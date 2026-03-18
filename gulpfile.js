const gulp = require('gulp');
const inlineCss = require('gulp-inline-css');
const rename = require('gulp-rename');
const del = require('del');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const Vinyl = require('vinyl');
const { Readable } = require('stream');
const browserSync = require('browser-sync').create();
const archiver = require('archiver');

// Helper to register partials
function registerPartials(dir) {
  const partialsDir = path.join(__dirname, 'src', dir);
  if (fs.existsSync(partialsDir)) {
    const files = fs.readdirSync(partialsDir);
    files.forEach(file => {
      if (file.endsWith('.hbs')) {
        const partialName = path.basename(file, '.hbs');
        const partialPath = path.join(partialsDir, file);
        const partialContent = fs.readFileSync(partialPath, 'utf8');
        Handlebars.registerPartial(partialName, partialContent);
      }
    });
  }
}

// Clean task
gulp.task('clean', function() {
  return del(['dist/**/*']);
});

// Copy images task
gulp.task('copy-images', function() {
  const brands = ['iinet', 'tpg'];
  return Promise.all(brands.map(brand => {
    return new Promise((resolve, reject) => {
      gulp.src('src/img/**/*')
        .pipe(gulp.dest(path.join(__dirname, 'dist', brand, 'img')))
        .on('end', resolve)
        .on('error', reject);
    });
  }));
});

// Helper to compile template with data
function compileTemplate(templatePath, data, title) {
  const templateContent = fs.readFileSync(templatePath, 'utf8');
  const compiled = Handlebars.compile(templateContent);
  const innerContent = compiled(data);
  
  // Now compile with base layout
  const baseLayoutPath = path.join(__dirname, 'src', 'layouts', 'base.hbs');
  const baseContent = fs.readFileSync(baseLayoutPath, 'utf8');
  const baseCompiled = Handlebars.compile(baseContent);
  
  return baseCompiled({
    ...data,
    title: title,
    content: innerContent
  });
}

// Category rules: order matters, first match wins
const CATEGORY_RULES = [
  { prefix: 'nbn-order-accepted-', category: 'Buy - NBN Order Accepted' },
  { prefix: 'nbn-fault-', category: 'Buy - Fault Appointment' },
  { prefix: 'opticomm-order-accepted-', category: 'Buy - Opticomm Order Accepted' },
  { prefix: 'opticomm-fault-', category: 'Buy - Fault Appointment' },
  { prefix: 'vision-order-accepted-', category: 'Buy - Vision Order Accepted' },
  { prefix: 'verify-email-', category: 'Buy - Email Verification' },
  { prefix: 'sale-quote', category: 'Buy - Quote Summary' },
  { prefix: 'nbn-mas-', category: 'Setup - MAS Notifications' },
  { prefix: 'logistics-', category: 'Setup - Logistics' },
  { prefix: 'proof-of-purchase-', category: 'Setup - Logistics' },
  { prefix: 'mobile-numbersync-', category: 'Setup - NumberSync' },
  { prefix: 'mobile-activate-code-unassisted-', category: 'Setup - eSIM Activation' },
  { prefix: 'mobile-activate-advice', category: 'Setup - eSIM Activation' },
  { prefix: 'mobile-sim-swap-advice', category: 'Setup - eSIM Activation' },
  { prefix: 'otp-', category: 'Use - Authentication' },
  { prefix: 'invoice-', category: 'Use - Billing' },
  { prefix: 'nbn-col-', category: 'Use - Change of Location' },
  { prefix: 'opticomm-col-', category: 'Use - Change of Location' },
  { prefix: 'collections-', category: 'Use - Collections' },
  { prefix: 'card-expiry', category: 'Use - Payments' },
  { prefix: 'payment-', category: 'Use - Payments' },
  { prefix: 'mobile-sim-swap-requested-', category: 'Use - SIM Swap' },
  { prefix: 'mobile-activate-code-assisted', category: 'Use - SIM Swap' },
  { prefix: 'transfer-title-', category: 'Use - Transfer of Title' },
  { prefix: 'nbn-termination-', category: 'Close Account' },
  { prefix: 'termination-', category: 'Close Account' },
  { prefix: 'ucm-', category: 'Use - UCM' },
];

const CATEGORY_ORDER = [
  'Buy - NBN Order Accepted',
  'Buy - Opticomm Order Accepted',
  'Buy - Vision Order Accepted',
  'Buy - Fault Appointment',
  'Buy - Email Verification',
  'Buy - Quote Summary',
  'Setup - MAS Notifications',
  'Setup - Logistics',
  'Setup - NumberSync',
  'Setup - eSIM Activation',
  'Use - Authentication',
  'Use - Billing',
  'Use - Change of Location',
  'Use - Collections',
  'Use - Payments',
  'Use - SIM Swap',
  'Use - Transfer of Title',
  'Use - UCM',
  'Close Account',
];

function categorizeTemplate(slug) {
  for (const rule of CATEGORY_RULES) {
    if (slug.startsWith(rule.prefix) || slug === rule.prefix) {
      return rule.category;
    }
  }
  return 'Other';
}

// Parse SMS_ONLY_DOCS.md to extract document entries
function parseSmsOnlyDocs() {
  const smsDocsPath = path.join(__dirname, 'src', 'docs', 'SMS_ONLY_DOCS.md');
  if (!fs.existsSync(smsDocsPath)) return [];

  const content = fs.readFileSync(smsDocsPath, 'utf8');
  const entries = [];
  let currentSection = '';

  for (const line of content.split('\n')) {
    const sectionMatch = line.match(/^## (.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }
    const rowMatch = line.match(/^\|\s*(.+?\.\w+)\s*\|\s*(.+?)\s*\|$/);
    if (rowMatch && rowMatch[1] !== 'File') {
      entries.push({ file: rowMatch[1].trim(), reason: rowMatch[2].trim(), section: currentSection });
    }
  }
  return entries;
}

function walkDir(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(walkDir(fullPath));
    } else {
      results.push({ name: file, src: fullPath });
    }
  });
  return results;
}

function copySourceDocs() {
  const destDir = path.join(__dirname, 'dist', 'docs');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const docsDir = path.join(__dirname, 'src', 'docs');
  const batch2Dir = path.join(__dirname, 'src', 'docs batch 2');

  const batch1Files = fs.existsSync(docsDir)
    ? fs.readdirSync(docsDir)
        .filter(f => !f.endsWith('.md') && fs.statSync(path.join(docsDir, f)).isFile())
        .map(f => ({ name: f, src: path.join(docsDir, f) }))
    : [];
  const batch2Files = walkDir(batch2Dir);

  const fileMap = {};
  batch1Files.forEach(f => { fileMap[f.name] = f.src; });
  batch2Files.forEach(f => { fileMap[f.name] = f.src; });

  for (const [name, src] of Object.entries(fileMap)) {
    fs.copyFileSync(src, path.join(destDir, name));
  }

  return Object.keys(fileMap);
}

function buildSourceDocMap(copiedFiles) {
  const SPECIAL = {
    'collections-demand-notice': 'Collections_Notice_Suite v1.2.docx',
    'collections-dishonoured-arrangement': 'Collections_Notice_Suite v1.2.docx',
    'collections-financial-hardship': 'Collections_Notice_Suite v1.2.docx',
    'collections-overdue': 'Collections_Notice_Suite v1.2.docx',
    'collections-payment-arrangement': 'Collections_Notice_Suite v1.2.docx',
    'collections-pending-disconnection': 'Collections_Notice_Suite v1.2.docx',
    'collections-pending-suspension': 'Collections_Notice_Suite v1.2.docx',
    'ucm-case-closed': 'TPM - UCM Comms - Case Closed - Email.docx',
    'ucm-case-opened': 'TPM - UCM Comms - Case Opened - Email.docx',
    'ucm-case-reopened': 'TPM - UCM Comms - Case Reopened - Email.docx',
  };

  function normalizeToSlug(filename) {
    return filename
      .replace(/\.[^.]+$/, '')
      .replace(/\s*\(\d+\)\s*/g, '')
      .replace(/_/g, '-')
      .toLowerCase()
      .trim();
  }

  const slugToFile = {};
  for (const filename of copiedFiles) {
    slugToFile[normalizeToSlug(filename)] = filename;
  }

  for (const [slug, file] of Object.entries(SPECIAL)) {
    slugToFile[slug] = file;
  }

  return slugToFile;
}

function generateZips(templates) {
  const brands = ['tpg', 'iinet'];

  const grouped = {};
  for (const t of templates) {
    const cat = categorizeTemplate(t);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(t);
  }

  return Promise.all(brands.map(brand => {
    return new Promise((resolve, reject) => {
      const zipPath = path.join(__dirname, 'dist', `${brand}-templates.zip`);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      for (const [cat, slugs] of Object.entries(grouped)) {
        for (const slug of slugs) {
          const htmlPath = path.join(__dirname, 'dist', brand, `${slug}.html`);
          if (fs.existsSync(htmlPath)) {
            archive.file(htmlPath, { name: `${cat}/${slug}.html` });
          }
        }
      }

      archive.finalize();
    });
  }));
}

const DOC_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

// Generate index.html with links to all built templates per brand
function generateIndex(templates, sourceDocMap) {
  const brands = ['tpg', 'iinet'];

  function slugToLabel(slug) {
    return slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/\bNbn\b/g, 'NBN')
      .replace(/\bFttb\b/gi, 'FTTB')
      .replace(/\bFttc\b/gi, 'FTTC')
      .replace(/\bFtth\b/gi, 'FTTH')
      .replace(/\bFttn\b/gi, 'FTTN')
      .replace(/\bFttp\b/gi, 'FTTP')
      .replace(/\bFttr\b/gi, 'FTTR')
      .replace(/\bHfc\b/gi, 'HFC')
      .replace(/\bOtp\b/gi, 'OTP')
      .replace(/\bMas\b/gi, 'MAS')
      .replace(/\bAlltech\b/gi, 'AllTech')
      .replace(/\bFttbnc\b/gi, 'FTTBNC')
      .replace(/\bFttnc\b/gi, 'FTTNC')
      .replace(/\bHbs\b/gi, '')
      .replace(/\bByo\b/gi, 'BYO')
      .replace(/\bCol\b/gi, 'COL')
      .replace(/\bCot\b/gi, 'COT')
      .replace(/\bUcm\b/gi, 'UCM')
      .replace(/\bMfa\b/gi, 'MFA')
      .replace(/\bMpp\b/gi, 'MPP')
      .replace(/\bOcr\b/gi, 'OCR')
      .replace(/\bSim\b/gi, 'SIM')
      .replace(/\bEsim\b/gi, 'eSIM')
      .replace(/\bPdf\b/gi, 'PDF')
      .replace(/\bFhp\b/gi, 'FHP');
  }

  const sorted = [...templates].sort();

  const grouped = {};
  for (const t of sorted) {
    const cat = categorizeTemplate(t);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(t);
  }

  const orderedCategories = CATEGORY_ORDER.filter(c => grouped[c]);
  const remaining = Object.keys(grouped).filter(c => !CATEGORY_ORDER.includes(c)).sort();
  const allCategories = [...orderedCategories, ...remaining];

  const totalCount = templates.length;

  let brandSections = brands.map((brand, brandIdx) => {
    let catSections = allCategories.map((cat, catIdx) => {
      const items = grouped[cat];
      const links = items.map(t => {
        const docFile = sourceDocMap ? sourceDocMap[t] : null;
        const docLink = docFile
          ? ` <a href="docs/${encodeURIComponent(docFile)}" target="_blank" class="doc-link" title="${docFile}">${DOC_ICON}</a>`
          : '';
        return `            <li><a href="${brand}/${t}.html">${slugToLabel(t)}</a>${docLink}</li>`;
      }).join('\n');
      return `          <div class="category">
            <button class="cat-toggle" onclick="this.parentElement.classList.toggle('collapsed')" aria-expanded="true">
              <span class="cat-arrow">&#9660;</span>
              <span class="cat-title">${cat}</span>
              <span class="cat-count">${items.length}</span>
            </button>
            <ul class="cat-list">
${links}
            </ul>
          </div>`;
    }).join('\n');

    return `        <div class="brand-panel" id="panel-${brand}" ${brandIdx > 0 ? 'style="display:none"' : ''}>
${catSections}
        </div>`;
  }).join('\n');

  const brandTabs = brands.map((brand, i) =>
    `        <button class="brand-tab${i === 0 ? ' active' : ''}" onclick="switchBrand('${brand}')">${brand.toUpperCase()}</button>`
  ).join('\n');

  // Build SMS-only skipped docs section
  const smsDocs = parseSmsOnlyDocs();
  const smsGrouped = {};
  for (const doc of smsDocs) {
    if (!smsGrouped[doc.section]) smsGrouped[doc.section] = [];
    smsGrouped[doc.section].push(doc);
  }

  let smsSection = '';
  if (smsDocs.length > 0) {
    let smsRows = '';
    for (const [section, docs] of Object.entries(smsGrouped)) {
      for (const doc of docs) {
        smsRows += `              <tr><td>${doc.file} <a href="docs/${encodeURIComponent(doc.file)}" target="_blank" class="doc-link" title="${doc.file}">${DOC_ICON}</a></td><td>${section}</td><td>${doc.reason}</td></tr>\n`;
      }
    }
    smsSection = `
    <div class="sms-section">
      <div class="category">
        <button class="cat-toggle" onclick="this.parentElement.classList.toggle('collapsed')" aria-expanded="true">
          <span class="cat-arrow">&#9660;</span>
          <span class="cat-title">Skipped SMS-Only Documents</span>
          <span class="cat-count">${smsDocs.length}</span>
        </button>
        <div class="cat-list sms-list-wrap">
          <table class="sms-table">
            <thead><tr><th>Document</th><th>Batch</th><th>Reason</th></tr></thead>
            <tbody>
${smsRows}            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Templates Index</title>
  <style>
    :root { --brand-color: #8725EE; --brand-color-rgb: 135,37,238; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #f4f4f4; color: #333; padding: 0; }
    .container { max-width: 960px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    .subtitle { font-size: 14px; color: #666; margin-bottom: 24px; }
    .search-box { width: 100%; padding: 10px 14px; font-size: 15px; border: 1px solid #ccc; border-radius: 6px; margin-bottom: 20px; font-family: inherit; outline: none; transition: border-color 0.15s; }
    .search-box:focus { border-color: var(--brand-color); box-shadow: 0 0 0 2px rgba(var(--brand-color-rgb),0.1); }
    .search-info { font-size: 13px; color: #888; margin-bottom: 16px; display: none; }
    .brand-tabs { display: flex; gap: 0; margin-bottom: 24px; border-bottom: 2px solid #ddd; position: sticky; top: 0; background: #f4f4f4; padding-top: 10px; z-index: 10; }
    .brand-tab { padding: 10px 28px; font-size: 15px; font-weight: 600; border: none; background: none; color: #666; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; transition: all 0.15s; }
    .brand-tab:hover { color: #333; }
    .brand-tab.active { color: var(--brand-color); border-bottom-color: var(--brand-color); }
    .category { margin-bottom: 4px; border: 1px solid #e0e0e0; border-radius: 6px; background: #fff; overflow: hidden; }
    .cat-toggle { display: flex; align-items: center; width: 100%; padding: 12px 16px; border: none; background: none; cursor: pointer; text-align: left; font-size: 15px; font-family: inherit; color: #333; gap: 8px; }
    .cat-toggle:hover { background: #fafafa; }
    .cat-arrow { font-size: 10px; color: #999; transition: transform 0.2s; display: inline-block; width: 16px; }
    .cat-title { font-weight: 600; flex: 1; }
    .cat-count { font-size: 12px; color: #fff; background: var(--brand-color); border-radius: 10px; padding: 2px 8px; min-width: 24px; text-align: center; }
    .cat-list { list-style: none; padding: 0 16px 12px; columns: 2; column-gap: 24px; }
    .cat-list li { padding: 4px 0; break-inside: avoid; font-size: 14px; }
    .cat-list a { color: var(--brand-color); text-decoration: none; }
    .cat-list a:hover { text-decoration: underline; }
    .doc-link { color: #999; margin-left: 4px; text-decoration: none !important; display: inline-block; vertical-align: middle; }
    .doc-link:hover { color: var(--brand-color); }
    .doc-link svg { vertical-align: -2px; }
    .download-btn { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; margin-bottom: -2px; align-self: center; padding: 6px 14px; background: var(--brand-color); color: #fff; text-decoration: none; border-radius: 5px; font-size: 13px; font-weight: 600; white-space: nowrap; transition: opacity 0.15s; }
    .download-btn:hover { opacity: 0.8; }
    .collapsed .cat-arrow { transform: rotate(-90deg); }
    .collapsed .cat-list, .collapsed .sms-list-wrap { display: none; }
    .sms-section { margin-top: 32px; }
    .sms-section .cat-count { background: #888; }
    .sms-list-wrap { padding: 0 16px 12px; columns: unset; }
    .sms-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .sms-table th { text-align: left; padding: 8px 10px; background: #f8f8f8; border-bottom: 2px solid #e0e0e0; font-weight: 600; color: #555; }
    .sms-table td { padding: 6px 10px; border-bottom: 1px solid #eee; }
    .sms-table tr:last-child td { border-bottom: none; }
    @media (max-width: 600px) { .cat-list { columns: 1; } .brand-tab { padding: 10px 16px; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Email Templates</h1>
    <p class="subtitle">${totalCount} templates across ${allCategories.length} categories</p>
    <input type="text" class="search-box" id="searchBox" placeholder="Search templates..." autocomplete="off">
    <p class="search-info" id="searchInfo"></p>
    <div class="brand-tabs">
${brandTabs}
        <a href="tpg-templates.zip" download class="download-btn" id="downloadBtn"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> <span id="downloadLabel">Download All TPG Templates</span></a>
    </div>
    <div class="brand-panels">
${brandSections}
    </div>${smsSection}
  </div>
  <script>
    var brandColors = { tpg: ['#8725EE','135,37,238'], iinet: ['#D21F2A','210,31,42'] };
    function switchBrand(brand) {
      document.querySelectorAll('.brand-panel').forEach(p => p.style.display = 'none');
      document.querySelectorAll('.brand-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('panel-' + brand).style.display = 'block';
      event.target.classList.add('active');
      var c = brandColors[brand] || brandColors.tpg;
      document.documentElement.style.setProperty('--brand-color', c[0]);
      document.documentElement.style.setProperty('--brand-color-rgb', c[1]);
      document.getElementById('downloadBtn').href = brand + '-templates.zip';
      document.getElementById('downloadLabel').textContent = 'Download All ' + brand.toUpperCase() + ' Templates';
    }

    (function() {
      const searchBox = document.getElementById('searchBox');
      const searchInfo = document.getElementById('searchInfo');

      searchBox.addEventListener('input', function() {
        const query = this.value.toLowerCase().trim();
        const panels = document.querySelectorAll('.brand-panel');
        let totalVisible = 0;

        panels.forEach(panel => {
          panel.querySelectorAll('.category').forEach(cat => {
            const items = cat.querySelectorAll('.cat-list li');
            let visibleInCat = 0;

            items.forEach(li => {
              const text = li.textContent.toLowerCase();
              const href = li.querySelector('a') ? li.querySelector('a').getAttribute('href').toLowerCase() : '';
              const match = !query || text.includes(query) || href.includes(query);
              li.style.display = match ? '' : 'none';
              if (match) visibleInCat++;
            });

            const catTitle = cat.querySelector('.cat-title');
            const titleMatch = !query || catTitle.textContent.toLowerCase().includes(query);

            if (titleMatch && query) {
              items.forEach(li => { li.style.display = ''; visibleInCat = items.length; });
            }

            cat.style.display = visibleInCat > 0 ? '' : 'none';
            if (visibleInCat > 0 && query) {
              cat.classList.remove('collapsed');
            }

            if (panel.style.display !== 'none') totalVisible += visibleInCat;
          });
        });

        if (query) {
          searchInfo.style.display = 'block';
          searchInfo.textContent = totalVisible + ' template' + (totalVisible !== 1 ? 's' : '') + ' matching "' + this.value.trim() + '"';
        } else {
          searchInfo.style.display = 'none';
          panels.forEach(panel => {
            panel.querySelectorAll('.category').forEach(cat => {
              cat.style.display = '';
              cat.querySelectorAll('.cat-list li').forEach(li => { li.style.display = ''; });
            });
          });
        }
      });
    })();
  </script>
</body>
</html>`;
}

// Build task
gulp.task('build', gulp.series('copy-images', function() {
  // Register all partials
  registerPartials('components');
  registerPartials('layouts');
  
  // Register Handlebars helpers
  Handlebars.registerHelper('concat', function() {
    return Array.prototype.slice.call(arguments, 0, -1).join('');
  });
  
  const brands = ['iinet', 'tpg'];
  const configsDir = path.join(__dirname, 'src', 'templates', 'configs');
  const templates = fs.readdirSync(path.join(__dirname, 'src', 'templates'))
    .filter(f => f.endsWith('.hbs'))
    .map(f => path.basename(f, '.hbs'));
  
  const buildTasks = [];
  
  brands.forEach(brand => {
    const brandConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'src', 'brands', brand, 'config.json'), 'utf8')
    );
    
    templates.forEach((template) => {
      const templatePath = path.join(__dirname, 'src', 'templates', `${template}.hbs`);
      
      let templateConfig = {};
      const configPath = path.join(configsDir, `${template}.json`);
      if (fs.existsSync(configPath)) {
        templateConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      
      const templateData = {
        brand: brandConfig,
        brandName: brand,
        ...templateConfig
      };
      
      const title = template;
      const html = compileTemplate(templatePath, templateData, title);
      
      const htmlFile = new Vinyl({
        path: `${template}.html`,
        contents: Buffer.from(html),
        base: __dirname
      });
      
      buildTasks.push(
        new Promise((resolve, reject) => {
          Readable.from([htmlFile])
            .pipe(inlineCss({
              applyStyleTags: true,
              applyLinkTags: true,
              removeStyleTags: true,
              removeLinkTags: true,
              preserveMediaQueries: true
            }))
            .pipe(rename(`${template}.html`))
            .pipe(gulp.dest(path.join(__dirname, 'dist', brand)))
            .on('end', resolve)
            .on('error', reject);
        })
      );
    });
  });
  
  return Promise.all(buildTasks).then(() => {
    return generateZips(templates);
  }).then(() => {
    const copiedFiles = copySourceDocs();
    const sourceDocMap = buildSourceDocMap(copiedFiles);
    const indexHtml = generateIndex(templates, sourceDocMap);
    fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), indexHtml);
  });
}));

// Watch task
gulp.task('watch', function() {
  gulp.watch('src/**/*.hbs', gulp.series('build'));
  gulp.watch('src/brands/**/*.json', gulp.series('build'));
  gulp.watch('src/templates/configs/**/*.json', gulp.series('build'));
  gulp.watch('src/img/**/*', gulp.series('copy-images'));
});

// Serve task with browser-sync
gulp.task('serve', gulp.series('build', function(done) {
  browserSync.init({
    server: {
      baseDir: './dist',
      index: 'index.html'
    },
    port: 3000,
    open: false,
    notify: false
  });
  
  gulp.watch('src/**/*.hbs', gulp.series('build', function(done) {
    browserSync.reload();
    done();
  }));
  
  gulp.watch('src/brands/**/*.json', gulp.series('build', function(done) {
    browserSync.reload();
    done();
  }));
  
  gulp.watch('src/img/**/*', gulp.series('copy-images', function(done) {
    browserSync.reload();
    done();
  }));
  
  done();
}));

gulp.task('default', gulp.series('clean', 'build'));
