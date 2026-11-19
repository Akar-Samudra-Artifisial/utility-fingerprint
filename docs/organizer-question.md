# Question for Devpost Discussions

**Posted:** 2026-11-20 — https://cloud9.devpost.com/forum_topics/45930-hosting-a-public-demo-with-aggregate-stats-derived-from-grid-data-allowed
**Answer:** pending

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
