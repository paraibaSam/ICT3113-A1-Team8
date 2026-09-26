// The seven fixed categories defined in the assignment brief.
// Order matters only for the fallback matching logic in ollamaClient.js
// (first case-insensitive match wins), so keep this list stable.
const CATEGORIES = [
  'Credit reporting',
  'Debt collection',
  'Mortgage',
  'Credit card',
  'Bank account or service',
  'Consumer loan',
  'Money transfer or service',
];

module.exports = { CATEGORIES };
