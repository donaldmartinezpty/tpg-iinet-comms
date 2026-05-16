/**
 * Read-only inspector for .docx files (uses mammoth, same stack as extract-docs.js).
 *
 * Usage:
 *   node scripts/peek-docx.js [path-to.docx]
 *   node scripts/peek-docx.js --json [path]
 *   node scripts/peek-docx.js --text [path]        # raw text only (no HTML structure)
 *
 * Default path (if none given): Collections_Notice_Suite v1.2.docx under docs batch 2.
 */
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');

const DEFAULT_REL = path.join(
  'src',
  'docs batch 2',
  'Use',
  'Collections',
  'Collections_Notice_Suite v1.2.docx'
);

/** Collections emails built in-repo (see gulpfile.js buildSourceDocMap SPECIAL). */
const REPO_COLLECTIONS_SLUGS = [
  'collections-demand-notice',
  'collections-dishonoured-arrangement',
  'collections-financial-hardship',
  'collections-overdue',
  'collections-payment-arrangement',
  'collections-pending-disconnection',
  'collections-pending-suspension',
];

function parseArgs(argv) {
  let json = false;
  let textOnly = false;
  const positional = [];
  for (const a of argv) {
    if (a === '--json' || a === '-j') json = true;
    else if (a === '--text' || a === '-t') textOnly = true;
    else if (!a.startsWith('-')) positional.push(a);
  }
  return { json, textOnly, filePath: positional[0] || null };
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractHeadings(html) {
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const level = Number(m[1], 10);
    const text = stripTags(m[2]);
    if (text) out.push({ level, text });
  }
  return out;
}

/**
 * Split on likely "notice" boundaries: heading before email metadata tables.
 * Heuristic for suite-style docs with repeated blocks.
 */
function splitRoughSections(html) {
  const chunks = html.split(/(?=<h[12][^>]*>)/gi).filter((c) => c.trim());
  return chunks.map((chunk, i) => ({
    index: i,
    preview: stripTags(chunk).slice(0, 200),
    len: chunk.length,
  }));
}

/**
 * Matches extract-docs.js: one block per "<h3...>Email copy</h3>"
 */
function findEmailCopyBlocks(html) {
  const blocks = [];
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const title = stripTags(m[1]);
    if (!/email\s*copy/i.test(title)) continue;
    const start = m.index + m[0].length;
    const rest = html.slice(start);
    const nextH3 = rest.search(/<h3[^>]*>/i);
    const slice = nextH3 === -1 ? rest : rest.slice(0, nextH3);
    let subject = '';
    const sm = slice.match(/<strong>Subject:\s*<\/strong>\s*([\s\S]*?)(?:<\/p>|<br)/i);
    if (sm) subject = stripTags(sm[1]);
    blocks.push({
      headingTitle: title,
      subject,
      htmlChars: slice.trim().length,
      textPreview: stripTags(slice).slice(0, 280),
    });
  }
  return blocks;
}

function countFormatRows(html) {
  const m = html.match(/<strong>Format<\/strong>/gi);
  return m ? m.length : 0;
}

/**
 * Collections_Notice_Suite-style layout: each notice lives in a table row; the "Copy"
 * column starts with <p><strong>From:</strong> … (not the single-doc "Email copy" h3).
 */
function getRowCellsForFromBlock(html, fromIdx) {
  const trStart = html.lastIndexOf('<tr', fromIdx);
  if (trStart === -1 || trStart > fromIdx) return { description: '', refCode: '' };
  const trEnd = html.indexOf('</tr>', fromIdx);
  if (trEnd === -1) return { description: '', refCode: '' };
  const row = html.slice(trStart, trEnd + 5);
  const cells = [];
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = tdRe.exec(row)) !== null) {
    cells.push(stripTags(m[1]).replace(/\s+/g, ' ').trim());
  }
  return {
    description: cells[0] || '',
    refCode: cells[1] || '',
  };
}

function extractFromSubjectNoticeBlocks(html) {
  const needle = '<p><strong>From:</strong>';
  const indices = [];
  let pos = 0;
  let idx;
  while ((idx = html.indexOf(needle, pos)) !== -1) {
    indices.push(idx);
    pos = idx + needle.length;
  }

  return indices.map((fromIdx, i) => {
    const end = i + 1 < indices.length ? indices[i + 1] : html.length;
    const chunk = html.slice(fromIdx, end);
    const subj = chunk.match(/<strong>Subject:\s*<\/strong>\s*([^<]+)/i);
    const h3match = chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const { description, refCode } = getRowCellsForFromBlock(html, fromIdx);
    return {
      blockIndex: i + 1,
      tableDescription: description.slice(0, 800),
      refCode: refCode.slice(0, 300),
      subject: subj ? subj[1].trim() : '',
      noticeHeading: h3match ? stripTags(h3match[1]).trim() : '',
    };
  });
}

