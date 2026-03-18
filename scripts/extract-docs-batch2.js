const mammoth = require('mammoth');
const PDFParser = require('pdf2json');
const fs = require('fs');
const path = require('path');

const docsDir = path.join(__dirname, '..', 'src', 'docs batch 2');
const templatesDir = path.join(__dirname, '..', 'src', 'templates');
const configsDir = path.join(templatesDir, 'configs');

const SMS_ONLY_FILES = [
  'Opticomm_Address_Confirm_AllTech',
  'Opticomm_Appointment_Required_AllTech',
  'Opticomm_Appointment_Rescheduled_AllTech',
  'Opticomm_Appointment_Reschedule_Required_AllTech',
  'Opticomm_Order_Complete_AllTech',
  'Order_Appointment_Required_Internet',
  'Order_Appointment_Rescheduled_Internet',
  'Order_Appointment_Reschedule_Required_Internet',
  'Order_Complete_Internet',
  'Vision_Address_Confirm_AllTech',
  'Vision_Appointment_Required_AllTech',
  'Vision_Appointment_Rescheduled_AllTech',
  'Vision_Appointment_Reschedule_Required_AllTech',
  'Vision_Order_Complete_AllTech',
  'Mobile_SIM_Swap_Code_Unassisted',
];

const SKIP_FILES = [
  'VF_Fixed_OnlineSupport_202602',
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

function fileToSlug(filename) {
  return filename
    .replace(/\s*\(\d+\)\s*/g, '')
    .replace(/\.docx$|\.pdf$/i, '')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase();
}

function markToVariable(markText) {
  const upper = markText.toUpperCase().trim();

  const sortedBrand = Object.keys(BRAND_MARKS).sort((a, b) => b.length - a.length);
  for (const k of sortedBrand) {
    if (upper === k) return BRAND_MARKS[k];
  }

  const snakeCase = markText.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, '_');
  return `%%${snakeCase}%%`;
}

function classifyDocHtml(html) {
  const formatMatch = html.match(/<strong>Format<\/strong>.*?<\/td>\s*<td>(.*?)<\/td>/si);
  if (!formatMatch) {
    const altMatch = html.match(/Format[:\s]+(Email|SMS|Email\s*(?:&|and)\s*SMS)/i);
    if (altMatch) {
      const text = altMatch[1].toLowerCase();
      if (text.includes('email') && text.includes('sms')) return 'email_and_sms';
      if (text.includes('email')) return 'email';
      if (text.includes('sms')) return 'sms';
    }
    return 'unknown';
  }
  const formatText = formatMatch[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
  if (formatText.includes('email') && formatText.includes('sms')) return 'email_and_sms';
  if (formatText.includes('email')) return 'email';
  if (formatText.includes('sms')) return 'sms';
  return 'unknown';
}

function extractEmailSectionHtml(html) {
  const emailIdx = html.search(/<h3[^>]*>[^<]*Email\s*copy[^<]*<\/h3>/i);
  if (emailIdx === -1) {
    const altIdx = html.search(/<p[^>]*>\s*<strong>\s*Email\s*copy\s*<\/strong>\s*<\/p>/i);
    if (altIdx === -1) return null;
    const afterAlt = html.substring(altIdx);
    const nextP = afterAlt.indexOf('</p>');
    if (nextP === -1) return null;
    let content = afterAlt.substring(nextP + 4).trim();
    if (/^\s*<p>\s*N\/?A\s*<\/p>/i.test(content)) return null;
    return content;
  }

  const afterHeader = html.substring(emailIdx);
  const headerEnd = afterHeader.indexOf('</h3>');
  if (headerEnd === -1) return null;

  let content = afterHeader.substring(headerEnd + 5).trim();
  if (/^\s*<p>\s*N\/?A\s*<\/p>/i.test(content)) return null;

  return content;
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
    if (subjMatch2) {
      subject = subjMatch2[1].replace(/<[^>]+>/g, '').trim();
    }
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

  const rows = htmlToRows(bodyHtml);
  return { subject, rows };
}

function htmlToRows(html) {
  let cleaned = html.trim();

  cleaned = cleaned.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '<p><strong>$1</strong></p>');
  cleaned = cleaned.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '<p><strong>$1</strong></p>');
  cleaned = cleaned.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '');

  const segments = cleaned.split(/<\/p>/i)
    .map(s => s.replace(/^\s*<p[^>]*>/i, '').trim())
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
    if (typeof row !== 'string') { finalRows.push(row); continue; }

    const stripped = row.replace(/<[^>]+>/g, '').trim();
    if (!stripped) continue;
    if ((stripped === 'Thanks,' || stripped === 'Thanks') && i + 1 < rows.length) {
      const nextStripped = typeof rows[i + 1] === 'string'
        ? rows[i + 1].replace(/<[^>]+>/g, '').trim()
        : '';
      if (nextStripped.match(/^(The\s+)?(\{\{brand\.displayName\}\}|%%BRAND%%)\s*Team$/i) ||
          nextStripped.match(/^Your\s+(\{\{brand\.displayName\}\}|%%BRAND%%)\s*Team$/i)) {
        i++;
        continue;
      }
    }
    if (stripped.match(/^<strong>(The|Your)\s+(\{\{brand\.displayName\}\}|%%BRAND%%)\s*Team<\/strong>$/i)) continue;
    if (stripped.match(/^(The|Your)\s+(\{\{brand\.displayName\}\}|%%BRAND%%)\s*Team$/i)) continue;

    finalRows.push(row);
  }

  return finalRows;
}

