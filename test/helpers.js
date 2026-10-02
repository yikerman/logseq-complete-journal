import { dayKey } from '../src/journals.js';

export const localDate = (year, month, day) => new Date(year, month - 1, day, 12);
export const title = date => String(dayKey(date));
export function journal(day, file = true, name = String(day)) {
  return { name, originalName: name, uuid: `page-${day}`, 'journal?': true, journalDay: day, ...(file ? { file: { id: day } } : {}) };
}

export function host(initialPages = [journal(20260101)]) {
  const pages = structuredClone(initialPages);
  const blocks = new Map();
  const writes = [];
  const messages = [];
  const stateWrites = [];
  const hooks = new Map();
  const state = { graph: { url: 'graph-a' }, loading: {}, restoring: false, journalsLength: 3 };
  let palette;
  const hook = key => fn => { hooks.set(key, fn); return () => hooks.delete(key); };
  const api = {
    settings: { autoFill: true },
    useSettingsSchema() {},
    onSettingsChanged: hook('settings'),
    UI: { async showMsg(...args) { messages.push(args); } },
    App: {
      async getCurrentGraph() { return state.graph; },
      async getStateFromStore(key) {
        if (key === 'repo/loading-files?') return state.loading;
        if (key === 'journals-length') return state.journalsLength;
        return state.restoring;
      },
      async setStateFromStore(key, value) {
        stateWrites.push({ key, value });
        if (key === 'journals-length') state.journalsLength = value;
      },
      async getUserConfigs() { return { enabledJournals: true, preferredFormat: 'markdown', preferredDateFormat: 'yyyyMMdd' }; },
      registerCommandPalette(options, callback) { palette = callback; },
      onCurrentGraphChanged: hook('graph'),
      onGraphAfterIndexed: hook('indexed'),
      onRouteChanged: hook('route'),
      onTodayJournalCreated: hook('today'),
    },
    Editor: {
      async getAllPages() { return structuredClone(pages); },
      async getPage(name) { return pages.find(page => page.name === name) ?? null; },
      async createPage(name, properties, options) {
        writes.push({ method: 'createPage', name, properties, options });
        const page = journal(Number(name), false, name);
        pages.push(page);
        return page;
      },
      async getPageBlocksTree(uuid) { return blocks.get(uuid) ?? []; },
      async insertBlock(uuid, content, options) {
        writes.push({ method: 'insertBlock', uuid, content, options });
        const block = { uuid: `block-${uuid}`, content };
        blocks.set(uuid, [...(blocks.get(uuid) ?? []), block]);
        // Deliberately leave page.file unset to model asynchronous file writes.
        return block;
      },
    },
  };
  return { api, pages, blocks, writes, messages, state, stateWrites, hooks, manual: () => palette() };
}
