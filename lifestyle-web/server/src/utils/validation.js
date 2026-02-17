const NAME_LIMITS = Object.freeze({
  maxLength: 80,
  maxWords: 5,
});

const PASSWORD_LIMITS = Object.freeze({
  maxLength: 128,
  maxWords: 12,
});

function countWords(value = '') {
  if (!value) return 0;
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function exceedsWordLimit(value = '', maxWords = 0) {
  if (!maxWords) {
    return false;
  }
  return countWords(value) > maxWords;
}

function exceedsLengthLimit(value = '', maxLength = 0) {
  if (!maxLength) {
    return false;
  }
  return value.length > maxLength;
}

function violatesLimits(value = '', limits = {}) {
  if (typeof value !== 'string') {
    return false;
  }
  return (
    exceedsLengthLimit(value, limits.maxLength) ||
    exceedsWordLimit(value, limits.maxWords)
  );
}

module.exports = {
  NAME_LIMITS,
  PASSWORD_LIMITS,
  countWords,
  exceedsWordLimit,
  exceedsLengthLimit,
  violatesLimits,
};