function isNbnTemplate(slug) {
  return slug.startsWith('nbn-') || slug.includes('opticomm-') || slug.includes('vision-');
}

function cleanHtmlForTemplate(text) {
  return text
    .replace(/<em>(.*?)<\/em>/gi, '$1')
    .replace(/<span[^>]*>(.*?)<\/span>/gi, '$1')
    .replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, href, text) => {
      if (href.startsWith('%%') || href.startsWith('{{')) {
        return `<a href="${href}" style="color: {{brand.colors.primary}}; text-decoration: underline;">${text}</a>`;
      }
      return `<a href="${href}" style="color: {{brand.colors.primary}}; text-decoration: underline;">${text}</a>`;
    });
}

function buildTemplate(slug, subject, rows) {
  const nbn = isNbnTemplate(slug);

  let titleExpr;
  if (subject.includes('{{brand.displayName}}') || subject.includes('%%')) {
    const parts = subject.split(/(\{\{brand\.displayName\}\}|%%[A-Z_]+%%)/g);
    if (parts.length > 1) {
      const concatArgs = parts.map(p => {
        if (p === '{{brand.displayName}}') return 'brand.displayName';
        if (p.startsWith('%%')) return `"${p}"`;
        return `"${p}"`;
      }).join(' ');
      titleExpr = `(concat ${concatArgs})`;
    } else {
      titleExpr = `"${subject}"`;
    }
  } else {
    titleExpr = `"${subject}"`;
  }

  const tdStyle = 'font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 24px; color: {{brand.colors.text}}; padding-bottom: 20px;';
  const headingStyle = 'font-family: Arial, Helvetica, sans-serif; font-size: 18px; line-height: 26px; color: {{brand.colors.headerText}}; padding-bottom: 8px;';
  const liStyle = 'font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 24px; color: {{brand.colors.text}}; padding-bottom: 8px;';

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
      const isHeading = content.match(/^<strong>[^<]{3,60}<\/strong>$/) &&
        !content.match(/%%/) &&
        !content.match(/Hi\s/);

      if (isHeading) {
        bodyRows += `      <tr>\n        <td style="${headingStyle}">\n          ${content}\n        </td>\n      </tr>\n`;
      } else {
        bodyRows += `      <tr>\n        <td style="${tdStyle}">\n          ${content}\n        </td>\n      </tr>\n`;
      }
    }
  }

  const footerFlags = nbn ? ' showThingsHeading=true showNbnTrademark=true' : '';

  return `{{> header title=${titleExpr}}}

<tr>
  <td style="padding: 20px 15px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
${bodyRows}    </table>
  </td>
</tr>

<tr>
  <td style="padding: 20px 15px 60px;">
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

{{> footer${footerFlags}}}
`;
}

function extractConfigVariables(templateContent) {
  const vars = {};
  const varRegex = /%%([A-Z_]+)%%/g;
  let m;
  while ((m = varRegex.exec(templateContent)) !== null) {
    const varName = m[1];
    vars[varName] = varName.replace(/_/g, ' ');
  }
  return vars;
}

