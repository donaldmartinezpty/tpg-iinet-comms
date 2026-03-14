const mammoth = require('mammoth');
const PDFParser = require('pdf2json');
const fs = require('fs');
const path = require('path');

const docsDir = path.join(__dirname, '..', 'src', 'docs');
const templatesDir = path.join(__dirname, '..', 'src', 'templates');
const configsDir = path.join(templatesDir, 'configs');

const BRAND_VARIABLES = {
  'BRAND PHONE NUMBER': '{{brand.support.phone}}',
  'NBN SUPPORT NUMBER': '{{brand.support.phone}}',
  'SUPPORT NUMBER': '{{brand.support.phone}}',
  'BRAND SUPPORT NUMBER': '{{brand.support.phone}}',
  'NO-REPLY EMAIL': '{{brand.noReplyEmail}}',
  'SECURITY INFO URL': '{{brand.support.url}}',
  'ONEAPP NAME': '{{brand.app.name}}',
  'ONEAPP URL': '{{brand.oneAppUrl}}',
  'NBN CIS URL': '{{brand.nbnCisUrl}}',
  'OPTICOMM CIS URL': '{{brand.opticommCisUrl}}',
  'VISION CIS URL': '{{brand.visionCisUrl}}',
  'TERMS URL': '{{brand.termsUrl}}',
  'MODEM GUIDE DIRECTORY URL': '{{brand.modemGuideUrl}}',
  'MODEM BYO GUIDE DIRECTORY URL': '{{brand.modemByoGuideUrl}}',
  'BRAND': '{{brand.displayName}}',
};

const DATA_VARIABLES = {
  'BILLING EMAIL': '{{billingEmail}}',
  'CONTACT EMAIL': '{{contactEmail}}',
  'TERMS NAME': '{{termsName}}',
  'APPOINTMENT DATE': '{{appointmentDate}}',
  'NBN APPOINTMENT ID': '{{appointmentId}}',
  'APPOINTMENT ID': '{{appointmentId}}',
  'ACCOUNT NUMBER': '{{accountNumber}}',
  'ORDER NUMBER': '{{orderNumber}}',
  'INSTALLATION ADDRESS': '{{installationAddress}}',
  'ACTIVATION DATE': '{{activationDate}}',
  'NEW APPOINTMENT DATE': '{{newAppointmentDate}}',
  'RESCHEDULED APPOINTMENT DATE': '{{rescheduledAppointmentDate}}',
  'QUOTE NUMBER': '{{quoteNumber}}',
  'OTP CODE': '{{otpCode}}',
  'PLAN': '{{plan}}',
  'DATE': '{{activationDate}}',
  'NAME': '{{name}}',
};

function fileToSlug(filename) {
  return filename
    .replace(/\s*\(\d+\)\s*/g, '')
    .replace(/\.docx$|\.pdf$/i, '')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase();
}

function classifyDocHtml(html) {
  const formatMatch = html.match(/<strong>Format<\/strong>.*?<\/td>\s*<td>(.*?)<\/td>/si);
  if (!formatMatch) return 'unknown';
  const formatText = formatMatch[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
  if (formatText.includes('email') && formatText.includes('sms')) return 'email_and_sms';
  if (formatText.includes('email')) return 'email';
  if (formatText.includes('sms')) return 'sms';
  return 'unknown';
}

function markToVariable(markText) {
  const upper = markText.toUpperCase().trim();

  const allVars = { ...BRAND_VARIABLES, ...DATA_VARIABLES };
  const sorted = Object.keys(allVars).sort((a, b) => b.length - a.length);
  for (const k of sorted) {
    if (upper === k) return allVars[k];
  }

  if (upper === 'BRAND') return '{{brand.displayName}}';

  const camel = markText.trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase());
  return '{{' + camel + '}}';
}