function subjectHistogram(blocks) {
  const map = {};
  for (const b of blocks) {
    const k = b.subject || '(no subject)';
    map[k] = (map[k] || 0) + 1;
  }
  return map;
}

async function main() {
  const { json, textOnly, filePath: argPath } = parseArgs(process.argv.slice(2));
  const resolved = path.resolve(
    __dirname,
    '..',
    argPath || DEFAULT_REL
  );

  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  if (textOnly) {
    const { value: raw, messages } = await mammoth.extractRawText({ path: resolved });
    const out = {
      file: resolved,
      charCount: raw.length,
      wordApprox: raw.split(/\s+/).filter(Boolean).length,
      messages: messages.map((x) => x.message),
      textPreview: raw.slice(0, 4000),
    };
    if (json) console.log(JSON.stringify(out, null, 2));
    else {
      console.log('File:', out.file);
      console.log('Chars:', out.charCount, 'words ~', out.wordApprox);
      if (out.messages.length) console.log('Warnings:', out.messages.join(' | '));
      console.log('\n--- Preview (first 4000 chars) ---\n');
      console.log(out.textPreview);
    }
    return;
  }

  const { value: html, messages } = await mammoth.convertToHtml(
    { path: resolved },
    { styleMap: ['highlight => mark'] }
  );

  const headings = extractHeadings(html);
  const emailBlocks = findEmailCopyBlocks(html);
  const formatMentions = countFormatRows(html);
  const fromSubjectBlocks = extractFromSubjectNoticeBlocks(html);
  const subjectCounts = subjectHistogram(fromSubjectBlocks);

  const report = {
    file: resolved,
    htmlLength: html.length,
    mammothMessages: messages.map((x) => x.message),
    headingCount: headings.length,
    headingsOutline: headings.slice(0, 80),
    formatFieldCount: formatMentions,
    emailCopySectionCount: emailBlocks.length,
    emailCopySections: emailBlocks,
    fromSubjectBlockCount: fromSubjectBlocks.length,
    fromSubjectBlocks,
    duplicateSubjects: Object.entries(subjectCounts).filter(([, n]) => n > 1),
    roughSectionSplitCount: splitRoughSections(html).length,
    repoCollectionsTemplateSlugs: REPO_COLLECTIONS_SLUGS,
    repoCollectionsTemplateCount: REPO_COLLECTIONS_SLUGS.length,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('File:', report.file);
  console.log('HTML length:', report.htmlLength);
  if (report.mammothMessages.length) {
    console.log('Mammoth:', report.mammothMessages.join(' | '));
  }
  console.log('\n--- Headings (up to 40) ---');
  headings.slice(0, 40).forEach((h, i) => {
    console.log(`${String(i + 1).padStart(2, ' ')}  ${'#'.repeat(h.level)} ${h.text}`);
  });
  if (headings.length > 40) console.log(`    ... ${headings.length - 40} more headings`);

  console.log('\n--- "Format" metadata cells found:', formatMentions);
  console.log('--- <h3> "Email copy" blocks (single-doc style):', emailBlocks.length);
  console.log(
    '--- Table "Copy" blocks (<strong>From:</strong>…):',
    fromSubjectBlocks.length,
    `(repo lists ${REPO_COLLECTIONS_SLUGS.length} collections-* HTML templates)`
  );
  if (report.duplicateSubjects.length) {
    console.log('--- Duplicate subjects:', report.duplicateSubjects.map(([s, n]) => `"${s}" ×${n}`).join('; '));
  }

  emailBlocks.forEach((b, i) => {
    console.log(`\n  [email-copy ${i + 1}] ${b.headingTitle}`);
    if (b.subject) console.log(`      Subject: ${b.subject}`);
    console.log(`      Preview: ${b.textPreview}${b.textPreview.length >= 280 ? '…' : ''}`);
  });

  console.log('\n--- Notices from suite table (From / Subject / row description) ---');
  fromSubjectBlocks.forEach((b) => {
    console.log(`\n  [${b.blockIndex}] Subject: ${b.subject || '(missing)'}`);
    if (b.noticeHeading) console.log(`      H3: ${b.noticeHeading}`);
    if (b.refCode) console.log(`      Ref: ${b.refCode.slice(0, 120)}${b.refCode.length > 120 ? '…' : ''}`);
    const desc = b.tableDescription;
    console.log(
      `      Row: ${desc.slice(0, 200)}${desc.length > 200 ? '…' : ''}`
    );
  });

  console.log('\n--- Heuristic chunk split on <h1>/<h2>:', report.roughSectionSplitCount, 'parts');
  console.log('\nTip: use --json for full machine-readable output, --text for plain-text preview.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
