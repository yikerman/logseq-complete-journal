AI done this in 5 min, wow...

---

# Complete Journal

A Logseq desktop plugin for **Markdown file graphs** that fills every missing journal day from your earliest existing journal file through today, inclusive.

For example, if your graph has journals for October 1 and October 4, and today is October 6, the plugin creates blank journals for October 2, 3, 5, and 6.

## Install locally

Use Node.js 22.18 or newer and npm:

```sh
npm install
npm run build
```

In Logseq:

1. Enable **Developer mode** in Settings → Advanced.
2. Open Plugins and choose **Load unpacked plugin**.
3. Select this project's root folder (the folder containing `package.json`, not `dist`).

Filling starts automatically when the plugin loads. To rebuild after editing the source, run `npm run build` and reload the plugin in Logseq.

## Behavior

- Runs after loading or switching graphs, after indexing, when navigating, and when the local calendar day changes while Logseq stays open.
- The command palette command **Fill missing journals** runs a scan immediately.
- After creating missing entries, refreshes the journal list by showing one additional journal. It preserves the already loaded history and keeps your current page open. Runs that create no entries do not refresh the view.
- Turn off **Automatically fill missing journals** in the plugin settings to use only the manual command.
- Uses Logseq's numeric journal dates for detection and the graph's preferred date format for new titles. Logseq determines journal file names and the configured journal directory (normally `journals/`).
- Preserves existing files and journal content. Dates that exist only as references are materialized when they fall within the journal history.
- Starts at the earliest journal with an associated file. A reference to a much older date does not extend the history. Graphs without an existing journal file are left alone; create your first journal normally.
- Never creates future dates. Uses local calendar arithmetic across leap years and daylight saving transitions.
- Stops an in-progress run when the graph changes or the plugin unloads. Repeating a run fills remaining gaps without duplicating completed pages.

New journals contain **two empty bullets**, with no template or other text. This is intentional: Logseq's file writer skips a new page containing only one empty block. Two empty blocks allow it to create the `.md` file. Logseq writes files asynchronously, so allow a few seconds after the completion message.

The plugin does not remove generated journals when disabled. While automatic filling is enabled, deleting an interior journal causes it to be recreated on a later scan. There is no history cutoff; a long journal history can create many files on the first run.

This implementation targets the desktop file-graph APIs used by Logseq 0.10.x. Database graphs and Org graphs are outside its current scope. A live Logseq smoke test is still needed before claiming compatibility with a particular installed release.

## Development and verification

```sh
npm test
npm run check
npm run build
```

Tests use Node's built-in test runner and a simulated Logseq API, so tests and syntax checks can run without installing dependencies. They cover gaps through today, leap years, DST, invalid dates, empty graphs, references, persistence prerequisites, repeat runs, cancellation, retries, and plugin lifecycle events.

For a desktop smoke test:

1. In a test graph, create journal entries for three days ago and today, leaving the two days between them missing.
2. Keep the Journals view open, then load the plugin or run **Fill missing journals**. Verify both dates appear without navigating away or restarting, and both `.md` files appear in the graph's journal directory after the asynchronous save.
3. Check that the files contain two empty bullets and existing journal contents remain unchanged. Run the command again and confirm it reports no missing days.
4. Reference one missing date from another page before running the plugin; confirm that its file is still created.
5. Restart Logseq or re-index the graph and verify the generated dates remain visible. Also check a graph using a custom journal date format.
6. Disable automatic filling and verify the manual command still works. For a long backfill, switch graphs mid-run and verify the old run stops.

Dependency installation, the production build, unit tests, and syntax checks have passed. The desktop smoke test has not yet been verified.

## API references

- [Logseq plugin documentation](https://plugins-doc.logseq.com/)
- [Editor API: page creation and block insertion](https://logseq.github.io/plugins/interfaces/IEditorProxy.html)
- [App API: graph, route, and journal lifecycle hooks](https://logseq.github.io/plugins/interfaces/IAppProxy.html)
- [Logseq 0.10.15 file writer](https://github.com/logseq/logseq/blob/0.10.15/src/main/frontend/modules/outliner/file.cljs#L42): the condition that skips fileless pages with one empty block.

The implementation uses `createPage` and `insertBlock` so Logseq owns both its index and disk writes; it does not use raw filesystem access.