function extractEmailSectionHtml(html) {
  const emailIdx = html.search(/<h3[^>]*>[^<]*Email\s*copy[^<]*<\/h3>/i);
  if (emailIdx === -1) return null;

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
  }

  let bodyHtml = html;
  const subjEnd = html.search(/<strong>Subject:<\/strong>.*?<\/p>/si);
  if (subjEnd !== -1) {
    const afterSubj = html.substring(subjEnd);
    const pEnd = afterSubj.indexOf('</p>');
    if (pEnd !== -1) bodyHtml = afterSubj.substring(pEnd + 4);
  } else {
    const fromMatch = html.match(/<p>.*?<strong>From:<\/strong>.*?<\/p>/si);
    const toMatch = html.match(/<p>.*?<strong>To:<\/strong>.*?<\/p>/si);
    if (fromMatch) bodyHtml = bodyHtml.replace(fromMatch[0], '');
    if (toMatch) bodyHtml = bodyHtml.replace(toMatch[0], '');
  }

  const cutPatterns = [
    /<h6[^>]*>.*?Things you need to know.*?<\/h6>/i,
    /<p>[^<]*At\s*<strong>\s*<\/strong>\s*\{\{brand\.displayName\}\}/i,
    /<p>[^<]*At\s+\{\{brand\.displayName\}\}/i,
    /<p>\s*This email was sent to you by/i,
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
  cleaned = cleaned.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '</p><p><strong>$1</strong></p><p>');
  cleaned = cleaned.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '');

  const segments = cleaned.split(/<\/p>/i).map(s => s.replace(/^\s*<p[^>]*>/i, '').trim()).filter(Boolean);
  const rows = [];

  for (let seg of segments) {
    if (seg.match(/^<strong>From:<\/strong>/i)) continue;
    if (seg.match(/^<strong>To:<\/strong>/i)) continue;

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
          items.push(m[1].replace(/<[^>]+>/g, '').trim());
        }
        if (items.length) rows.push({ type: 'list', items });
      }

      const afterUlIdx = seg.indexOf('</ul>');
      if (afterUlIdx !== -1) {
        const afterUl = seg.substring(afterUlIdx + 5).replace(/^\s*<p[^>]*>/i, '').trim();
        if (afterUl) rows.push(afterUl);
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
    if ((stripped === 'Thanks,' || stripped === 'Thanks') && i + 1 < rows.length) {
      const nextStripped = typeof rows[i + 1] === 'string'
        ? rows[i + 1].replace(/<[^>]+>/g, '').trim()
        : '';
      if (nextStripped.match(/^The\s+\{\{brand\.displayName\}\}\s*Team$/i)) {
        i++;
        continue;
      }
    }
    if (stripped.match(/^<strong>The\s+\{\{brand\.displayName\}\}\s*Team<\/strong>$/i)) continue;
    if (stripped.match(/^The\s+\{\{brand\.displayName\}\}\s*Team$/i)) continue;

    finalRows.push(row);
  }

  return finalRows;
}

function buildTemplate(subject, rows) {
  const title = subject || 'Notification';
  const tdStyle = 'font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 24px; color: {{brand.colors.text}}; padding-bottom: 20px;';
  const liStyle = 'font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 24px; color: {{brand.colors.text}}; padding-bottom: 8px;';

  let bodyRows = '';
  for (const row of rows) {
    if (typeof row === 'object' && row.type === 'list') {
      let listHtml = `          <ul style="padding-left: 20px; margin: 0 0 20px 0;">\n`;
      for (const item of row.items) {
        listHtml += `            <li style="${liStyle}">${item}</li>\n`;
      }
      listHtml += `          </ul>`;
      bodyRows += `      <tr>\n        <td style="${tdStyle}">\n${listHtml}\n        </td>\n      </tr>\n`;
    } else {
      bodyRows += `      <tr>\n        <td style="${tdStyle}">\n          ${row}\n        </td>\n      </tr>\n`;
    }
  }

  return `{{> header title="${title}"}}

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

{{> footer}}
`;
}

function extractConfigVariables(templateContent) {
  const vars = {};
  const varRegex = /\{\{([^}>/#][^}]*)\}\}/g;
  let m;
  while ((m = varRegex.exec(templateContent)) !== null) {
    const varName = m[1].trim();
    if (varName.startsWith('brand.') || varName.startsWith('>') ||
        varName === 'brand.colors.text') continue;
    vars[varName] = 'PLACEHOLDER';
  }
  return vars;
}

// --- PDF Processing ---

function parsePDF(filepath) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, 1);
    parser.on('pdfParser_dataReady', (data) => {
      let text = '';
      data.Pages.forEach(page => {
        page.Texts.forEach(t => {
          t.R.forEach(r => { text += decodeURIComponent(r.T) + ' '; });
        });
        text += ' ';
      });
      resolve(text);
    });
    parser.on('pdfParser_dataError', reject);
    parser.loadPDF(filepath);
  });
}

