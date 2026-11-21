# Video script — Utility Fingerprint (target ≤ 2:50, YouTube)

Local static demo: `cd web && pnpm export && pnpm serve:static` → `http://localhost:4173`. URL parameters follow
`web/src/lib/url-state.ts` (`tab`, `team`, `b`, `mode`, `map`, `side` = `attacker|defender`, `phase`, `op`).
Team ids: Cloud9 `79`, Sentinels `1079`; OXY player id `10636`. Narration ≈ 140 words per minute.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:10 | `http://localhost:4173/?team=79&map=haven&side=defender&phase=opening` — Haven defense opening heatmap fades in | Where does Cloud9 smoke at barrier drop on Haven defense, and who holds the Operator? Utility Fingerprint answers that in one click. |
| 0:10–0:25 | Same view, slow zoom on the minimap; filter sidebar visible | Scouting an opponent usually means hours of VODs. Stat dashboards tell you how many kills, not where and when. We built a spatial fingerprint of every team from GRID match data. |
| 0:25–0:50 | Same URL; toggle phases opening → mid; click the largest cluster to open its detail card | This is Cloud9 on Haven defense. The heatmap shows where players stood when casting each ability, split by side and round phase. Clusters group repeated setups: the card gives the agent, the share of casts and the timing. Arrows show where they aimed. |
| 0:50 (+10 s) | `http://localhost:4173/?team=79&map=lotus&side=attacker&phase=late` — click the "Win rate when used" insight card (focuses the Dark Cover cluster), then pick player neT (`op=2348`) and click the remaining cluster to show "Thrown by" | Each cluster also shows the win rate in rounds when the setup is used, against the team's baseline. Filter by player to see who throws it. |
| 0:50–1:12 | `http://localhost:4173/?tab=compare&team=79&b=1079&mode=diff&map=haven&side=defender&phase=opening` | Compare puts two teams on the same map, side and phase. Here Cloud9 against Sentinels, as a diff heatmap. Everything is normalised per round played, so a team with more games does not simply look busier. |
| 1:12–1:35 | `http://localhost:4173/?tab=operator&team=79&map=haven&side=defender&phase=opening&op=10636` — holder positions layer, then toggle the kill layer | The Operator profiler shows who holds the Operator and which angles they hold in the first forty-five seconds. OXY held it in 97 rounds for 49 kills, surviving 46.4 percent of them. Kill and victim layers show where those fights happen. |
| 1:35–2:05 | `http://localhost:4173/?tab=report&team=79` — click a fact chip to open the evidence popover, then click "Show on map" | Each team gets a scouting report written by Claude from these aggregates only. Every claim cites its facts. Click one to see the value behind it, or jump straight to the map view that proves it. Counter-strategy suggestions close the report. |
| 2:05–2:30 | README architecture diagram, then `docs/data-pipeline.md` validator section | Under the hood: a Python and Polars pipeline processes 2,078 games, 42,529 rounds and about 1.5 million ability casts, with a verified minimap calibration. Before a report is saved, a validator checks every number in a claim against its cited facts. Failing claims are retried once, then dropped. |
| 2:30–2:42 | `docs/ai-workflow-log.md`; WebStorm with the Junie panel showing the Export PDF task | We built this in WebStorm with Junie and Claude Code, and logged every AI-assisted step, including where we corrected it. |
| 2:42–2:50 | Back to the first URL, logo/title card | Utility Fingerprint: know where your opponent's utility goes before the match starts. |

## Recording checklist

- [ ] Resolution 1920×1080, browser window maximised; record at 30 fps or higher.
- [ ] Browser zoom 100 % (try 110 % if the sidebar text is small); same zoom for every take.
- [ ] Hide the bookmarks bar, extensions and other tabs; use a clean browser profile.
- [ ] Data ready: `web/public/data/` built and `reports/` present for 79; run `pnpm export` and
      `pnpm serve:static`; open every URL above once so minimap images are cached (they load from
      valorant-api.com).
- [ ] Notifications off (macOS Focus / Do Not Disturb); close chat and mail apps.
- [ ] No terminal showing keys, laptop paths or personal data; do not show the shell history.
- [ ] Check the evidence popover and "Show on map" on the chosen claim before recording.
- [ ] Final length ≤ 2:50 (YouTube limit for the submission is 3:00); add captions.
- [ ] Replace the JetBrains TODO in the narration once the tools are confirmed.
