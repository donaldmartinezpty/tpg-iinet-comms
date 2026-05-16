/**
 * Shared parsing for Collections_Notice_Suite-style Word docs (table rows with From:/Subject:).
 */

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

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

const FROM_NEEDLE = '<p><strong>From:</strong>';

/** Stop before the next suite table row (description/ref cells leak in after </td></tr>). */
function trimCopyCellChunk(htmlChunk) {
  const nextRow = htmlChunk.search(/<\/td>\s*<\/tr>\s*<tr[\s>]/i);
  if (nextRow !== -1) {
    return htmlChunk.slice(0, nextRow);
  }
  return htmlChunk;
}

/**
 * @returns {{ blockIndex, tableDescription, refCode, subject, noticeHeading, htmlChunk }[]}
 */
function extractFromSubjectNoticeChunks(html) {
  const indices = [];
  let pos = 0;
  let idx;
  while ((idx = html.indexOf(FROM_NEEDLE, pos)) !== -1) {
    indices.push(idx);
    pos = idx + FROM_NEEDLE.length;
  }

  return indices.map((fromIdx, i) => {
    const end = i + 1 < indices.length ? indices[i + 1] : html.length;
    const chunk = html.slice(fromIdx, end);
    const subj = chunk.match(/<strong>Subject:\s*<\/strong>\s*([^<]+)/i);
    const h3match = chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const { description, refCode } = getRowCellsForFromBlock(html, fromIdx);
    return {
      blockIndex: i + 1,
      tableDescription: description,
      refCode,
      subject: subj ? subj[1].trim() : '',
      noticeHeading: h3match ? stripTags(h3match[1]).trim() : '',
      htmlChunk: trimCopyCellChunk(chunk),
    };
  });
}

const MAX_SLUG_PART_LEN = 72;

function descriptionToSlugBase(tableDescription) {
  let label = tableDescription.split(/\s+Sent when/i)[0].trim();
  const dashSplit = label.split(/\s+-\s+/);
  if (dashSplit.length > 1) {
    label = dashSplit.slice(0, 2).join(' - ');
  }
  let slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  if (slug.length > MAX_SLUG_PART_LEN) {
    slug = slug.slice(0, MAX_SLUG_PART_LEN).replace(/-+$/, '');
  }
  return slug;
}

function refCodeToSuffix(refCode) {
  const codes = (refCode || '')
    .split(/\s+/)
    .map((c) =>
      c
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .replace(/^iinet_?/, '')
        .replace(/^tpg_?/, '')
    )
    .filter(Boolean);
  const unique = [...new Set(codes)];
  return unique.slice(0, 2).join('-').slice(0, 40);
}

/**
 * @param {string} tableDescription
 * @param {string} refCode
 * @param {number} blockIndex
 * @param {Set<string>} usedSlugs
 */
function assignSlug(tableDescription, refCode, blockIndex, usedSlugs) {
  const descPart = descriptionToSlugBase(tableDescription) || `notice-${blockIndex}`;
  const refPart = refCodeToSuffix(refCode);
  let slug = refPart
    ? `collections-${descPart}-${refPart}`
    : `collections-${descPart}`;

  if (slug.length > 120) {
    slug = refPart
      ? `collections-${refPart}-${blockIndex}`
      : `collections-notice-${blockIndex}`;
  }

  if (usedSlugs.has(slug)) {
    slug = `${slug}-${blockIndex}`;
  }
  let n = blockIndex;
  while (usedSlugs.has(slug)) {
    slug = `collections-notice-${n}`;
    n += 1;
  }
  usedSlugs.add(slug);
  return slug;
}

module.exports = {
  stripTags,
  getRowCellsForFromBlock,
  trimCopyCellChunk,
  extractFromSubjectNoticeChunks,
  descriptionToSlugBase,
  assignSlug,
  FROM_NEEDLE,
};
