# Accuracy test results — `qwen2.5:7b`

- Golden set: `golden-set/ict3113_team8_golden_set_with_narratives.csv`
- Service: `http://localhost:3000`
- Total tickets: 180
- Correct: 135
- **Overall accuracy: 75.0%**

## Per-category accuracy

| Category | Correct / Total | Accuracy |
|---|---|---|
| Credit reporting | 48 / 53 | 90.6% |
| Debt collection | 13 / 16 | 81.3% |
| Mortgage | 22 / 26 | 84.6% |
| Credit card | 15 / 20 | 75.0% |
| Bank account or service | 15 / 23 | 65.2% |
| Consumer loan | 5 / 19 | 26.3% |
| Money transfer or service | 17 / 23 | 73.9% |

## Confusion matrix (rows = actual, columns = predicted)

| Actual \ Predicted | Credit repor | Debt collect | Mortgage | Credit card | Bank account | Consumer loa | Money transf | (error/unmat |
|---|---|---|---|---|---|---|---|---|
| Credit reporting | 48 | 4 | 1 | 0 | 0 | 0 | 0 | 0 |
| Debt collection | 3 | 13 | 0 | 0 | 0 | 0 | 0 | 0 |
| Mortgage | 0 | 2 | 22 | 0 | 0 | 1 | 1 | 0 |
| Credit card | 0 | 0 | 0 | 15 | 4 | 0 | 1 | 0 |
| Bank account or service | 2 | 0 | 0 | 2 | 15 | 0 | 4 | 0 |
| Consumer loan | 6 | 6 | 0 | 2 | 0 | 5 | 0 | 0 |
| Money transfer or service | 0 | 0 | 0 | 1 | 4 | 1 | 17 | 0 |
