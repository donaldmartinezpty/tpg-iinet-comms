/**
 * Generate collections-* email templates from Collections_Notice_Suite v1.4.docx
 * (one template per table row / From: block).
 *
 * Usage:
 *   node scripts/extract-collections-suite.js [path-to.docx]
 */
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');
const {
  extractFromSubjectNoticeChunks,
  assignSlug,
} = require('./lib/docx-suite-blocks');

const DEFAULT_DOCX = path.join(
  __dirname,
  '..',
  'src',
  'docs batch 2',
  'Use',
  'Collections',
  'Collections_Notice_Suite v1.4.docx'
);

const SOURCE_FILENAME = 'Collections_Notice_Suite v1.4.docx';
const templatesDir = path.join(__dirname, '..', 'src', 'templates');
const configsDir = path.join(templatesDir, 'configs');
const manifestPath = path.join(templatesDir, 'collections-suite-manifest.json');

const LEGACY_SLUGS = [
  'collections-demand-notice',
  'collections-dishonoured-arrangement',
  'collections-financial-hardship',
  'collections-overdue',
  'collections-payment-arrangement',
  'collections-pending-disconnection',
  'collections-pending-suspension',
];

const BRAND_MARKS = {
  'BRAND PHONE NUMBER': '{{brand.support.phone}}',
  'NBN SUPPORT NUMBER': '{{brand.support.phone}}',
  'SUPPORT NUMBER': '{{brand.support.phone}}',
  'BRAND SUPPORT NUMBER': '{{brand.support.phone}}',
  'SUPPORT PHONE': '{{brand.support.phone}}',
  'ACCOUNTS PHONE': '{{brand.support.accountsPhone}}',
  'ACCOUNTS HOOP': '{{brand.support.accountsHoop}}',
  'FINANCIAL HARDSHIP': '{{brand.support.financialHardship}}',
  'FHP PHONE NUMBER': '{{brand.support.financialHardship}}',
  'NO-REPLY EMAIL': '{{brand.noReplyEmail}}',
  'SECURITY INFO URL': '{{brand.support.url}}',
  'ONEAPP NAME': '{{brand.app.name}}',
  'ONEAPP URL': '{{brand.oneAppUrl}}',
  'ONE APP URL': '{{brand.oneAppUrl}}',
  'NBN CIS URL': '{{brand.nbnCisUrl}}',
  'OPTICOMM CIS URL': '{{brand.opticommCisUrl}}',
  'VISION CIS URL': '{{brand.visionCisUrl}}',
  'TERMS URL': '{{brand.termsUrl}}',
  'MODEM GUIDE DIRECTORY URL': '{{brand.modemGuideUrl}}',
  'MODEM BYO GUIDE DIRECTORY URL': '{{brand.modemByoGuideUrl}}',
  'BRAND': '{{brand.displayName}}',
  'BRAND NAME': '{{brand.displayName}}',
  'APP STORE URL': '{{brand.app.appStoreUrl}}',
  'GOOGLE PLAY URL': '{{brand.app.googlePlayUrl}}',
  'SUPPORT URL': '{{brand.support.url}}',
};

function markToVariable(markText) {
  const upper = markText.toUpperCase().trim();
  const sortedBrand = Object.keys(BRAND_MARKS).sort((a, b) => b.length - a.length);
  for (const k of sortedBrand) {
    if (upper === k) return BRAND_MARKS[k];
  }
  const snakeCase = markText
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, '_');
  return `%%${snakeCase}%%`;
}

