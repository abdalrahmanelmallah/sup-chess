const { Chess } = require('chess.js');

const createBot = (difficulty) => {
  return {
    getMove: (game) => {
      const chess = new Chess(game.fen());
      const moves = chess.moves();

      if (moves.length === 0) return null;

      switch (difficulty) {
        case 'easy':
          // Bot 1: Random moves
          return moves[Math.floor(Math.random() * moves.length)];

        case 'medium':
          // Bot 2: Basic material evaluation
          return getBestMaterialMove(chess, moves);

        case 'hard':
          // Bot 3: Minimax with simplified evaluation
          return getMinimaxMove(chess, moves);

        default:
          return moves[Math.floor(Math.random() * moves.length)];
      }
    }
  };
};

function getBestMaterialMove(chess, moves) {
  let bestMove = null;
  let maxEval = -Infinity;

  const materialWeights = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  for (const move of moves) {
    chess.move(move);
    let evalScore = 0;
    const board = chess.board();

    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const piece = board[i][j];
        if (piece) {
          const val = materialWeights[piece.type] || 0;
          evalScore += piece.color === 'b' ? val : -val;
        }
      }
    }

    if (evalScore > maxEval) {
      maxEval = evalScore;
      bestMove = move;
    }
    chess.undo();
  }
  return bestMove || moves[0];
}

function getMinimaxMove(chess, moves) {
  // Simplified Minimax for the bot
  let bestMove = null;
  let bestValue = -Infinity;

  for (const move of moves) {
    chess.move(move);
    const boardValue = -evaluateBoard(chess.board());
    chess.undo();
    if (boardValue > bestValue) {
      bestValue = boardValue;
      bestMove = move;
    }
  }
  return bestMove || moves[0];
}

function evaluateBoard(board) {
  const materialWeights = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let totalEvaluation = 0;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const piece = board[i][j];
      if (piece) {
        const val = materialWeights[piece.type] || 0;
        totalEvaluation += piece.color === 'w' ? val : -val;
      }
    }
  }
  return totalEvaluation;
}

module.exports = { createBot };
