const calculateElo = (playerRating, opponentRating, actualScore, kFactor = 20) => {
  // Expected Score = 1 / (1 + 10^((OpponentRating - YourRating) / 400))
  const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));

  // New Rating = Old Rating + K * (Actual Score - Expected Score)
  const newRating = playerRating + kFactor * (actualScore - expectedScore);

  return Math.round(newRating);
};

// Keep rating changes familiar and readable while still basing them on the
// opponent's rating. An evenly matched game moves 9 points; an upset can move
// 11 and a heavy favourite normally moves 8.
const ratingChange = (playerRating, opponentRating, actualScore) => {
  if (actualScore === 0.5) return 0;
  const raw = Math.abs(calculateElo(playerRating, opponentRating, actualScore) - playerRating);
  if (raw <= 8) return 8;
  if (raw <= 10) return 9;
  return 11;
};

const ratedResult = (whiteRating, blackRating, result) => {
  if (result === 'draw') return { white: 0, black: 0 };
  const whiteScore = result === 'white' ? 1 : 0;
  const blackScore = whiteScore ? 0 : 1;
  return {
    white: whiteScore ? ratingChange(whiteRating, blackRating, 1) : -ratingChange(whiteRating, blackRating, 0),
    black: blackScore ? ratingChange(blackRating, whiteRating, 1) : -ratingChange(blackRating, whiteRating, 0)
  };
};

module.exports = { calculateElo, ratingChange, ratedResult };
