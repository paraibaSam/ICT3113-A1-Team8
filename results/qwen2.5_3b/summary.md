# Accuracy test results — `qwen2.5:3b`

- Golden set: `golden-set/ict3113_team8_golden_set_with_narratives.csv`
- Service: `http://localhost:3000`
- Total tickets: 180
- Correct: 110
- **Overall accuracy: 61.1%**

## Per-category accuracy

| Category | Correct / Total | Accuracy |
|---|---|---|
| Credit reporting | 42 / 53 | 79.2% |
| Debt collection | 10 / 16 | 62.5% |
| Mortgage | 24 / 26 | 92.3% |
| Credit card | 17 / 20 | 85.0% |
| Bank account or service | 8 / 23 | 34.8% |
| Consumer loan | 2 / 19 | 10.5% |
| Money transfer or service | 7 / 23 | 30.4% |

## Confusion matrix (rows = actual, columns = predicted)

| Actual \ Predicted | Credit repor | Debt collect | Mortgage | Credit card | Bank account | Consumer loa | Money transf | (error/unmat |
|---|---|---|---|---|---|---|---|---|
| Credit reporting | 42 | 0 | 1 | 9 | 0 | 1 | 0 | 0 |
| Debt collection | 2 | 10 | 1 | 2 | 1 | 0 | 0 | 0 |
| Mortgage | 0 | 0 | 24 | 1 | 0 | 1 | 0 | 0 |
| Credit card | 1 | 0 | 0 | 17 | 1 | 1 | 0 | 0 |
| Bank account or service | 1 | 0 | 0 | 11 | 8 | 1 | 2 | 0 |
| Consumer loan | 0 | 1 | 9 | 7 | 0 | 2 | 0 | 0 |
| Money transfer or service | 0 | 0 | 0 | 8 | 7 | 1 | 7 | 0 |
