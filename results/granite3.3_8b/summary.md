# Accuracy test results — `granite3.3:8b`

- Golden set: `golden-set/ict3113_team8_golden_set_with_narratives.csv`
- Service: `http://localhost:3000`
- Total tickets: 180
- Correct: 121
- **Overall accuracy: 67.2%**

## Per-category accuracy

| Category | Correct / Total | Accuracy |
|---|---|---|
| Credit reporting | 41 / 53 | 77.4% |
| Debt collection | 11 / 16 | 68.8% |
| Mortgage | 21 / 26 | 80.8% |
| Credit card | 20 / 20 | 100.0% |
| Bank account or service | 11 / 23 | 47.8% |
| Consumer loan | 10 / 19 | 52.6% |
| Money transfer or service | 7 / 23 | 30.4% |

## Confusion matrix (rows = actual, columns = predicted)

| Actual \ Predicted | Credit repor | Debt collect | Mortgage | Credit card | Bank account | Consumer loa | Money transf | (error/unmat |
|---|---|---|---|---|---|---|---|---|
| Credit reporting | 41 | 4 | 1 | 4 | 0 | 3 | 0 | 0 |
| Debt collection | 2 | 11 | 0 | 2 | 0 | 1 | 0 | 0 |
| Mortgage | 0 | 0 | 21 | 4 | 0 | 1 | 0 | 0 |
| Credit card | 0 | 0 | 0 | 20 | 0 | 0 | 0 | 0 |
| Bank account or service | 0 | 0 | 0 | 10 | 11 | 0 | 2 | 0 |
| Consumer loan | 0 | 3 | 0 | 6 | 0 | 10 | 0 | 0 |
| Money transfer or service | 0 | 0 | 0 | 4 | 12 | 0 | 7 | 0 |
