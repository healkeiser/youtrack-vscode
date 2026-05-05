### Changelog

All notable changes to this project will be documented in this file. Dates are displayed in UTC.

#### [v0.16.1](https://github.com/healkeiser/youtrack-companion/compare/v0.16.0...v0.16.1)

- [FEAT] Sidebar: ID-descending default + asc/desc toggle button [`8d7edf1`](https://github.com/healkeiser/youtrack-companion/commit/8d7edf153d5a03bd9c96912cd63c819b8157d773)
- [BUILD] Bump softprops/action-gh-release v2 -&gt; v3 (node24) [`68bc8ac`](https://github.com/healkeiser/youtrack-companion/commit/68bc8ac5a04cc07928bec56e7f3b7058ad1bb39b)

#### [v0.16.0](https://github.com/healkeiser/youtrack-companion/compare/v0.15.6...v0.16.0)

> 5 May 2026

- [BUILD] Bump version to 0.16.0 [`177277e`](https://github.com/healkeiser/youtrack-companion/commit/177277e9ab1c0b838f1e7569383bd64670dc36a4)
- [FIX] Sidebar paging, filter feedback, terminal paste; configurable Assigned-to-me query [`4dfcec2`](https://github.com/healkeiser/youtrack-companion/commit/4dfcec259c7db32c28e2d37309fb5a06b0b2de61)
- [BUILD] Fix release workflow: auto-changelog renamed --next-version to --latest-version [`c23bc12`](https://github.com/healkeiser/youtrack-companion/commit/c23bc121690266e77844343504cb23f427e18bfc)

#### [v0.15.6](https://github.com/healkeiser/youtrack-companion/compare/v0.15.5...v0.15.6)

> 5 May 2026

- [DOC] Drop Marketplace references; we're not on it (yet) [`3cc3a4c`](https://github.com/healkeiser/youtrack-companion/commit/3cc3a4c970d62e42b0ad4f81c505f780767e6f66)

#### [v0.15.5](https://github.com/healkeiser/youtrack-companion/compare/v0.15.4...v0.15.5)

> 5 May 2026

- [DOC] Match fxgui header verbatim — div align=center, h3, badge cluster [`c429df3`](https://github.com/healkeiser/youtrack-companion/commit/c429df375ed4ac2dd9e55de25915cb0d9be3df5e)

#### [v0.15.4](https://github.com/healkeiser/youtrack-companion/compare/v0.15.3...v0.15.4)

> 5 May 2026

- [DOC] Restructure README to match fxgui layout; bump 0.15.4 [`b35c06d`](https://github.com/healkeiser/youtrack-companion/commit/b35c06d2e146824ad10057108d4b060d527e2481)

#### [v0.15.3](https://github.com/healkeiser/youtrack-companion/compare/v0.15.2...v0.15.3)

> 5 May 2026

- [CHORE] Exclude internal scratch from the .vsix [`6d06bf3`](https://github.com/healkeiser/youtrack-companion/commit/6d06bf3871a18b7df248b9a4eeb68d4d1d19009f)
- [DOC] Add real screenshots; bump 0.15.3 [`5a68204`](https://github.com/healkeiser/youtrack-companion/commit/5a68204529107b71972de20282512b62eb713e0c)

#### [v0.15.2](https://github.com/healkeiser/youtrack-companion/compare/v0.15.1...v0.15.2)

> 5 May 2026

- [CHORE] One-shot reinstall loop: npm run reinstall + matching task [`08acecb`](https://github.com/healkeiser/youtrack-companion/commit/08acecb3181b7d3036f1e1409cb1916f7d5de177)
- [FIX] Render Subsystem and Build fields correctly [`38b2c31`](https://github.com/healkeiser/youtrack-companion/commit/38b2c31552602c88eb49095f5ddb1877bdc096a5)

#### [v0.15.1](https://github.com/healkeiser/youtrack-companion/compare/v0.15.0...v0.15.1)

> 5 May 2026

- [FIX] Force window reload + wipe per-account state on sign-in / sign-out [`abe8920`](https://github.com/healkeiser/youtrack-companion/commit/abe8920d675bcfa35120f91ebe28b4603c6ad595)
- [FIX] Remove dead fieldRenderer.test.ts [`50cf86e`](https://github.com/healkeiser/youtrack-companion/commit/50cf86e75d0c68404f506697830b4a4503b30eaf)

#### [v0.15.0](https://github.com/healkeiser/youtrack-companion/compare/v0.14.6...v0.15.0)

> 5 May 2026

- [FEAT] 0.15.0 — drop @anthropic-ai/claude-agent-sdk; spawn user's claude [`cc3f61c`](https://github.com/healkeiser/youtrack-companion/commit/cc3f61c773c19c7e4f02f9ab05aa834dcffea7a0)
- [CHORE] Bump GitHub Actions to v5 (Node 24 runtime) [`9b3f37c`](https://github.com/healkeiser/youtrack-companion/commit/9b3f37c70c4872c4e28242f3ea13a2ad4546f527)

#### [v0.14.6](https://github.com/healkeiser/youtrack-companion/compare/v0.8.0...v0.14.6)

> 5 May 2026

- [FEAT] 0.14.6 — Claude integration, sidebar auto-refresh, attachment cache [`699b4db`](https://github.com/healkeiser/youtrack-companion/commit/699b4db239c9657a6a0d3dae8dca666ce9d41d15)
- [CHORE] Publisher → healkeiser; .vscode/tasks.json release flow [`40d5a64`](https://github.com/healkeiser/youtrack-companion/commit/40d5a64a58270f7ed99187a14080765349f1bf20)
- [CHORE] Per-platform .vsix packaging via matrix build [`ce3e55d`](https://github.com/healkeiser/youtrack-companion/commit/ce3e55dedce6a3eacbf72c36287ed030edc29887)
- [CHORE] Distribute via Open VSX + GitHub Releases (drop Marketplace) [`59753d6`](https://github.com/healkeiser/youtrack-companion/commit/59753d6eb48358bb94b42260964bf360a143cb63)
- [CHORE] Republish to VS Code Marketplace alongside Open VSX [`74ea078`](https://github.com/healkeiser/youtrack-companion/commit/74ea078754f927ad3ef9e43644c7f155acc36760)
- [DOC] README: AI features, code actions, settings table [`b12d2f4`](https://github.com/healkeiser/youtrack-companion/commit/b12d2f4dfa90b6c5e51c607629f4178b9344b850)
- [DOC] Note the publisher migration from valentinbeaumont to healkeiser [`4628ea4`](https://github.com/healkeiser/youtrack-companion/commit/4628ea40581ce094aa4a8c95890299beab512482)
- [CHORE] Shrink icon content to 124x124 inside the 128x128 frame [`35e17de`](https://github.com/healkeiser/youtrack-companion/commit/35e17de64d05e345446a956fe133e26bbc8aca61)

#### [v0.8.0](https://github.com/healkeiser/youtrack-companion/compare/v0.7.0...v0.8.0)

> 22 April 2026

- [FEAT] 0.8.0 — subtasks, per-column create, panel shortcuts, branch-aware commands [`c04fa36`](https://github.com/healkeiser/youtrack-companion/commit/c04fa361816a019fa8e95c9951236ecd21879073)

#### [v0.7.0](https://github.com/healkeiser/youtrack-companion/compare/v0.4.1...v0.7.0)

> 22 April 2026

- [FEAT] 0.7.0 — inline pickers, comment cards, lightbox, agile board polish [`29dbffc`](https://github.com/healkeiser/youtrack-companion/commit/29dbffca0026011f0ca0cd510697f8d308f35243)

#### v0.4.1

> 21 April 2026

- [BUILD] Bootstrap Node project [`9f9c14b`](https://github.com/healkeiser/youtrack-companion/commit/9f9c14b19e4feceb61fc8f336d94739f7f1d1204)
- [DOC] Add v1 implementation plan [`cbdc83b`](https://github.com/healkeiser/youtrack-companion/commit/cbdc83b8c7992ac1eacafffcc87595d737f794da)
- [TEST] Add integration test harness [`2d2db21`](https://github.com/healkeiser/youtrack-companion/commit/2d2db2105814538a411f9b9f39d72c6d34c48a8f)
- [FEAT] Bundle VS Code codicons for webviews; swap unicode glyphs for real icons [`f93137d`](https://github.com/healkeiser/youtrack-companion/commit/f93137d824905ff4cb7a8c84dde5270a1e961a8f)
- [REFACTOR] Consolidate duplicated panel shell, md editor, styles [`cbaaaec`](https://github.com/healkeiser/youtrack-companion/commit/cbaaaec33df370de834de60494df3cbf25b96619)
- [FEAT] Restructure sidebar: six dedicated sections (Atlassian/Jira style) [`aff064d`](https://github.com/healkeiser/youtrack-companion/commit/aff064d2fec2f64ee13d42a14d2debc2615580d9)
- [FEAT] Live timer, Recents section, Notifications, Links, Attachments, Badge, Skeletons, Keybindings [`e8aee19`](https://github.com/healkeiser/youtrack-companion/commit/e8aee19adf12913090455d630dab6e57f3a52cc2)
- [FEAT] Board filters, create-from-selection, commit-message template [`c8f112b`](https://github.com/healkeiser/youtrack-companion/commit/c8f112bbcc1e892f86d5128de0effb8984348345)
- [FEAT] Use YouTrack's actual priority/state colors; create-issue form as a webview [`3489982`](https://github.com/healkeiser/youtrack-companion/commit/34899822bf953ef36c0431a6d19dc1830dc3427b)
- [FEAT] Tags, colored dots, avatars, picker polish [`4058ae9`](https://github.com/healkeiser/youtrack-companion/commit/4058ae96739cdfd84b0205286af466a280b28bdb)
- [FEAT] Per-view independent filters, Unresolved quick-filter, compact current-issue badge [`ee452d3`](https://github.com/healkeiser/youtrack-companion/commit/ee452d3ef2a92c019713ca87d64b622d03c5eecb)
- [FEAT] Lean sidebar: 4 top-level views; secondary filters collapse into an Issues section [`422a38c`](https://github.com/healkeiser/youtrack-companion/commit/422a38cab573ad7871bb6c58cb26cac601bafecb)
- [FEAT] CodeLens, notifications mark-read, comment drafts, @mention autocomplete [`39d2d88`](https://github.com/healkeiser/youtrack-companion/commit/39d2d88bed637e77ea282ba358ee49526d1fa05f)
- [FEAT] Redesign issue detail panel: two-column layout with YouTrack-style metadata sidebar [`a43b4b7`](https://github.com/healkeiser/youtrack-companion/commit/a43b4b781fa643d3f38a40105437c469b1abe3a8)
- [FEAT] Unify issue-detail and agile-board styling via shared.css [`fe42650`](https://github.com/healkeiser/youtrack-companion/commit/fe42650bf3731f53fceb1103d715e8c369edc04b)
- [FEAT] Quick-edit any custom field from the side panel [`1c55e3b`](https://github.com/healkeiser/youtrack-companion/commit/1c55e3b4fe3f02d0fbdd94b2034cb595537e4db7)
- [FEAT] Upgrade agile board: richer cards, header with sprint switcher [`5cd366b`](https://github.com/healkeiser/youtrack-companion/commit/5cd366b94c286ebc4f6231af97bbad3de41daedc)
- [DOC] Add v1 design spec for ls-youtrack-vscode [`bef50f8`](https://github.com/healkeiser/youtrack-companion/commit/bef50f884b487330f45b0e21b01d200721cfaf7e)
- [FEAT] Add YouTrackClient with REST bindings [`c7143c6`](https://github.com/healkeiser/youtrack-companion/commit/c7143c66877fec7126ad182c2284f1709609a945)
- [FEAT] Two-column Create Issue form, aligned with Issue Detail shell [`dd5934a`](https://github.com/healkeiser/youtrack-companion/commit/dd5934a9562181f740849e5e47b5ac5ca143b5e4)
- [FEAT] Swimlanes on the agile board for categorical sorts [`c3571c3`](https://github.com/healkeiser/youtrack-companion/commit/c3571c3bf3a8cf34415a630e043a6fac03c1a145)
- [FIX] Replace better-sqlite3 with in-memory Map to eliminate native ABI issues [`a28c3ea`](https://github.com/healkeiser/youtrack-companion/commit/a28c3eab04bcf1743c8cd2da767d098cd16ca076)
- [FEAT] Markdown rendering and inline edit for issue summary and description [`72b161c`](https://github.com/healkeiser/youtrack-companion/commit/72b161c718ebe29f5c7b1feb2eb6ce2715cee034)
- [FEAT] Profile pictures, tags with YouTrack colors, tag filter, bold issue IDs [`55b36d3`](https://github.com/healkeiser/youtrack-companion/commit/55b36d3aa2323fc7cf250f566c98dbb3b16d5dee)
- [FIX] Re-skin issue detail to match the agile board aesthetic [`05a0156`](https://github.com/healkeiser/youtrack-companion/commit/05a01565d94fe12202e9585b08b74c0aba3b874f)
- [FEAT] Add agile board webview [`1a6bfb6`](https://github.com/healkeiser/youtrack-companion/commit/1a6bfb6b10e3ea00ae7f5f054f5b2ea340dac8cb)
- [FEAT] Add IssueDetailPanel webview [`3f95af4`](https://github.com/healkeiser/youtrack-companion/commit/3f95af417350d904cbfa2876555e16b09a00c451)
- [FEAT] Rich comment composer (markdown toolbar + @mention) and collapsed log-time [`685dcf6`](https://github.com/healkeiser/youtrack-companion/commit/685dcf6aab8ce577d83af362edd0f168bc7c43f3)
- [FIX] Cap issue detail panel layout to readable width; tighten form inputs [`bfb66bb`](https://github.com/healkeiser/youtrack-companion/commit/bfb66bb408398b428f8954b55af5554df19bde8c)
- [FEAT] Add hover preview, sidebar context menu, and Start Work combo [`48dab8d`](https://github.com/healkeiser/youtrack-companion/commit/48dab8da1467edf5b7d1d6dab169c8c4ea37c22b)
- [FEAT] Post Branch Activity: manual commit summary comment [`f7261e2`](https://github.com/healkeiser/youtrack-companion/commit/f7261e2047532ec0ea9e927ac362de6fc52a1f9e)
- [FEAT] Shared markdown toolbar on description edit; double-click to edit [`0cc93b0`](https://github.com/healkeiser/youtrack-companion/commit/0cc93b00d07dca626be2ff3bcd92a4b2adefb28f)
- [FEAT] Add SQLite read-through cache with LRU [`9004e7d`](https://github.com/healkeiser/youtrack-companion/commit/9004e7d02f93178cfd9f10c10599a7011406ebb6)
- [FEAT] Friendly YouTrack error messages + read-only mode detection [`92e422b`](https://github.com/healkeiser/youtrack-companion/commit/92e422b074e3943687c66e9b920fd6b895ca21ba)
- [FEAT] Redesign swimlanes: collapsible horizontal bands, no empty-cell boxes [`7ffe3fd`](https://github.com/healkeiser/youtrack-companion/commit/7ffe3fd6106569ca6e5bb20fc4d31db08e609190)
- [FEAT] Interactive side-panel pills; slim toolbar; buttons for inline triggers [`519908f`](https://github.com/healkeiser/youtrack-companion/commit/519908f01ba0c4896e69b5a540ef634a92cd1f82)
- [FEAT] Add state quick-filter and sort controls to the Issues sidebar [`c7fb752`](https://github.com/healkeiser/youtrack-companion/commit/c7fb752a1f8c99973a5a0e879a86f8d2d676f824)
- [FEAT] Add request helper with retry and error handling [`1e21925`](https://github.com/healkeiser/youtrack-companion/commit/1e21925674bffa9a738e880b375e4bdb57631e06)
- [FEAT] Reusable .btn / .btn.primary / .btn.icon component in shared.css [`baf5529`](https://github.com/healkeiser/youtrack-companion/commit/baf55291a81f0e450b0ff191d06ab47d8154e045)
- [DOC] Rewrite README for the Marketplace listing [`8058d34`](https://github.com/healkeiser/youtrack-companion/commit/8058d3469c61fd7d511ac9494d5a5f9f6e7ca786)
- [FEAT] Add BranchNameBuilder with placeholders [`158ea01`](https://github.com/healkeiser/youtrack-companion/commit/158ea01fa0aa401692d32855f223a7841a62f5b6)
- [FIX] Font sizing, full-width forms, unified form surfaces [`cc36dd1`](https://github.com/healkeiser/youtrack-companion/commit/cc36dd10cbe31a0bab938951e6c2cc3730e117d3)
- [FIX] Use VS Code font/size as base, stop shrinking text below 1em [`b036986`](https://github.com/healkeiser/youtrack-companion/commit/b0369866f9fb1ece6340b27bae59532395fbb20a)
- [FEAT] Interactive issue detail: action toolbar, comment composer, color tab icon [`4bca7d2`](https://github.com/healkeiser/youtrack-companion/commit/4bca7d2f95aec9ab46732c2c7a90bf0a279de9cd)
- [FEAT] Attachment thumbnails and picker button [`24cf892`](https://github.com/healkeiser/youtrack-companion/commit/24cf8925af86c7b6d9f69e0180bcc83cd7c8f58a)
- [FEAT] Add Type, Priority, Assignee fields to the Create Issue form [`9a7b5c8`](https://github.com/healkeiser/youtrack-companion/commit/9a7b5c862e2b07fe67480aaaf614dddb8749ac9c)
- [CHORE] Marketplace polish: license, repo, keywords, LICENSE, CHANGELOG [`71d7b27`](https://github.com/healkeiser/youtrack-companion/commit/71d7b27d8deeb6f995f4444445ca1fc8fa8f5f01)
- [FEAT] Edit your own posted comments inline from the Activity feed [`8ffb2cf`](https://github.com/healkeiser/youtrack-companion/commit/8ffb2cf6d86456403d26611b60da8a5d0caba213)
- [FEAT] Add sidebar IssueTreeProvider [`2312651`](https://github.com/healkeiser/youtrack-companion/commit/23126513fb412e19c2982259ae2c7b0bfc340cdf)
- [FEAT] Plain sidebar IDs; Write/Preview tabs on markdown edit zones [`4ef16b6`](https://github.com/healkeiser/youtrack-companion/commit/4ef16b6f04ed65e340abbc0ec16348943909769f)
- [FEAT] Sanitize rendered markdown with sanitize-html [`d08bd4c`](https://github.com/healkeiser/youtrack-companion/commit/d08bd4c8d02dfa9cf4e71a2b92a95b0c71d6e7bd)
- [FIX] Multi-board support, $type on state/assignee writes, colored board cards [`e8c9879`](https://github.com/healkeiser/youtrack-companion/commit/e8c9879948a93c30baaf57dead95932e1a08fd01)
- [FEAT] Add YouTrack domain types [`dff335d`](https://github.com/healkeiser/youtrack-companion/commit/dff335d84f5c53a7ee19d34065cf3655fba0430d)
- [FEAT] Wire activation: auth, cache, sidebar [`b9ce341`](https://github.com/healkeiser/youtrack-companion/commit/b9ce341302ea966f334c82d05f28e6cf241051b3)
- [FEAT] Group sidebar issues by project with toggle button [`6dce9ba`](https://github.com/healkeiser/youtrack-companion/commit/6dce9ba00d9cc2cf3d3025d8207f93c26d41246e)
- [FEAT] Add Create Branch command and config [`32333e0`](https://github.com/healkeiser/youtrack-companion/commit/32333e0266ccf0772b74012189e13cb1e1755715)
- [DOC] Add QA checklist and README [`22bf130`](https://github.com/healkeiser/youtrack-companion/commit/22bf130c97fb276352ed0bee69cbcc965389ba1d)
- [FEAT] Inline comment composer under Activity; borderless Write/Preview tabs [`31f1819`](https://github.com/healkeiser/youtrack-companion/commit/31f181947f7ec9be945800459517293b75feee84)
- [FEAT] Add Agile Boards section to sidebar with collapsible split panels [`a21ce35`](https://github.com/healkeiser/youtrack-companion/commit/a21ce356f2631e62b906462998071abff0b6d608)
- [FEAT] Add FieldRenderer [`5d42b7e`](https://github.com/healkeiser/youtrack-companion/commit/5d42b7e9dc0576d5be703df200dd64b0179a7af8)
- [FEAT] Add sidebar filter: funnel button, substring match, match-count badge [`b47adca`](https://github.com/healkeiser/youtrack-companion/commit/b47adcacadd79e242bba4da14c09f6dc884fdd9b)
- [FEAT] Unicode-bold issue IDs; colored circle emoji per tag in sidebar [`b2879ba`](https://github.com/healkeiser/youtrack-companion/commit/b2879bab3a49bc93472d67889b9ee068c0b22239)
- [FEAT] Add branded icons for extension and activity bar [`848a34c`](https://github.com/healkeiser/youtrack-companion/commit/848a34c6e545764f2fb274e2bb6e022a8b0da4f7)
- [FEAT] Add AuthStore with first-run prompt [`e87654d`](https://github.com/healkeiser/youtrack-companion/commit/e87654d13b31ee5a1272e72849298f9ca189c172)
- [FEAT] Add status bar counter [`bc287c9`](https://github.com/healkeiser/youtrack-companion/commit/bc287c91961ddc6b9f7097af0a4046e0c9b8d12a)
- [FEAT] Unify flat and swimlane board layouts so toggling just adds lanes [`a790685`](https://github.com/healkeiser/youtrack-companion/commit/a790685021dfca3433bbc9fa2bc78fd51fde5e4d)
- [FEAT] Add Create Issue command [`b76f8ae`](https://github.com/healkeiser/youtrack-companion/commit/b76f8aed8022e16b451649d3f8f83e76bcf4680b)
- [FEAT] Add duration parser [`5847622`](https://github.com/healkeiser/youtrack-companion/commit/584762296fa52d45668fe033b64efe9104cc57ed)
- [FEAT] Richer status-bar item: $(tasklist) icon, rich tooltip, action menu on click [`a40a9db`](https://github.com/healkeiser/youtrack-companion/commit/a40a9db13b3f20505713eb2cb3518be82fd209b6)
- [FEAT] Add sort control to agile board [`d080f67`](https://github.com/healkeiser/youtrack-companion/commit/d080f678dd7d9864e0bc1e716689e840d79e5e9c)
- [FEAT] Add Log Time command [`2bb045a`](https://github.com/healkeiser/youtrack-companion/commit/2bb045a4f0f862fe17e820b86c3fa39250db778f)
- [FEAT] Render @mentions in comments/description as styled chips with full name [`f9beb32`](https://github.com/healkeiser/youtrack-companion/commit/f9beb32b709f2bd1580e8323582de817e2005813)
- [FIX] Harden renderField against undefined custom-field values [`02597cc`](https://github.com/healkeiser/youtrack-companion/commit/02597cca3318833f9270a49770471f442b7c77b8)
- [FEAT] Add state icons/colors on sidebar issues + fix detail webview race [`c15548e`](https://github.com/healkeiser/youtrack-companion/commit/c15548e1eff46e0222f489219e214c17c4d1aae7)
- [FIX] Promote epoch-ms integer fields with date-ish names to date display [`6341fe3`](https://github.com/healkeiser/youtrack-companion/commit/6341fe3897685d5669b065c64e9a0a2a1b79c194)
- [FIX] Unify tag pill and column header typography across issue detail and board [`3591275`](https://github.com/healkeiser/youtrack-companion/commit/359127599a52b3efc2fa9698b27e6d995d8df595)
- [FIX] Set ignoreFocusOut on all input prompts so focus-loss doesn't dismiss [`777e2ab`](https://github.com/healkeiser/youtrack-companion/commit/777e2abed5e05006991af5dfb05a5f23a2453fa9)
- [BUILD] Add esbuild config and activation shell [`4847e47`](https://github.com/healkeiser/youtrack-companion/commit/4847e4710d762db947642318e67eb4ce3dd50061)
- [FEAT] Column separators on the board; expand empty drop zones during drag [`7440c62`](https://github.com/healkeiser/youtrack-companion/commit/7440c6249b9de58f3d5454e2e042497d89a45622)
- [FIX] Gate signedIn context on successful tree registration [`a374ad6`](https://github.com/healkeiser/youtrack-companion/commit/a374ad6cc95b848e0b1c60827ab8109a71cedbcc)
- [FIX] Drop colored-circle emoji prefix on sidebar tags; back to '#tagname' [`c7542bd`](https://github.com/healkeiser/youtrack-companion/commit/c7542bd5dc1ac0b82e00c5bf1afa808ca5534d0a)
- [FEAT] Add Search command [`ce761e2`](https://github.com/healkeiser/youtrack-companion/commit/ce761e2ff6270b351eb667c4aab66d6722128b4e)
- [FIX] Date-promotion heuristic no longer gated on inferred type [`8c0b8a4`](https://github.com/healkeiser/youtrack-companion/commit/8c0b8a437faaf01f3ee4bb04d6c808508e9c58eb)
- [FEAT] Add Change State command [`cdbe0c8`](https://github.com/healkeiser/youtrack-companion/commit/cdbe0c875573fe1d716bd18cc91950b49b7bf9ff)
- [FIX] Make detail-panel sub-fetches resilient; show error instead of spinning on fetchIssue failure [`8cbeffe`](https://github.com/healkeiser/youtrack-companion/commit/8cbeffeb421989d9a6e44ecf85bed7d7e3d6f334)
- [FIX] Use saved-query-by-ID endpoint and encodeURIComponent for query params [`f11c259`](https://github.com/healkeiser/youtrack-companion/commit/f11c259c87f7d3cdbd2fc830d91acc5cd803fb81)
- [FEAT] Add strict CSP + script nonce to all webviews [`fd97aa6`](https://github.com/healkeiser/youtrack-companion/commit/fd97aa668b51f8b18d79cf2a52db25d2ddfa8773)
- [BUILD] Add release workflow [`bc894ed`](https://github.com/healkeiser/youtrack-companion/commit/bc894ed58c789767fe58c262b513754e3e66be14)
- [FIX] Map DateTimeIssueCustomField to date kind; format midnight-free [`ba2e428`](https://github.com/healkeiser/youtrack-companion/commit/ba2e42859957a1bd9f49fa957ac700720744a232)
- [FEAT] Add Assign to Me command [`ec560f5`](https://github.com/healkeiser/youtrack-companion/commit/ec560f54db588c69289553e1976c34d7e6973c03)
- [FEAT] Add Sign In command for re-auth after dismissed first-run prompt [`7ed02e0`](https://github.com/healkeiser/youtrack-companion/commit/7ed02e0dc2d38e49187d2a8a5bf46806042eade2)
- [FEAT] Add URI handler for deep links [`f558f91`](https://github.com/healkeiser/youtrack-companion/commit/f558f91f80e23f5d6d42314ab54c74d318a3c4c8)
- [FEAT] Add Go to Issue command [`005b02d`](https://github.com/healkeiser/youtrack-companion/commit/005b02dd7782c73b60304b53713a1289f5b9d822)
- [FIX] Agile board dividers: full-width filter separator, continuous column rules [`6bc40cd`](https://github.com/healkeiser/youtrack-companion/commit/6bc40cd3152be7c6e4cd295b043b53b0733af306)
- [CHORE] Rename package to youtrack-vscode, set author to Valentin Beaumont [`6dc7770`](https://github.com/healkeiser/youtrack-companion/commit/6dc7770219fe84e8f80f42a42b9abc0cdf428dc3)
- [FEAT] Inline row actions on sidebar issues + YouTrack icon on webview tabs [`6cbb0c4`](https://github.com/healkeiser/youtrack-companion/commit/6cbb0c4ef024021abe8e26d307df0c8902fb4ce5)
- [FIX] Propagate avatarUrl through user-typed custom fields [`01dbdfa`](https://github.com/healkeiser/youtrack-companion/commit/01dbdfa1a38c0d5810403a3a387fad134070b2a6)
- [FEAT] Add Create Issue button to sidebar sections and agile board header [`4eb7788`](https://github.com/healkeiser/youtrack-companion/commit/4eb778839b272af560161b7e73fbe51138320fd6)
- [FIX] Shorter toolbar labels and wider layout cap so the button bar fits [`93223e3`](https://github.com/healkeiser/youtrack-companion/commit/93223e390d07fb29ef8e0d2bc3bbdbf0bfd3427c)
- [FIX] Keep toolbar on a single row, theme native form controls [`835cad9`](https://github.com/healkeiser/youtrack-companion/commit/835cad9cdad71007b2a5df809b24a8efcad6d54b)
- [FIX] Merge toolbar + textarea flush in add-comment and editable-edit [`54062d6`](https://github.com/healkeiser/youtrack-companion/commit/54062d6959ec307641793bf11e48e77dd5da6a6c)
- [FIX] Tighten markdown rendering spacing [`f1231ee`](https://github.com/healkeiser/youtrack-companion/commit/f1231eeb6d526311d07e32254b363b556dae0ac7)
- [BUILD] Add vitest setup [`687e0a6`](https://github.com/healkeiser/youtrack-companion/commit/687e0a6cf6976fad5e82c20767e213133d58b4c2)
- [FIX] Persist baseUrl in user/global settings, not workspace [`cb6663e`](https://github.com/healkeiser/youtrack-companion/commit/cb6663e4cace07d6a47c7b717245d83656e75d82)
- [FIX] Drop invalid assignee:Assignee field projection; extract from customFields [`2fdabac`](https://github.com/healkeiser/youtrack-companion/commit/2fdabacc0080cb7143a4f83a28d1e1402b85fc4f)
- [FEAT] Show Sign In welcome view in sidebar when not authenticated [`4be28cf`](https://github.com/healkeiser/youtrack-companion/commit/4be28cf25823983ed0a16079921a1e40ce7b2be7)
- [CHORE] Publisher slug → valentinbeaumont (no hyphen) [`a08705c`](https://github.com/healkeiser/youtrack-companion/commit/a08705cf391fce87bea05174550b1bc04be095c3)
- [FIX] Use folder= query param for saved-search expansion; attach URL to HTTP errors [`a36b7e7`](https://github.com/healkeiser/youtrack-companion/commit/a36b7e73d7fbfd361ca92acf1715aaa13972ee9c)
- [CHORE] Publisher slug: valentinbeaumont → valentin-beaumont [`9be37d9`](https://github.com/healkeiser/youtrack-companion/commit/9be37d93a90d4897111ac9bbbc11841a3a5dc634)
- [FEAT] Refresh button on the Issue Detail toolbar [`5c244be`](https://github.com/healkeiser/youtrack-companion/commit/5c244bed9b1b8fa27832a78c64a3565aa922b131)
- [FIX] Switch bold IDs to Mathematical Sans-Serif Bold for better font match [`b5e589a`](https://github.com/healkeiser/youtrack-companion/commit/b5e589aaf75645eb1e2773d18a840f58d7d61372)
- [FIX] Remove .board padding so the grid is flush to the header and edges [`e14f87c`](https://github.com/healkeiser/youtrack-companion/commit/e14f87c2691ab588c5e1dbbdc337bbb744518268)
- [FIX] Center codicons in buttons via inline-flex [`c13e2bd`](https://github.com/healkeiser/youtrack-companion/commit/c13e2bd650325b673ffc766f2b57cb250f83e2fe)
- [FIX] Don't show '0 / 0' match badge on saved searches that weren't expanded [`a518059`](https://github.com/healkeiser/youtrack-companion/commit/a5180590acbe1b1d17096e727f686b39f2365e79)
- [DOC] List branch template placeholders in settings description [`343813c`](https://github.com/healkeiser/youtrack-companion/commit/343813c6d94fce8e179589aa0e6c0551422b308b)
- [CHORE] displayName → "YouTrack Integration" [`756d327`](https://github.com/healkeiser/youtrack-companion/commit/756d327b595a88ea44768304d32d3a5652e35354)
- [CHORE] Rename displayName to "YouTrack" [`f845e91`](https://github.com/healkeiser/youtrack-companion/commit/f845e9116faac8c15bbec3c87b70788f797958be)
- [FIX] Replace ALL {{CSP_SOURCE}} slots in webview HTML [`ab40c72`](https://github.com/healkeiser/youtrack-companion/commit/ab40c727dc572802a38c45309070348da9b6ed57)
- [FIX] Timer uses codicon-clock; match icon-button height to .btn [`8cf6a0a`](https://github.com/healkeiser/youtrack-companion/commit/8cf6a0a43c8e1eab7ddd660369ea74f11db4ba5c)
- [FIX] Center letters in state/priority badges [`00a2b26`](https://github.com/healkeiser/youtrack-companion/commit/00a2b269e54e62801b6b7c2d0758f086e5eb773d)
- [FEAT] Add Sign Out command [`5de72c2`](https://github.com/healkeiser/youtrack-companion/commit/5de72c296adbf8b6cbca168a6741357029e87f76)
- [FIX] Drop white-space: pre-wrap on description and activity body [`dbabefc`](https://github.com/healkeiser/youtrack-companion/commit/dbabefc421febb9bed38c963ac0c4e5df6b83e4b)
- [FIX] Editable blocks rendering in edit mode by default [`6554a65`](https://github.com/healkeiser/youtrack-companion/commit/6554a658d8acde9ac08278829560d4254af1c5c0)
- [FEAT] Update issue-tab title to include the issue summary once loaded [`6319f8b`](https://github.com/healkeiser/youtrack-companion/commit/6319f8b3fb256e9d82cc310fafc3b43c59bf1464)
- [BUILD] Bump to 0.1.1 [`092831c`](https://github.com/healkeiser/youtrack-companion/commit/092831cc08096a4ec80b9f3bf33d44a5759ad172)
- [FIX] Drop codicon from separator label in status-bar quick pick [`92cabba`](https://github.com/healkeiser/youtrack-companion/commit/92cabbafdcf6287ebe3de60889475173271333d1)
- [FIX] Whitelist better-sqlite3 runtime deps (bindings, file-uri-to-path) in VSIX [`2528b64`](https://github.com/healkeiser/youtrack-companion/commit/2528b6423b4fddac5b66846660ac42b5430dc785)
- [FIX] Drop literal $(checklist) text from agile board header [`4daa99b`](https://github.com/healkeiser/youtrack-companion/commit/4daa99bec3a9a7ee5b9b1f614b733a4d541e0dd2)
