/** Numeric YYYYMMDD keys use local calendar dates, never UTC timestamps. */
export function dayKey(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

export function dateFromDay(key) {
  if (!Number.isInteger(key) || key < 10000101 || key > 99991231) return null;
  const year = Math.floor(key / 10000);
  const month = Math.floor(key / 100) % 100;
  const day = key % 100;
  const date = new Date(year, month - 1, day, 12);
  return dayKey(date) === key ? date : null;
}

/** References alone do not establish the beginning of a journal history. */
export function planJournals(pages, today = new Date()) {
  const journals = pages.filter(page => page['journal?'] === true && dateFromDay(page.journalDay));
  const end = dayKey(today);
  const existing = new Set(journals.filter(page => page.file).map(page => page.journalDay));
  const anchors = [...existing].filter(day => day <= end);
  if (!anchors.length) return [];
  const first = anchors.reduce((a, b) => Math.min(a, b));
  const byDay = new Map(journals.map(page => [page.journalDay, page]));
  const missing = [];
  const date = dateFromDay(first);
  // Calendar arithmetic handles leap years, month boundaries, and DST.
  while (dayKey(date) <= end) {
    const day = dayKey(date);
    if (!existing.has(day)) missing.push({ day, date: new Date(date), page: byDay.get(day) });
    date.setDate(date.getDate() + 1);
  }
  return missing;
}

export class Cancelled extends Error {}

/**
 * All writes go through Logseq so its index, journal directory, and file names
 * stay in sync. checkActive is checked after reads and immediately before writes.
 */
export async function fillJournals(api, formatDate, { today = new Date(), checkActive = async () => {} } = {}) {
  await checkActive();
  const config = await api.App.getUserConfigs();
  if (!config.enabledJournals) return { created: 0, reason: 'disabled' };
  if (config.preferredFormat !== 'markdown') {
    throw new Error('Complete Journal currently supports Markdown file graphs only.');
  }
  const pages = await api.Editor.getAllPages();
  if (!Array.isArray(pages)) throw new Error('The graph is not ready. Try again after indexing finishes.');
  await checkActive();
  const plan = planJournals(pages, today);
  let created = 0;
  for (const { day, date, page: knownPage } of plan) {
    await checkActive();
    // Reuse old titles when the graph's date format has changed.
    const name = knownPage?.originalName || knownPage?.name || formatDate(date, config.preferredDateFormat);
    let page = await api.Editor.getPage(name);
    if (page?.file) continue;
    if (!page) {
      await checkActive();
      page = await api.Editor.createPage(name, {}, {
        journal: true,
        format: 'markdown',
        createFirstBlock: false,
        redirect: false,
      });
    }
    if (!page || page['journal?'] !== true || page.journalDay !== day) {
      throw new Error(`Logseq did not recognize "${name}" as journal day ${day}. Check the journal date format.`);
    }
    await checkActive();
    const blocks = await api.Editor.getPageBlocksTree(page.uuid);
    if (!Array.isArray(blocks)) throw new Error(`Could not read journal "${name}".`);
    // Logseq 0.10.x deliberately skips saving a fileless page with ONE blank
    // block. Two blank blocks trigger persistence without adding journal text.
    // Also finish a previous interrupted attempt that inserted just one block.
    if (blocks.length > 1 || (blocks.length === 1 && (
      typeof blocks[0].content !== 'string' || blocks[0].content.trim() !== '' || blocks[0].children?.length
    ))) continue;
    for (let count = blocks.length; count < 2; count += 1) {
      await checkActive();
      const block = await api.Editor.insertBlock(page.uuid, '', { sibling: false, focus: false });
      if (!block) throw new Error(`Could not create an empty block in journal "${name}".`);
    }
    created += 1;
  }
  return { created, reason: pages.some(page => page['journal?'] && page.file && dateFromDay(page.journalDay) && page.journalDay <= dayKey(today)) ? 'complete' : 'empty' };
}
