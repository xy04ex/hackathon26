# Tests (dev-only)

Property-based tests for the pure logic in `js/score.js` and `js/order.js`,
using [fast-check](https://github.com/dubzzz/fast-check) with
[vitest](https://vitest.dev/). These are **not** needed to run the app — the
app is plain static files. They exist to prove the core invariants hold for
many random inputs.

## Run

```bash
cd tests
npm install
npm test
```

## Properties checked

**score.js**
- A produced score is always an integer in `[0, 100]`.
- The band always matches the thresholds (`>=67` green, `<=33` red, else yellow).

**order.js**
- Reorder never adds, removes, or renames tasks (output is a permutation of the
  input; each id keeps its original text).
- Tasks due today always come before any task not due today.
- A low recovery band with low HRV but no proven learned demotions never changes
  the order (HRV alone must never reorder).
- Ties are stable: when no rule applies, the original order is preserved.