function processDocxEmail(emailHtml) {
  let html = emailHtml;

  html = html.replace(/<mark>(.*?)<\/mark>/gi, (_, text) => {
    const cleaned = text.replace(/<[^>]+>/g, '').trim();
    return markToVariable(cleaned);
  });

  let subject = '';
  const subjMatch = html.match(/<strong>Subject:<\/strong>\s*(.*?)(?:<\/p>)/si);
  if (subjMatch) {
    subject = subjMatch[1].replace(/<[^>]+>/g, '').trim();
  } else {
    const subjMatch2 = html.match(/Subject:\s*(.*?)(?:<\/p>)/si);
    if (subjMatch2) subject = subjMatch2[1].replace(/<[^>]+>/g, '').trim();
  }

  let bodyHtml = html;
  const subjEnd = html.search(/<strong>Subject:<\/strong>.*?<\/p>/si);
  if (subjEnd !== -1) {
    const afterSubj = html.substring(subjEnd);
    const pEnd = afterSubj.indexOf('</p>');
    if (pEnd !== -1) bodyHtml = afterSubj.substring(pEnd + 4);
  } else {
    const subjEnd2 = html.search(/Subject:.*?<\/p>/si);
    if (subjEnd2 !== -1) {
      const afterSubj = html.substring(subjEnd2);
      const pEnd = afterSubj.indexOf('</p>');
      if (pEnd !== -1) bodyHtml = afterSubj.substring(pEnd + 4);
    }
    const fromMatch = html.match(/<p>.*?<strong>From:<\/strong>.*?<\/p>/si);
    const toMatch = html.match(/<p>.*?<strong>To:<\/strong>.*?<\/p>/si);
    if (fromMatch) bodyHtml = bodyHtml.replace(fromMatch[0], '');
    if (toMatch) bodyHtml = bodyHtml.replace(toMatch[0], '');
  }

  bodyHtml = bodyHtml.replace(/<h3[^>]*>[\s\S]*?<\/h3>/i, '');

  const rowLeak = bodyHtml.search(/<\/td>\s*<\/tr>\s*<tr[\s>]/i);
  if (rowLeak !== -1) bodyHtml = bodyHtml.substring(0, rowLeak);

  const cutPatterns = [
    /<h6[^>]*>.*?Things you need to know.*?<\/h6>/i,
    /<h5[^>]*>.*?Things you need to know.*?<\/h5>/i,
    /<p[^>]*>.*?<strong>Things you need to know<\/strong>.*?<\/p>/i,
    /<p>[^<]*At\s*<strong>\s*<\/strong>\s*\{\{brand\.displayName\}\}/i,
    /<p>[^<]*At\s+\{\{brand\.displayName\}\}/i,
    /<p>[^<]*At\s+%%BRAND%%/i,
    /<p>\s*This email was sent to you by/i,
    /<p>\s*©\s*\d{4}/i,
  ];
  for (const regex of cutPatterns) {
    const idx = bodyHtml.search(regex);
    if (idx !== -1) bodyHtml = bodyHtml.substring(0, idx);
  }

  return { subject, rows: htmlToRows(bodyHtml) };
}

function isLeakedTableMetadata(text) {
  if (/^Sent when /i.test(text)) return true;
  if (/^Demand Notice \d/i.test(text)) return true;
  if (/^(Financial Hardship|Overdue reminder|Payment Arrangement) /i.test(text)) return true;
  if (/^(TPG_|IINET_|FULLBAR)\b/i.test(text)) return true;
  if (/^<\/td>|^<tr[\s>]/i.test(text)) return true;
  return false;
}

