# csv-reader-speed — fast CSV reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kojeck86/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kojeck86/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast, dependency-free CSV reader that returns exactly what csv-reader 1.0.0
returns for every input — including its broken-row policy (stray CRs, quotes
that never close, junk after a closing quote, short and long rows) — while
reading several times faster than the reference.

`solve.js` exports `run(input)`, which reads `{text, header}` once, left to
right, and answers `{columns, rows, errors}`. `main.ts` is the program the
harness runs: it reads every case from `/input/cases.json` and writes the
answers to `/output/answers.json`.

Built for the make.fun bounty [csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

## How it is fast

Instead of reading one character at a time like the reference, each field is
cut with native `indexOf` scans plus one `slice`: a plain field costs a
couple of short scans and no per-character loop. Only the rare paths — a
stray CR, or a line break inside a quoted field — fall back to a short scan
over just the affected span. On the kit's practice set (about 10 MB of CSV)
it answers every case identically to the reference at roughly 6x its CPU
time.

