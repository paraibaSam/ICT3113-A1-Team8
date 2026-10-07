# Accuracy test results — `gemma3:1b`

- Golden set: `golden-set/ict3113_team8_golden_set_with_narratives.csv`
- Service: `http://localhost:3000`
- Total tickets: 180
- Correct: 43
- **Overall accuracy: 23.9%**

## Per-category accuracy

| Category | Correct / Total | Accuracy |
|---|---|---|
| Credit reporting | 6 / 53 | 11.3% |
| Debt collection | 8 / 16 | 50.0% |
| Mortgage | 10 / 26 | 38.5% |
| Credit card | 1 / 20 | 5.0% |
| Bank account or service | 1 / 23 | 4.3% |
| Consumer loan | 11 / 19 | 57.9% |
| Money transfer or service | 6 / 23 | 26.1% |

## Confusion matrix (rows = actual, columns = predicted)

| Actual \ Predicted | Credit repor | Debt collect | Mortgage | Credit card | Bank account | Consumer loa | Money transf | (error/unmat |
|---|---|---|---|---|---|---|---|---|
| Credit reporting | 6 | 9 | 2 | 0 | 0 | 33 | 3 | 0 |
| Debt collection | 0 | 8 | 0 | 0 | 0 | 7 | 1 | 0 |
| Mortgage | 0 | 3 | 10 | 0 | 1 | 11 | 1 | 0 |
| Credit card | 0 | 7 | 0 | 1 | 0 | 10 | 2 | 0 |
| Bank account or service | 0 | 1 | 2 | 0 | 1 | 11 | 8 | 0 |
| Consumer loan | 0 | 6 | 2 | 0 | 0 | 11 | 0 | 0 |
| Money transfer or service | 0 | 5 | 0 | 0 | 0 | 12 | 6 | 0 |
