const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  rating: { type: Number, default: 1200 },
  skillLevel: { type: String, default: 'Beginner' },
  avatar: { type: String, default: '' },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  draws: { type: Number, default: 0 },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  friendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  sessionId: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