function htmlToRows(html) {
  let cleaned = html.trim();
  cleaned = cleaned.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '<p><strong>$1</strong></p>');
  cleaned = cleaned.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '<p><strong>$1</strong></p>');
  cleaned = cleaned.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '');

  const segments = cleaned
    .split(/<\/p>/i)
    .map((s) => s.replace(/^\s*<p[^>]*>/i, '').trim())
    .filter(Boolean);
  const rows = [];

  for (let seg of segments) {
    if (seg.match(/^<strong>From:<\/strong>/i)) continue;
    if (seg.match(/^<strong>To:<\/strong>/i)) continue;
    if (seg.match(/^From:\s/i)) continue;
    if (seg.match(/^To:\s/i)) continue;

    seg = seg.replace(/<br\s*\/?>\s*$/, '');

    if (seg.includes('<ul')) {
      const beforeUl = seg.substring(0, seg.indexOf('<ul')).trim();
      if (beforeUl) rows.push(beforeUl);
      const ulMatch = seg.match(/<ul>(.*?)<\/ul>/si);
      if (ulMatch) {
        const items = [];
        const liRegex = /<li>(.*?)<\/li>/gis;
        let m;
        while ((m = liRegex.exec(ulMatch[1])) !== null) {
          items.push(m[1].trim());
        }
        if (items.length) rows.push({ type: 'list', items });
      }
      const afterUlIdx = seg.indexOf('</ul>');
      if (afterUlIdx !== -1) {
        const afterUl = seg.substring(afterUlIdx + 5).replace(/^\s*<p[^>]*>/i, '').trim();
        if (afterUl) rows.push(afterUl);
      }
    } else if (seg.includes('<ol')) {
      const beforeOl = seg.substring(0, seg.indexOf('<ol')).trim();
      if (beforeOl) rows.push(beforeOl);
      const olMatch = seg.match(/<ol>(.*?)<\/ol>/si);
      if (olMatch) {
        const items = [];
        const liRegex = /<li>(.*?)<\/li>/gis;
        let m;
        while ((m = liRegex.exec(olMatch[1])) !== null) {
          items.push(m[1].trim());
        }
        if (items.length) rows.push({ type: 'ordered-list', items });
      }
    } else {
      rows.push(seg);
    }
  }

  const finalRows = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (typeof row !== 'string') {
      finalRows.push(row);
      continue;
    }
    const stripped = row.replace(/<[^>]+>/g, '').trim();
    if (!stripped) continue;
    if (isLeakedTableMetadata(stripped)) continue;
    if ((stripped === 'Thanks,' || stripped === 'Thanks') && i + 1 < rows.length) {
      const nextStripped =
        typeof rows[i + 1] === 'string' ? rows[i + 1].replace(/<[^>]+>/g, '').trim() : '';
      if (
        nextStripped.match(/^(The\s+)?(\{\{brand\.displayName\}\}|%%BRAND%%)\s*Team$/i) ||
        nextStripped.match(/^Your\s+(\{\{brand\.displayName\}\}|%%BRAND%%)\s*Team$/i)
      ) {
        i += 1;
        continue;
      }
    }
    if (stripped.match(/^<strong>(The|Your)\s+(\{\{brand\.displayName\}\}|%%BRAND%%)\s*Team<\/strong>$/i))
      continue;
    if (stripped.match(/^(The|Your)\s+(\{\{brand\.displayName\}\}|%%BRAND%%)\s*Team$/i)) continue;
    finalRows.push(row);
  }
  return finalRows;
}

function cleanHtmlForTemplate(text) {
  return text
    .replace(/<em>(.*?)<\/em>/gi, '$1')
    .replace(/<span[^>]*>(.*?)<\/span>/gi, '$1')
    .replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, href, linkText) => {
      return `<a href="${href}" style="color: {{brand.colors.primary}}; text-decoration: underline;">${linkText}</a>`;
    });
}

