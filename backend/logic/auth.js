const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'sup-secret-chess-key';

const publicUser = (user) => ({
  id: user._id,
  username: user.username,
  rating: user.rating || 1200,
  skillLevel: user.skillLevel || 'professional',
  avatar: user.avatar || null,
  wins: user.wins || 0,
  losses: user.losses || 0,
  draws: user.draws || 0
});

const createSession = async (user) => {
  const sessionId = randomUUID();
  await User.findByIdAndUpdate(user._id, { sessionId });
  return {
    user: publicUser(user),
    token: jwt.sign({ id: user._id, sessionId }, JWT_SECRET, { expiresIn: '7d' })
  };
};

const auth = {
  async register(username, password, skillLevel = 'professional') {
    const cleanUsername = username.trim();
    if (cleanUsername.length < 3) throw new Error('Username must be at least 3 characters long');
    if (!/^[a-zA-Z0-9_-]+$/.test(cleanUsername)) throw new Error('Username can use letters, numbers, _ and - only.');
    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters long.');
    if (!['beginner', 'intermediate', 'professional'].includes(skillLevel)) throw new Error('Choose a valid starting level.');

    const existingUser = await User.findOne({
      username: { $regex: new RegExp(`^${cleanUsername}$`, 'i') }
    });
    if (existingUser) throw new Error(`The username "${cleanUsername}" is already taken.`);

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      username: cleanUsername,
      password: hashedPassword,
      rating: { beginner: 400, intermediate: 700, professional: 1200 }[skillLevel],
      skillLevel,
      avatar: null,
      wins: 0,
      losses: 0,
      draws: 0,
      friends: [],
      friendRequests: []
    });

    return createSession(newUser);
  },

  async login(username, password) {
    const cleanUsername = username.trim();
    const user = await User.findOne({ username: cleanUsername });

    if (!user) throw new Error('Username not found. Try signing up!');

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) throw new Error('Wrong password!');

    return createSession(user);
  },

  async verifySession(token) {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user || !payload.sessionId || user.sessionId !== payload.sessionId) {
      throw new Error('This session has expired because the account was used somewhere else.');
    }
    return user;
  },

  async logout(user) {
    await User.findByIdAndUpdate(user._id, { sessionId: null });
  }
};

module.exports = { ...auth, publicUser };