function parsePDF(filepath) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, 1);
    parser.on('pdfParser_dataReady', (data) => {
      let text = '';
      data.Pages.forEach(page => {
        page.Texts.forEach(t => {
          t.R.forEach(r => { text += decodeURIComponent(r.T) + ' '; });
        });
        text += '\n';
      });
      resolve(text);
    });
    parser.on('pdfParser_dataError', reject);
    parser.loadPDF(filepath);
  });
}

function classifyPdfText(text) {
  const formatMatch = text.match(/Format\s+(.*?)(?:Brands|Brand)/si);
  if (!formatMatch) return 'unknown';
  const format = formatMatch[1].trim().toLowerCase();
  if (format.includes('email') && format.includes('sms')) return 'email_and_sms';
  if (format.includes('email')) return 'email';
  if (format.includes('sms')) return 'sms';
  return 'unknown';
}

function normalizePdfText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/nu\s+mber/gi, 'number')
    .replace(/H\s+i\s+/g, 'Hi ')
    .replace(/F\s*TT\s*B/g, 'FTTB')
    .replace(/F\s*TT\s*P/g, 'FTTP')
    .replace(/F\s*TT\s*N/g, 'FTTN')
    .replace(/F\s*TT\s*C/g, 'FTTC')
    .replace(/F\s*TT\s*R/g, 'FTTR')
    .replace(/H\s*F\s*C/g, 'HFC')
    .replace(/we'\s*ll/g, "we'll")
    .replace(/Confidential\s*/g, '')
    .trim();
}

function replacePdfVariables(text) {
  const sortedBrand = Object.keys(BRAND_MARKS).sort((a, b) => b.length - a.length);
  let result = text;
  const placeholders = {};
  let idx = 0;

  for (const varKey of sortedBrand) {
    const escaped = varKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const replacement = BRAND_MARKS[varKey];
    const placeholder = `__BRAND${idx}__`;
    result = result.replace(regex, placeholder);
    placeholders[placeholder] = replacement;
    idx++;
  }

  const dataVarPatterns = [
    'BILLING EMAIL', 'CONTACT EMAIL', 'TERMS NAME', 'APPOINTMENT DATE',
    'NBN APPOINTMENT ID', 'APPOINTMENT ID', 'ACCOUNT NUMBER', 'ORDER NUMBER',
    'INSTALLATION ADDRESS', 'ACTIVATION DATE', 'NEW APPOINTMENT DATE',
    'RESCHEDULED APPOINTMENT DATE', 'QUOTE NUMBER', 'OTP CODE', 'PLAN',
    'DATE', 'NAME', 'REFUND AMOUNT', 'DOWNLOAD MAX SPEED', 'UPLOAD MAX SPEED',
    'DOWNLOAD ACTUAL SPEED', 'UPLOAD ACTUAL SPEED', 'SERVICE ID',
    'TRACKING NUMBER', 'TRACKING URL', 'CARRIER', 'PRODUCT NAME',
    'INVOICE NUMBER', 'INVOICE DATE', 'AMOUNT DUE', 'DUE DATE',
    'PAYMENT METHOD', 'CARD TYPE', 'LAST FOUR DIGITS', 'EXPIRY DATE',
    'PAYMENT AMOUNT', 'PAYMENT DATE', 'REFERENCE NUMBER', 'RECEIPT NUMBER',
    'OVERDUE AMOUNT', 'NEW ADDRESS', 'OLD ADDRESS', 'MOBILE NUMBER',
    'SIM TYPE', 'ACTIVATION CODE', 'QR CODE', 'ESIM ACTIVATION CODE',
    'CASE NUMBER', 'CASE ID', 'CREDIT AMOUNT', 'TOTAL AMOUNT',
    'OUTSTANDING AMOUNT', 'TRANSFER DATE', 'NEW ACCOUNT HOLDER',
    'CURRENT ACCOUNT HOLDER', 'OCR LINK', 'DIRECT DEBIT LINK',
    'STATIC IP CALCULATION',
  ];

  const sortedData = dataVarPatterns.sort((a, b) => b.length - a.length);
  for (const varKey of sortedData) {
    const escaped = varKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const snakeCase = varKey.replace(/\s+/g, '_');
    const placeholder = `__DATA${idx}__`;
    result = result.replace(regex, placeholder);
    placeholders[placeholder] = `%%${snakeCase}%%`;
    idx++;
  }

  for (const [ph, val] of Object.entries(placeholders)) {
    result = result.replace(new RegExp(ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), val);
  }

  return result;
}

