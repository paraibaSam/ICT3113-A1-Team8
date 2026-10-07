# Accuracy test results — `gemma3:4b`

- Golden set: `golden-set/ict3113_team8_golden_set_with_narratives.csv`
- Service: `http://localhost:3000`
- Total tickets: 180
- Correct: 127
- **Overall accuracy: 70.6%**

## Per-category accuracy

| Category | Correct / Total | Accuracy |
|---|---|---|
| Credit reporting | 46 / 53 | 86.8% |
| Debt collection | 9 / 16 | 56.3% |
| Mortgage | 24 / 26 | 92.3% |
| Credit card | 16 / 20 | 80.0% |
| Bank account or service | 11 / 23 | 47.8% |
| Consumer loan | 5 / 19 | 26.3% |
| Money transfer or service | 16 / 23 | 69.6% |

## Confusion matrix (rows = actual, columns = predicted)

| Actual \ Predicted | Credit repor | Debt collect | Mortgage | Credit card | Bank account | Consumer loa | Money transf | (error/unmat |
|---|---|---|---|---|---|---|---|---|
| Credit reporting | 46 | 2 | 2 | 1 | 0 | 2 | 0 | 0 |
| Debt collection | 3 | 9 | 0 | 2 | 1 | 1 | 0 | 0 |
| Mortgage | 0 | 0 | 24 | 0 | 1 | 1 | 0 | 0 |
| Credit card | 2 | 0 | 0 | 16 | 2 | 0 | 0 | 0 |
| Bank account or service | 0 | 0 | 0 | 9 | 11 | 0 | 3 | 0 |
| Consumer loan | 1 | 3 | 4 | 3 | 2 | 5 | 1 | 0 |
| Money transfer or service | 0 | 0 | 0 | 4 | 3 | 0 | 16 | 0 |