function classifyPdfText(text) {
  const formatMatch = text.match(/Format\s+(.*?)(?:Brands)/si);
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
  const allVars = { ...BRAND_VARIABLES, ...DATA_VARIABLES };
  const sorted = Object.keys(allVars).sort((a, b) => b.length - a.length);

  let result = text;
  const placeholders = {};
  let idx = 0;

  for (const varKey of sorted) {
    const escaped = varKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const replacement = allVars[varKey];
    const placeholder = `__VAR${idx}__`;
    result = result.replace(regex, placeholder);
    placeholders[placeholder] = replacement;
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
  const subjMatch = emailText.match(/Subject:\s*(.*?)(?=\s{2,}(?:Let|Hi|Order|Reference|Here|Your|We))/i);
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

  const thanksIdx = emailText.search(/Thanks\s*,\s*The\s+BRAND\s+Team/i);
  if (thanksIdx !== -1) emailText = emailText.substring(0, thanksIdx);

  subject = replacePdfVariables(subject);
  emailText = replacePdfVariables(emailText);

  const sentenceSplitters = [
    /(?<=\.)\s{2,}/,
    /\s{3,}/,
  ];

  let paragraphs = emailText.split(/\s{3,}/).filter(s => s.trim());
  const rows = [];

  for (let para of paragraphs) {
    para = para.trim();
    if (!para) continue;
    if (para.match(/^\s*$/)) continue;

    if (para.match(/^(Hi\s|Let's|Order\s*number|Your plan|Your technology|Modem|Installation|Your\s)/i)) {
      rows.push(`<strong>${para}</strong>`);
    } else {
      rows.push(para);
    }
  }

  const finalRows = [];
  for (let i = 0; i < rows.length; i++) {
    const stripped = typeof rows[i] === 'string' ? rows[i].replace(/<[^>]+>/g, '').trim() : '';
    if (stripped.match(/^Thanks\s*,?\s*$/i)) continue;
    if (stripped.match(/^The\s+\{\{brand\.displayName\}\}\s*Team$/i)) continue;
    finalRows.push(rows[i]);
  }

  return { subject, rows: finalRows };
}

async function main() {
  if (!fs.existsSync(configsDir)) fs.mkdirSync(configsDir, { recursive: true });

  const files = fs.readdirSync(docsDir).filter(f =>
    (f.endsWith('.docx') || f.endsWith('.pdf')) && !f.startsWith('.~lock')
  );

  const smsOnly = [];
  const emailDocs = [];
  const skipped = [];

  for (const file of files) {
    const filePath = path.join(docsDir, file);
    const slug = fileToSlug(file);

    if (file.endsWith('.docx')) {
      try {
        const result = await mammoth.convertToHtml(
          { path: filePath },
          { styleMap: ['highlight => mark'] }
        );
        const html = result.value;
        const classification = classifyDocHtml(html);

        if (classification === 'sms') {
          smsOnly.push({ file, slug, reason: 'Format: SMS only' });
          continue;
        }

        const emailContent = extractEmailSectionHtml(html);
        if (!emailContent) {
          if (classification === 'email_and_sms') {
            smsOnly.push({ file, slug, reason: 'Format: Email & SMS but email copy is N/A' });
          } else {
            skipped.push({ file, slug, reason: 'No email content found' });
          }
          continue;
        }

        const { subject, rows } = processDocxEmail(emailContent);
        const template = buildTemplate(subject, rows);
        const configVars = extractConfigVariables(template);

        fs.writeFileSync(path.join(templatesDir, `${slug}.hbs`), template);
        fs.writeFileSync(path.join(configsDir, `${slug}.json`), JSON.stringify(configVars, null, 2));

        emailDocs.push({ file, slug, subject, variables: Object.keys(configVars) });
        console.log(`[EMAIL] ${file} -> ${slug}.hbs (${rows.length} rows, ${Object.keys(configVars).length} vars)`);
      } catch (err) {
        console.error(`[ERROR] ${file}: ${err.message}`);
        skipped.push({ file, slug, reason: err.message });
      }
    } else if (file.endsWith('.pdf')) {
      try {
        const text = await parsePDF(filePath);
        const classification = classifyPdfText(text);

        if (classification === 'sms') {
          smsOnly.push({ file, slug, reason: 'Format: SMS only (PDF)' });
          continue;
        }
        if (classification === 'unknown') {
          skipped.push({ file, slug, reason: 'Unable to detect format in PDF' });
          continue;
        }

        const result = processPdfEmail(text, file);
        if (!result) {
          smsOnly.push({ file, slug, reason: 'Email copy is N/A (PDF)' });
          continue;
        }

        const template = buildTemplate(result.subject, result.rows);
        const configVars = extractConfigVariables(template);

        fs.writeFileSync(path.join(templatesDir, `${slug}.hbs`), template);
        fs.writeFileSync(path.join(configsDir, `${slug}.json`), JSON.stringify(configVars, null, 2));

        emailDocs.push({ file, slug, subject: result.subject, variables: Object.keys(configVars) });
        console.log(`[EMAIL-PDF] ${file} -> ${slug}.hbs (${result.rows.length} rows, ${Object.keys(configVars).length} vars)`);
      } catch (err) {
        console.error(`[ERROR-PDF] ${file}: ${err.message}`);
        skipped.push({ file, slug, reason: err.message });
      }
    }
  }

  let smsDoc = '# SMS-Only Documents\n\n';
  smsDoc += 'These documents contain only SMS content (no email copy) and were not converted to email templates.\n\n';
  smsDoc += '| File | Reason |\n';
  smsDoc += '|------|--------|\n';
  for (const s of smsOnly) {
    smsDoc += `| ${s.file} | ${s.reason} |\n`;
  }
  fs.writeFileSync(path.join(docsDir, 'SMS_ONLY_DOCS.md'), smsDoc);

  console.log('\n--- Summary ---');
  console.log(`Email templates created: ${emailDocs.length}`);
  console.log(`SMS-only documents: ${smsOnly.length}`);
  console.log(`Skipped: ${skipped.length}`);
  if (skipped.length > 0) {
    console.log('Skipped files:');
    skipped.forEach(s => console.log(`  ${s.file}: ${s.reason}`));
  }
  console.log('\nEmail docs:');
  emailDocs.forEach(d => console.log(`  ${d.slug}: ${d.subject} [${d.variables.join(', ')}]`));
}

main().catch(console.error);