function processPdfEmail(rawText, filename) {
  let text = normalizePdfText(rawText);

  const emailIdx = text.search(/Email\s*copy/i);
  if (emailIdx === -1) return null;

  let emailText = text.substring(emailIdx + 10).trim();
  if (/^\s*N\/?A/i.test(emailText)) return null;

  let subject = '';
  const subjMatch = emailText.match(/Subject:\s*(.*?)(?=\s{2,}(?:Let|Hi|Order|Reference|Here|Your|We|Dear))/i);
  if (subjMatch) {
    subject = subjMatch[1].trim();
  } else {
    const subjMatch2 = emailText.match(/Subject:\s*(.*?)$/im);
    if (subjMatch2) subject = subjMatch2[1].trim();
  }

  const cutPoints = [
    /Commented\s*\[/i,
    /Things you need to know/i,
    /At\s+BRAND\s*,?\s*we want to ensure/i,
    /This email was sent to you by/i,
  ];
  for (const cp of cutPoints) {
    const cpIdx = emailText.search(cp);
    if (cpIdx !== -1) emailText = emailText.substring(0, cpIdx);
  }

  emailText = emailText.replace(/^.*?Subject:.*?(?=\s{2,})/i, '').trim();
  emailText = emailText.replace(/From:\s*"[^"]*"\s*<[^>]*>\s*/gi, '');
  emailText = emailText.replace(/To:\s*CONTACT\s*EMAIL\s*/gi, '');
  emailText = emailText.replace(/To:\s*BILLING\s*EMAIL\s*/gi, '');

  const thanksIdx = emailText.search(/Thanks\s*,\s*(The|Your)\s+BRAND\s+Team/i);
  if (thanksIdx !== -1) emailText = emailText.substring(0, thanksIdx);

  subject = replacePdfVariables(subject);
  emailText = replacePdfVariables(emailText);

  let paragraphs = emailText.split(/\s{3,}/).filter(s => s.trim());
  const rows = [];

  for (let para of paragraphs) {
    para = para.trim();
    if (!para) continue;
    rows.push(para);
  }

  const finalRows = [];
  for (let i = 0; i < rows.length; i++) {
    const stripped = typeof rows[i] === 'string' ? rows[i].replace(/<[^>]+>/g, '').trim() : '';
    if (stripped.match(/^Thanks\s*,?\s*$/i)) continue;
    if (stripped.match(/^(The|Your)\s+\{\{brand\.displayName\}\}\s*Team$/i)) continue;
    finalRows.push(rows[i]);
  }

  return { subject, rows: finalRows };
}

function getAllFiles(dir, fileList = []) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      getAllFiles(fullPath, fileList);
    } else if ((item.endsWith('.docx') || item.endsWith('.pdf')) && !item.startsWith('.~lock')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

async function main() {
  if (!fs.existsSync(configsDir)) fs.mkdirSync(configsDir, { recursive: true });

  const allFiles = getAllFiles(docsDir);
  console.log(`Found ${allFiles.length} document files in batch 2\n`);

  const smsOnly = [];
  const emailDocs = [];
  const skipped = [];
  const existing = [];
  let created = 0;

  for (const filePath of allFiles) {
    const file = path.basename(filePath);
    const slug = fileToSlug(file);
    const relPath = path.relative(docsDir, filePath);

    const baseName = file.replace(/\s*\(\d+\)\s*/g, '').replace(/\.docx$|\.pdf$/i, '');
    if (SMS_ONLY_FILES.includes(baseName)) {
      smsOnly.push({ file, slug, relPath, reason: 'SMS only (known)' });
      continue;
    }
    if (SKIP_FILES.some(s => baseName.includes(s))) {
      skipped.push({ file, slug, relPath, reason: 'Not a template' });
      continue;
    }

    const templatePath = path.join(templatesDir, `${slug}.hbs`);
    if (fs.existsSync(templatePath)) {
      existing.push({ file, slug, relPath });
      continue;
    }

    if (file.endsWith('.docx')) {
      try {
        const result = await mammoth.convertToHtml(
          { path: filePath },
          { styleMap: ['highlight => mark'] }
        );
        const html = result.value;
        const classification = classifyDocHtml(html);

        if (classification === 'sms') {
          smsOnly.push({ file, slug, relPath, reason: 'Format: SMS only' });
          continue;
        }

        const emailContent = extractEmailSectionHtml(html);
        if (!emailContent) {
          if (classification === 'email_and_sms') {
            smsOnly.push({ file, slug, relPath, reason: 'Email & SMS but email copy is N/A' });
          } else {
            skipped.push({ file, slug, relPath, reason: 'No email section found' });
          }
          continue;
        }

        const { subject, rows } = processDocxEmail(emailContent);
        if (rows.length === 0) {
          skipped.push({ file, slug, relPath, reason: 'Empty email body' });
          continue;
        }

        const template = buildTemplate(slug, subject, rows);
        const configVars = extractConfigVariables(template);

        fs.writeFileSync(templatePath, template);
        fs.writeFileSync(path.join(configsDir, `${slug}.json`), JSON.stringify(configVars, null, 2));

        emailDocs.push({ file, slug, relPath, subject, varCount: Object.keys(configVars).length, rowCount: rows.length });
        created++;
        console.log(`[CREATED] ${slug}.hbs (${rows.length} rows, ${Object.keys(configVars).length} vars) <- ${relPath}`);
      } catch (err) {
        console.error(`[ERROR] ${file}: ${err.message}`);
        skipped.push({ file, slug, relPath, reason: err.message });
      }
    } else if (file.endsWith('.pdf')) {
      try {
        const text = await parsePDF(filePath);
        const classification = classifyPdfText(text);

        if (classification === 'sms') {
          smsOnly.push({ file, slug, relPath, reason: 'Format: SMS only (PDF)' });
          continue;
        }

        const result = processPdfEmail(text, file);
        if (!result) {
          if (classification === 'unknown') {
            skipped.push({ file, slug, relPath, reason: 'Unable to detect format in PDF' });
          } else {
            smsOnly.push({ file, slug, relPath, reason: 'Email copy is N/A (PDF)' });
          }
          continue;
        }

        if (result.rows.length === 0) {
          skipped.push({ file, slug, relPath, reason: 'Empty email body (PDF)' });
          continue;
        }

        const template = buildTemplate(slug, result.subject, result.rows);
        const configVars = extractConfigVariables(template);

        fs.writeFileSync(templatePath, template);
        fs.writeFileSync(path.join(configsDir, `${slug}.json`), JSON.stringify(configVars, null, 2));

        emailDocs.push({ file, slug, relPath, subject: result.subject, varCount: Object.keys(configVars).length, rowCount: result.rows.length });
        created++;
        console.log(`[CREATED] ${slug}.hbs (${result.rows.length} rows, ${Object.keys(configVars).length} vars) <- ${relPath}`);
      } catch (err) {
        console.error(`[ERROR-PDF] ${file}: ${err.message}`);
        skipped.push({ file, slug, relPath, reason: err.message });
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total files scanned: ${allFiles.length}`);
  console.log(`Templates created: ${created}`);
  console.log(`Already existing (batch 1): ${existing.length}`);
  console.log(`SMS-only excluded: ${smsOnly.length}`);
  console.log(`Skipped/errors: ${skipped.length}`);

  if (smsOnly.length > 0) {
    console.log('\n--- SMS-Only Documents ---');
    smsOnly.forEach(s => console.log(`  ${s.relPath}: ${s.reason}`));
  }
  if (skipped.length > 0) {
    console.log('\n--- Skipped/Errors ---');
    skipped.forEach(s => console.log(`  ${s.relPath}: ${s.reason}`));
  }
  if (existing.length > 0) {
    console.log('\n--- Already Existing (batch 1) ---');
    existing.forEach(s => console.log(`  ${s.slug} <- ${s.relPath}`));
  }
  if (emailDocs.length > 0) {
    console.log('\n--- Created Templates ---');
    emailDocs.forEach(d => console.log(`  ${d.slug}: "${d.subject}" [${d.varCount} vars, ${d.rowCount} rows]`));
  }
}

main().catch(console.error);
