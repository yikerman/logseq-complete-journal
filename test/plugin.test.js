import test from 'node:test';
import assert from 'node:assert/strict';
import { startPlugin } from '../src/plugin.js';
import { host, localDate, title } from './helpers.js';

function start(t, h) {
  const plugin = startPlugin(h.api, title, { now: () => localDate(2026, 1, 3), debounceMs: 60_000 });
  t.after(() => plugin.dispose());
  return plugin;
}

test('simultaneous triggers serialize and do not duplicate blocks', async t => {
  const h = host();
  const plugin = start(t, h);
  await Promise.all([plugin.request(), plugin.request(), h.manual()]);
  assert.equal(h.writes.filter(w => w.method === 'insertBlock').length, 4);
});

test('automatic filling can be disabled while the manual command still works', async t => {
  const h = host();
  h.api.settings.autoFill = false;
  const plugin = start(t, h);
  await plugin.request();
  assert.equal(h.writes.length, 0);
  await h.manual();
  assert.equal(h.writes.filter(w => w.method === 'insertBlock').length, 4);
});

test('graph changes abort the old run before the next write', async t => {
  const h = host();
  const plugin = start(t, h);
  h.api.Editor.getPageBlocksTree = async () => {
    h.state.graph = { url: 'graph-b' };
    h.hooks.get('graph')();
    return [];
  };
  await plugin.request();
  assert.equal(h.writes.filter(w => w.method === 'insertBlock').length, 0);
  assert.equal(h.messages.length, 0);
});

test('does not write while indexing and responds to the indexing hook', async t => {
  const h = host();
  const plugin = start(t, h);
  h.state.loading['graph-a'] = true;
  await h.manual();
  assert.equal(h.writes.length, 0);
  assert.match(h.messages[0][0], /still loading/);
  h.state.loading['graph-a'] = false;
  h.hooks.get('indexed')();
  await plugin.request();
  assert.equal(h.writes.filter(w => w.method === 'insertBlock').length, 4);
});

test('unloading cancels a pending run and removes hooks', async t => {
  const h = host();
  const plugin = start(t, h);
  h.api.Editor.getPageBlocksTree = async () => { plugin.dispose(); return []; };
  await plugin.request();
  assert.equal(h.writes.filter(w => w.method === 'insertBlock').length, 0);
  assert.equal(h.hooks.size, 0);
});

test('refreshes journals after backfill without resetting the loaded history', async t => {
  const h = host();
  h.state.journalsLength = 17;
  const plugin = start(t, h);
  const setState = h.api.App.setStateFromStore;
  h.api.App.setStateFromStore = async (...args) => {
    assert.equal(h.writes.filter(w => w.method === 'insertBlock').length, 4);
    return setState(...args);
  };
  await plugin.request();
  assert.deepEqual(h.stateWrites, [{ key: 'journals-length', value: 18 }]);
  await h.manual();
  assert.equal(h.stateWrites.length, 1, 'a run with no missing days should not refresh');
});

test('does not refresh the new graph if the graph changes at the end of backfill', async t => {
  const h = host();
  const plugin = start(t, h);
  const getState = h.api.App.getStateFromStore;
  h.api.App.getStateFromStore = async key => {
    if (key === 'journals-length') {
      h.state.graph = { url: 'graph-b' };
      h.hooks.get('graph')();
    }
    return getState(key);
  };
  await plugin.request();
  assert.equal(h.writes.filter(w => w.method === 'insertBlock').length, 4);
  assert.equal(h.stateWrites.length, 0);
});
