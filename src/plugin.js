import { Cancelled, fillJournals } from './journals.js';

/** Coalesce host events and serialize runs, including across graph switches. */
export function startPlugin(api, formatDate, { debounceMs = 1500, intervalMs = 60_000, now = () => new Date() } = {}) {
  let disposed = false;
  let generation = 0;
  let timer;
  let running;
  let pending = false;
  let manualPending = false;

  const notify = (message, status = 'success') => api.UI.showMsg(`Complete Journal: ${message}`, status);

  async function drain() {
    while (pending && !disposed) {
      const manual = manualPending;
      pending = false;
      manualPending = false;
      if (!manual && api.settings?.autoFill === false) continue;
      const runGeneration = generation;
      try {
        const graph = await api.App.getCurrentGraph();
        if (!graph) {
          if (manual) await notify('Open a graph first.', 'warning');
          continue;
        }
        const [loading, restoring] = await Promise.all([
          api.App.getStateFromStore('repo/loading-files?'),
          api.App.getStateFromStore('db/restoring?'),
        ]);
        if (loading?.[graph.url] || restoring) {
          if (manual) await notify('The graph is still loading. Try again when indexing finishes.', 'warning');
          schedule();
          continue;
        }
        const checkActive = async () => {
          if (disposed || generation !== runGeneration || (!manual && api.settings?.autoFill === false)) throw new Cancelled();
          const current = await api.App.getCurrentGraph();
          if (disposed || generation !== runGeneration || current?.url !== graph.url) throw new Cancelled();
        };
        const result = await fillJournals(api, formatDate, { today: now(), checkActive });
        await checkActive();
        if (result.created > 0) {
          // The file-graph journal view subscribes to journals-length and
          // queries without cache on render. Expanding its window by one
          // refreshes it without navigating away or resetting loaded history.
          const length = await api.App.getStateFromStore('journals-length');
          await checkActive();
          await api.App.setStateFromStore('journals-length',
            (Number.isInteger(length) && length > 0 ? length : 3) + 1);
        }
        if (manual || result.created > 0) {
          const message = result.reason === 'empty' ? 'No existing journal files found; nothing to fill.'
            : result.reason === 'disabled' ? 'Journals are disabled in this graph.'
              : result.created ? `Created ${result.created} blank journal${result.created === 1 ? '' : 's'}.`
                : 'No missing journal days.';
          await notify(message);
        }
      } catch (error) {
        if (!(error instanceof Cancelled)) {
          console.error('[Complete Journal]', error);
          await notify(`${error.message || error} Run “Fill missing journals” to retry.`, 'error');
        }
      }
    }
  }

  function request(manual = false) {
    if (disposed) return Promise.resolve();
    pending = true;
    manualPending ||= manual;
    if (!running) running = drain().finally(() => { running = undefined; });
    return running;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { void request(); }, debounceMs);
  }

  api.useSettingsSchema([{
    key: 'autoFill', type: 'boolean', default: true,
    title: 'Automatically fill missing journals',
    description: 'Create blank journals from the earliest existing journal file through today when the graph opens or you navigate. You can also run the command manually.',
  }]);
  api.App.registerCommandPalette({ key: 'fill-missing-journals', label: 'Fill missing journals' }, () => request(true));
  const off = [
    api.App.onCurrentGraphChanged(() => { generation += 1; schedule(); }),
    api.App.onGraphAfterIndexed(() => { generation += 1; schedule(); }),
    api.App.onRouteChanged(schedule),
    api.App.onTodayJournalCreated(schedule),
  ];
  const offSettings = api.onSettingsChanged(() => { generation += 1; schedule(); });
  if (typeof offSettings === 'function') off.push(offSettings);
  let lastDay = now().toDateString();
  const interval = setInterval(() => {
    const today = now().toDateString();
    if (today !== lastDay) { lastDay = today; schedule(); }
  }, intervalMs);
  schedule();
  return {
    request,
    dispose() {
      disposed = true;
      generation += 1;
      clearTimeout(timer);
      clearInterval(interval);
      off.forEach(unsubscribe => { if (typeof unsubscribe === 'function') unsubscribe(); });
    },
  };
}
