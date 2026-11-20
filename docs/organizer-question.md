# Question for Devpost Discussions

**Posted:** 2026-11-20 — https://cloud9.devpost.com/forum_topics/45930-hosting-a-public-demo-with-aggregate-stats-derived-from-grid-data-allowed
**Answer:** 2026-11-21, allowed (see [Answer](#answer) below)

**Title:** Hosting a public demo with aggregate stats derived from GRID data — allowed?

Hi organizers, thanks for the great dataset!

I'm building a VALORANT scouting tool (Category 1) on the GRID starter data and would like to host a public demo
so judges can try it in the browser. Before deploying, I want to make sure this fits the data license
("no redistribution", "no derived datasets").

What the hosted demo would contain:

1. **Aggregated per-team stats as static JSON files** that the browser loads (about 30 MB total for ~140 teams):
   heatmap grids of utility cast positions per map/side/round phase (a cell is only included if it has 2+ casts),
   cluster centroids, percentages and counts, and Operator stats per player. No raw events, no per-round or
   per-cast records, no decompressed feeds. Since the browser loads these files, a visitor could technically
   download them.
2. **Short AI-generated scouting reports** (written by Claude from those aggregates only) for about 20 teams.
3. **Screenshots** of these visualizations in the public GitHub README and in the YouTube demo video.

The data repo itself and the intermediate files are never committed (enforced by .gitignore and a pre-commit hook).

Questions:

- Is a hosted demo like this acceptable, or do the aggregate JSON files count as a "derived dataset" that must not
  be published?
- Are screenshots and the demo video showing these visualizations fine?
- If hosting isn't allowed, is it OK to submit a local-run demo (judges run the ETL against their own copy of the
  data repo) plus the video walkthrough?

Thank you!

## Answer

**Answered:** 2026-11-21 by Janet Fang (Manager) in the
[forum thread](https://cloud9.devpost.com/forum_topics/45930-hosting-a-public-demo-with-aggregate-stats-derived-from-grid-data-allowed):

> Hi Bayu, thanks for your patience while we checked with the Cloud9 and GRID team! The aggregate stats do count as a derived dataset, but this is permitted use under section 4(b) of the data LICENSE.md, which lets you show your Project, including results, statistics, charts and other outputs derived from the Data, to the Hackathon's judges and organizers and present it in Hackathon demos and events. So your hosted demo works, and screenshots and the demo video showing these visualizations are fine too. One reminder from the same section: include only the small excerpts of the Data reasonably necessary to demonstrate the Project, and otherwise load the Data from the GRID repository rather than bundling it. Good luck with your build!

Outcome: the hosted demo (aggregate JSON + reports), README screenshots and the demo video are allowed. Raw GRID
data stays out of the repo and the host; the ETL loads it from the GRID repository. See `deploy.md`.
