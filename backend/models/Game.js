const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  result: { type: String }, // 'white', 'black', 'draw'
  reason: { type: String }, // 'mate', 'resign', 'timeout', 'draw'
  timeControl: { type: String },
  variant: { type: String },
  initialFen: { type: String },
  moves: [String],
  revealedPawns: { type: Object },
  finishedAt: { type: Date, default: Date.now },
  ratingChanges: {
    white: { type: Number },
    black: { type: Number }
  }
}, { timestamps: true });

module.exports = mongoose.model('Game', gameSchema);