function escapeTitle(subject) {
  return subject.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildCollectionsTemplate(subject, rows) {
  const title = escapeTitle(subject || 'Notification');
  const tdStyle =
    'font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 24px; color: {{brand.colors.text}}; padding-bottom: 20px;';
  const headingStyle =
    'font-family: Arial, Helvetica, sans-serif; font-size: 18px; line-height: 26px; color: {{brand.colors.headerText}}; padding-bottom: 8px;';
  const liStyle =
    'font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 24px; color: {{brand.colors.text}}; padding-bottom: 8px;';

  let bodyRows = '';
  for (const row of rows) {
    if (typeof row === 'object' && row.type === 'list') {
      let listHtml = `          <ul style="padding-left: 20px; margin: 0 0 20px 0;">\n`;
      for (const item of row.items) {
        listHtml += `            <li style="${liStyle}">${cleanHtmlForTemplate(item)}</li>\n`;
      }
      listHtml += `          </ul>`;
      bodyRows += `      <tr>\n        <td style="${tdStyle}">\n${listHtml}\n        </td>\n      </tr>\n`;
    } else if (typeof row === 'object' && row.type === 'ordered-list') {
      let listHtml = `          <ol style="padding-left: 20px; margin: 0 0 20px 0;">\n`;
      for (const item of row.items) {
        listHtml += `            <li style="${liStyle}">${cleanHtmlForTemplate(item)}</li>\n`;
      }
      listHtml += `          </ol>`;
      bodyRows += `      <tr>\n        <td style="${tdStyle}">\n${listHtml}\n        </td>\n      </tr>\n`;
    } else {
      let content = cleanHtmlForTemplate(row);
      const isHeading =
        content.match(/^<strong>[^<]{3,120}<\/strong>$/) && !content.match(/%%/) && !content.match(/Hi\s/);
      if (isHeading) {
        bodyRows += `      <tr>\n        <td style="${headingStyle}">\n          ${content}\n        </td>\n      </tr>\n`;
      } else {
        bodyRows += `      <tr>\n        <td style="${tdStyle}">\n          ${content}\n        </td>\n      </tr>\n`;
      }
    }
  }

  return `{{> header title="${title}"}}

<tr>
  <td style="padding: 20px {{brand.layout.horizontalPadding}};">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
${bodyRows}    </table>
  </td>
</tr>

<tr>
  <td style="padding: 20px {{brand.layout.horizontalPadding}} 60px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 24px; color: {{brand.colors.text}};">
          Thanks,<br>
          Your {{brand.displayName}} Team
        </td>
      </tr>
    </table>
  </td>
</tr>

{{> footer}}
`;
}

function extractConfigVariables(templateContent) {
  const vars = {};
  const varRegex = /%%([A-Z_]+)%%/g;
  let m;
  while ((m = varRegex.exec(templateContent)) !== null) {
    vars[m[1]] = m[1].replace(/_/g, ' ');
  }
  return vars;
}

function removeLegacyTemplates() {
  for (const slug of LEGACY_SLUGS) {
    const hbs = path.join(templatesDir, `${slug}.hbs`);
    const cfg = path.join(configsDir, `${slug}.json`);
    if (fs.existsSync(hbs)) fs.unlinkSync(hbs);
    if (fs.existsSync(cfg)) fs.unlinkSync(cfg);
  }
}

async function main() {
  const docxPath = path.resolve(__dirname, '..', process.argv[2] || DEFAULT_DOCX);
  if (!fs.existsSync(docxPath)) {
    console.error(`File not found: ${docxPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(configsDir)) fs.mkdirSync(configsDir, { recursive: true });

  const { value: html } = await mammoth.convertToHtml(
    { path: docxPath },
    { styleMap: ['highlight => mark'] }
  );

  const chunks = extractFromSubjectNoticeChunks(html);
  if (chunks.length === 0) {
    console.error('No From: blocks found in document.');
    process.exit(1);
  }

  removeLegacyTemplates();

  const usedSlugs = new Set();
  const manifestBlocks = [];
  const slugs = [];

  for (const block of chunks) {
    const slug = assignSlug(block.tableDescription, block.refCode, block.blockIndex, usedSlugs);
    const { subject, rows } = processDocxEmail(block.htmlChunk);
    const headerSubject = subject || block.subject || block.noticeHeading || 'Notification';
    const template = buildCollectionsTemplate(headerSubject, rows);
    const configVars = extractConfigVariables(template);

    fs.writeFileSync(path.join(templatesDir, `${slug}.hbs`), template);
    fs.writeFileSync(path.join(configsDir, `${slug}.json`), JSON.stringify(configVars, null, 2));

    slugs.push(slug);
    manifestBlocks.push({
      slug,
      refCode: block.refCode,
      subject: headerSubject,
      rowDescription: block.tableDescription.split(/\s+Sent when/i)[0].trim(),
      blockIndex: block.blockIndex,
    });

    console.log(`[${block.blockIndex}] ${slug} — ${headerSubject} (${rows.length} rows, ${Object.keys(configVars).length} vars)`);
  }

  const manifest = {
    sourceFile: SOURCE_FILENAME,
    extractedFrom: path.basename(docxPath),
    slugs,
    blocks: manifestBlocks,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`\n--- Summary ---`);
  console.log(`Templates written: ${slugs.length}`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
