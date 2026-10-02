import '@logseq/libs';
import { format } from 'date-fns';
import { startPlugin } from './plugin.js';

logseq.ready(() => {
  const plugin = startPlugin(logseq, format);
  logseq.beforeunload(() => plugin.dispose());
}).catch(error => console.error('[Complete Journal] Failed to initialize', error));
