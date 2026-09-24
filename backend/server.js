require('dotenv').config();
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const socketio = require('socket.io');
const cors = require('cors');
const { Chess } = require('chess.js');
const auth = require('./logic/auth');
const { connectDB } = require('./db');
const User = require('./models/User');
const Game = require('./models/Game');
const { ratedResult } = require('./logic/elo');

const app = express();
app.use(cors());
app.use(express.json());

const requireAuth = async (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
  try {
    req.user = await auth.verifySession(token);
    next();
  } catch (error) {
    res.status(401).json({ error: error.message || 'Your session has expired.' });
  }
};

const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// --- AUTH API ---
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, skillLevel } = req.body;
    const result = await auth.register(username, password, skillLevel);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await auth.login(username, password);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json(auth.publicUser(req.user));
});

app.post('/api/logout', requireAuth, async (req, res) => {
  await auth.logout(req.user);
  res.json({ ok: true });
});

app.get('/api/user/:id', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(auth.publicUser(user));
  } catch (e) {
    res.status(400).json({ error: 'Invalid user ID' });
  }
});

app.patch('/api/profile', requireAuth, async (req, res) => {
  if (typeof req.body.username === 'string' && req.body.username.trim() !== req.user.username) {
    return res.status(400).json({ error: 'Usernames are permanent and cannot be changed after account creation.' });
  }
  const username = req.user.username;
  const avatar = typeof req.body.avatar === 'string' ? req.body.avatar : req.user.avatar;
  if (username.length < 3 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3+ characters and use letters, numbers, _ or -.' });
  }
  if (avatar && avatar.length > 1_500_000) return res.status(400).json({ error: 'That image is too large. Please use a smaller photo.' });

  const taken = await User.findOne({
    username: { $regex: new RegExp(`^${username}$`, 'i') },
    _id: { $ne: req.user._id }
  });
  if (taken) return res.status(400).json({ error: 'That username is already taken.' });

  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    { username, avatar: avatar || null },
    { new: true }
  );
  res.json(auth.publicUser(updatedUser));
});

app.get('/api/games', requireAuth, async (req, res) => {
  try {
    const games = await Game.find({ players: req.user._id })
      .sort({ finishedAt: -1 })
      .limit(30);
    res.json(games);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

app.get('/api/games/:id', requireAuth, async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game || !game.players.includes(req.user._id)) {
      return res.status(404).json({ error: 'Game not found.' });
    }
    res.json(game);
  } catch (e) {
    res.status(400).json({ error: 'Invalid game ID' });
  }
});

const isFriend = (user, otherId) => (user.friends || []).map(id => id.toString()).includes(otherId.toString());

app.get('/api/friends', requireAuth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    const friends = await User.find({ _id: { $in: currentUser.friends } });
    const requests = await User.find({ _id: { $in: currentUser.friendRequests } });

    res.json({
      friends: friends.map(auth.publicUser),
      requests: requests.map(auth.publicUser)
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

app.get('/api/users', requireAuth, async (req, res) => {
  const query = String(req.query.query || '').trim();
  if (query.length < 2) return res.json([]);

  try {
    const results = await User.find({
      username: { $regex: query, $options: 'i' },
      _id: { $ne: req.user._id }
    }).limit(8);

    res.json(results.map(user => ({
      ...auth.publicUser(user),
      friendship: isFriend(req.user, user._id) ? 'friends' : 'none'
    })));

  } catch (e) {
    res.status(500).json({ error: 'User search failed' });
  }
});

app.post('/api/friends/request', requireAuth, async (req, res) => {
  try {
    const target = await User.findById(req.body.userId);
    if (!target || target._id.equals(req.user._id)) return res.status(400).json({ error: 'That player cannot be added.' });
    if (isFriend(req.user, target._id)) return res.status(400).json({ error: 'You are already friends.' });
    if (target.friendRequests.includes(req.user._id)) return res.status(400).json({ error: 'Friend request already sent.' });

    await User.findByIdAndUpdate(target._id, { $addToSet: { friendRequests: req.user._id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'Invalid player ID' });
  }
});

app.post('/api/friends/accept', requireAuth, async (req, res) => {
  try {
    const requesterId = req.body.userId;
    const currentUser = await User.findById(req.user._id);
    if (!currentUser || !currentUser.friendRequests.includes(requesterId)) {
      return res.status(400).json({ error: 'Friend request not found.' });
    }

    await User.findByIdAndUpdate(currentUser._id, {
      $addToSet: { friends: requesterId },
      $pull: { friendRequests: requesterId }
    });
    await User.findByIdAndUpdate(requesterId, { $addToSet: { friends: currentUser._id } });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'Operation failed' });
  }
});

// --- GAME LOGIC ---
const games = new Map();
const HIDDEN_PAWN_FILES = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
const hiddenPawnSquare = (file, color) => `${file}${color === 'white' ? '2' : '7'}`;
const KNIGHTFALL_FEN = 'rnnqknnr/pppppppp/8/8/8/8/PPPPPPPP/RNNQKNNR w KQkq - 0 1';

function chess960BackRank(random = Math.random) {
  const rank = Array(8).fill(null);
  const take = (choices) => choices[Math.floor(random() * choices.length)];
  const darkBishop = take([0, 2, 4, 6]);
  const lightBishop = take([1, 3, 5, 7]);
  rank[darkBishop] = 'B'; rank[lightBishop] = 'B';
  let open = () => rank.map((piece, index) => piece ? null : index).filter((index) => index !== null);
  rank[take(open())] = 'Q';
  rank[take(open())] = 'N';
  rank[take(open())] = 'N';
  const [leftRook, king, rightRook] = open();
  rank[leftRook] = 'R'; rank[king] = 'K'; rank[rightRook] = 'R';
  return rank.join('');
}

function chess960Setup() {
  const whiteRank = chess960BackRank();
  const blackRank = whiteRank.toLowerCase();
  const kingFile = String.fromCharCode(97 + whiteRank.indexOf('K'));
  const rookFiles = [...whiteRank].flatMap((piece, index) => piece === 'R' ? [String.fromCharCode(97 + index)] : []);
  return {
    fen: `${blackRank}/pppppppp/8/8/8/8/PPPPPPPP/${whiteRank} w - - 0 1`,
    rights: {
      white: { king: `${kingFile}1`, queenRook: `${rookFiles[0]}1`, kingRook: `${rookFiles[1]}1` },
      black: { king: `${kingFile}8`, queenRook: `${rookFiles[0]}8`, kingRook: `${rookFiles[1]}8` }
    }
  };
}

function variantSetup(variant) {
  if (variant === 'chess960') return chess960Setup();
  if (variant === 'knightfall') return { fen: KNIGHTFALL_FEN };
  return { fen: new Chess().fen() };
}

const horizontalSquares = (from, to) => {
  const step = from.charCodeAt(0) <= to.charCodeAt(0) ? 1 : -1;
  const squares = [];
  for (let file = from.charCodeAt(0); ; file += step) {
    squares.push(`${String.fromCharCode(file)}${from[1]}`);
    if (file === to.charCodeAt(0)) return squares;
  }
};

function attemptChess960Castle(game, player, move) {
  const color = player.color;
  const rank = color === 'white' ? '1' : '8';
  const kingTo = move.to;
  const side = kingTo === `g${rank}` ? 'kingRook' : kingTo === `c${rank}` ? 'queenRook' : null;
  const rights = game.chess960Rights?.[color];
  if (!side || !rights || move.from !== rights.king) return null;
  const rookFrom = rights[side];
  const rookTo = `${side === 'kingRook' ? 'f' : 'd'}${rank}`;
  const kingPiece = game.chess.get(rights.king);
  const rookPiece = game.chess.get(rookFrom);
  if (kingPiece?.type !== 'k' || kingPiece.color !== color[0] || rookPiece?.type !== 'r' || rookPiece.color !== color[0]) return null;
  const before = game.chess.fen();
  const staged = new Chess(before);
  staged.remove(rights.king); staged.remove(rookFrom);
  const requiredEmpty = new Set([...horizontalSquares(rights.king, kingTo), ...horizontalSquares(rookFrom, rookTo)]);
  if ([...requiredEmpty].some((square) => staged.get(square))) return null;
  const enemy = color === 'white' ? 'b' : 'w';
  if (horizontalSquares(rights.king, kingTo).some((square) => staged.isAttacked(square, enemy))) return null;
  staged.put({ type: 'k', color: color[0] }, kingTo);
  staged.put({ type: 'r', color: color[0] }, rookTo);
  if (staged.isAttacked(kingTo, enemy)) return null;
  const parts = staged.fen().split(' ');
  parts[1] = enemy;
  parts[2] = '-'; parts[3] = '-'; parts[4] = '0';
  if (color === 'black') parts[5] = String(Number(parts[5]) + 1);
  game.chess = new Chess(parts.join(' '));
  delete game.chess960Rights[color];
  return { color: color[0], from: rights.king, to: kingTo, piece: 'k', flags: side === 'kingRook' ? 'k' : 'q', san: side === 'kingRook' ? 'O-O' : 'O-O-O', before, after: game.chess.fen() };
}

function updateChess960Rights(game, appliedMove) {
  if (game.variant !== 'chess960' || !game.chess960Rights) return;
  for (const color of ['white', 'black']) {
    const rights = game.chess960Rights[color];
    if (!rights) continue;
    if (appliedMove.from === rights.king || appliedMove.to === rights.king) delete game.chess960Rights[color];
    else {
      if (appliedMove.from === rights.queenRook || appliedMove.to === rights.queenRook) delete rights.queenRook;
      if (appliedMove.from === rights.kingRook || appliedMove.to === rights.kingRook) delete rights.kingRook;
      if (!rights.queenRook && !rights.kingRook) delete game.chess960Rights[color];
    }
  }
}

const serializePlayers = (players) => players.map(({ id, userId, username, rating, avatar, color }) => ({
  id: userId || id,
  username,
  rating,
  avatar: avatar || null,
  color
}));

const gameResult = (chess) => {
  if (chess.isCheckmate()) return { winner: chess.turn() === 'w' ? 'black' : 'white' };
  if (chess.isDraw()) return { draw: true };
  return null;
};

async function persistGame(game, result, reason = 'completed') {
  if (game.persisted || !game.started) return null;
  game.persisted = true;
  const white = game.players.find((player) => player.color === 'white');
  const black = game.players.find((player) => player.color === 'black');
  if (!white || !black) return null;

  const deltas = ratedResult(white.rating, black.rating, result);

  try {
    await Promise.all([
      User.findByIdAndUpdate(white.userId, {
        rating: Math.max(100, white.rating + deltas.white),
        [result === 'draw' ? 'draws' : (result === 'white' ? 'wins' : 'losses')]: { $inc: 1 }
      }),
      User.findByIdAndUpdate(black.userId, {
        rating: Math.max(100, black.rating + deltas.black),
        [result === 'draw' ? 'draws' : (result === 'black' ? 'wins' : 'losses')]: { $inc: 1 }
      })
    ]);

    const record = {
      id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      players: serializePlayers(game.players).map(p => ({ ...p, _id: p.id })),
      result,
      reason,
      timeControl: game.timeControl,
      variant: game.variant || 'standard',
      initialFen: game.initialFen || new Chess().fen(),
      moves: game.moveLog || game.chess.history({ verbose: true }),
      revealedPawns: game.variant === 'hidden-pawn' ? Object.fromEntries(Object.entries(game.hiddenPawns || {}).map(([color, pawn]) => [color, { square: pawn.square, revealed: pawn.revealed }])) : undefined,
      finishedAt: new Date(),
      ratingChanges: deltas
    };
    await Game.create(record);

    const whiteUser = await User.findById(white.userId);
    const blackUser = await User.findById(black.userId);

    return { ...record, ratings: {
      white: whiteUser?.rating,
      black: blackUser?.rating
    } };
  } catch (e) {
    console.error('Failed to persist game:', e);
    return null;
  }
}

async function finishGame(game, result, reason = 'completed') {
  if (!game || game.finished) return;
  game.finished = true;
  const summary = await persistGame(game, result, reason);
  io.to(game.id).emit('gameOver', {
    winner: result === 'draw' ? undefined : result,
    draw: result === 'draw',
    reason,
    ratingChanges: summary?.ratingChanges || { white: 0, black: 0 },
    ratings: summary?.ratings
  });
}

function removePlayer(socket, notifyOpponent = true) {
  const gameId = socket.data.gameId;
  if (!gameId) return;
  const game = games.get(gameId);
  socket.leave(gameId);
  socket.data.gameId = undefined;
  if (!game) return;
  const departing = game.players.find((player) => player.id === socket.id);
  if (notifyOpponent && game.started && !game.finished && departing && game.players.length === 2) {
    finishGame(game, departing.color === 'white' ? 'black' : 'white', 'abandonment');
    io.to(gameId).emit('opponentLeft');
  }
  game.players = game.players.filter((player) => player.id !== socket.id);
  games.delete(gameId);
}

setInterval(() => {
  for (const game of games.values()) {
    if (!game.started || game.finished || !game.lastMoveAt) continue;
    const color = game.chess.turn() === 'w' ? 'white' : 'black';
    const remaining = game.clocks[color] - ((Date.now() - game.lastMoveAt) / 1000);
    if (remaining <= 0) {
      game.clocks[color] = 0;
      finishGame(game, color === 'white' ? 'black' : 'white', 'timeout');
    }
  }
}, 500);

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next();
  try {
    socket.data.user = await auth.verifySession(token);
    next();
  } catch {
    next(new Error('Your session has expired. Please sign in again.'));
  }
});

io.on('connection', (socket) => {
  socket.on('joinQuickMatch', async ({ timeControl, variant = 'standard', hiddenPawnFile } = {}) => {
    if (!socket.data.user) {
      socket.emit('matchError', { message: 'Guest accounts can play bots only. Sign in to play online.' });
      return;
    }
    const controls = {
      'bullet-1': { label: 'Bullet · 1:00', base: 60, increment: 0 },
      'bullet-1-1': { label: 'Bullet · 1:00 + 1', base: 60, increment: 1 },
      'bullet-2': { label: 'Bullet · 2:00', base: 120, increment: 0 },
      'blitz-3': { label: 'Blitz · 3:00', base: 180, increment: 0 },
      'blitz-3-2': { label: 'Blitz · 3:00 + 2', base: 180, increment: 2 },
      'blitz-5': { label: 'Blitz · 5:00', base: 300, increment: 0 },
      'rapid-10': { label: 'Rapid · 10:00', base: 600, increment: 0 },
      'rapid-10-5': { label: 'Rapid · 10:00 + 5', base: 600, increment: 5 },
      'rapid-15': { label: 'Rapid · 15:00', base: 900, increment: 0 }
    };
    const effectiveTimeControl = variant === 'hidden-pawn' ? 'blitz-5' : timeControl;
    if (!controls[effectiveTimeControl]) {
      socket.emit('matchError', { message: 'Choose a valid time control.' });
      return;
    }
    if (!['standard', 'hidden-pawn', 'chess960', 'knightfall'].includes(variant)) {
      socket.emit('matchError', { message: 'Choose a valid game type.' });
      return;
    }
    if (variant === 'hidden-pawn' && !HIDDEN_PAWN_FILES.has(hiddenPawnFile)) {
      socket.emit('matchError', { message: 'Choose one pawn file before entering Hidden Pawn.' });
      return;
    }

    try {
      const registeredUser = await User.findById(socket.data.user._id);
      if (!registeredUser) return socket.emit('matchError', { message: 'Your account session has expired. Please sign in again.' });

      removePlayer(socket, false);

      const waitingGame = [...games.values()].find((game) => !game.started && game.players.length === 1 && game.timeControl.key === effectiveTimeControl && game.variant === variant);
      if (waitingGame) {
        const player = { id: socket.id, userId: registeredUser._id, username: registeredUser.username, rating: registeredUser.rating, avatar: registeredUser.avatar, color: 'black' };
        waitingGame.players.push(player);
        if (variant === 'hidden-pawn') waitingGame.hiddenPawns.black = { file: hiddenPawnFile, square: hiddenPawnSquare(hiddenPawnFile, 'black'), revealed: false };
        waitingGame.started = true;
        waitingGame.startedAt = Date.now();
        waitingGame.lastMoveAt = Date.now();
        socket.data.gameId = waitingGame.id;
        socket.join(waitingGame.id);
        socket.emit('matchReady', { gameId: waitingGame.id, color: player.color, variant, hiddenPawn: waitingGame.hiddenPawns?.black?.square });
        if (variant === 'hidden-pawn') {
          const whitePlayer = waitingGame.players.find((candidate) => candidate.color === 'white');
          io.to(whitePlayer.id).emit('hiddenPawnAssigned', { square: waitingGame.hiddenPawns.white.square });
        }
        io.to(waitingGame.id).emit('matchFound', {
          gameId: waitingGame.id,
          players: serializePlayers(waitingGame.players),
          fen: waitingGame.chess.fen(),
          turn: waitingGame.chess.turn(),
          timeControl: waitingGame.timeControl,
          variant,
          clocks: waitingGame.clocks
        });
        return;
      }

      const gameId = `game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const setup = variantSetup(variant);
      const game = {
        id: gameId,
        chess: new Chess(setup.fen),
        players: [{ id: socket.id, userId: registeredUser._id, username: registeredUser.username, rating: registeredUser.rating, avatar: registeredUser.avatar, color: 'white' }],
        timeControl: { key: effectiveTimeControl, ...controls[effectiveTimeControl] },
        variant,
        initialFen: setup.fen,
        chess960Rights: setup.rights,
        moveLog: [],
        hiddenPawns: variant === 'hidden-pawn' ? { white: { file: hiddenPawnFile, square: hiddenPawnSquare(hiddenPawnFile, 'white'), revealed: false } } : undefined,
        clocks: { white: controls[effectiveTimeControl].base, black: controls[effectiveTimeControl].base },
        started: false,
        finished: false
      };
      games.set(gameId, game);
      socket.data.gameId = gameId;
      socket.join(gameId);
      socket.emit('matchWaiting', { gameId, color: 'white', variant, hiddenPawn: game.hiddenPawns?.white?.square, fen: game.chess.fen(), timeControl: game.timeControl, clocks: game.clocks });
    } catch (e) {
      socket.emit('matchError', { message: 'Server error during matchmaking.' });
    }
  });

  socket.on('makeMove', ({ gameId, move } = {}) => {
    const game = games.get(gameId);
    const player = game?.players.find((candidate) => candidate.id === socket.id);
    const reject = (message) => socket.emit('moveRejected', { message, fen: game?.chess.fen() });

    if (!game || socket.data.gameId !== gameId) return reject('This match is no longer available.');
    if (!game.started || game.finished) return reject('The match has not started or is already over.');
    if (!player || player.color[0] !== game.chess.turn()) return reject('It is not your turn.');
    if (!move?.from || !move?.to) return reject('That move is invalid.');

    const elapsed = Math.max(0, (Date.now() - game.lastMoveAt) / 1000);
    game.clocks[player.color] -= elapsed;
    if (game.clocks[player.color] <= 0) return finishGame(game, player.color === 'white' ? 'black' : 'white', 'timeout');
    let appliedMove;
    let revealedPawn = null;
    try {
      appliedMove = game.chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    } catch {
      const chess960Castle = game.variant === 'chess960' ? attemptChess960Castle(game, player, move) : null;
      if (chess960Castle) {
        appliedMove = chess960Castle;
      } else {
      const hiddenPawn = game.variant === 'hidden-pawn' ? game.hiddenPawns?.[player.color] : null;
      const selectedPiece = game.chess.get(move.from);
      const canReveal = hiddenPawn && !hiddenPawn.revealed && move.from === hiddenPawn.square && selectedPiece?.type === 'p' && selectedPiece.color === player.color[0];
      if (!canReveal) return reject('That move is not legal.');
      game.chess.remove(move.from);
      game.chess.put({ type: 'q', color: player.color[0] }, move.from);
      try {
        appliedMove = game.chess.move({ from: move.from, to: move.to, promotion: 'q' });
        hiddenPawn.revealed = true;
        revealedPawn = { color: player.color, square: move.from, to: move.to };
      } catch {
        game.chess.remove(move.from);
        game.chess.put({ type: 'p', color: player.color[0] }, move.from);
        return reject('That move is not legal for your hidden pawn.');
      }
      }
    }

    const privatePawn = game.variant === 'hidden-pawn' ? game.hiddenPawns?.[player.color] : null;
    if (privatePawn && !privatePawn.revealed && appliedMove.piece === 'p' && appliedMove.from === privatePawn.square) {
      privatePawn.square = appliedMove.to;
    }
    updateChess960Rights(game, appliedMove);
    game.moveLog.push({ ...appliedMove });

    game.clocks[player.color] += game.timeControl.increment;
    game.lastMoveAt = Date.now();

    io.to(gameId).emit('gameState', {
      fen: game.chess.fen(),
      move: appliedMove.san,
      reveal: revealedPawn,
      turn: game.chess.turn(),
      clocks: game.clocks
    });

    const result = gameResult(game.chess);
    if (result) {
      finishGame(game, result.draw ? 'draw' : result.winner, 'checkmate');
    }
  });

  socket.on('resign', ({ gameId } = {}) => {
    const game = games.get(gameId);
    const player = game?.players.find((candidate) => candidate.id === socket.id);
    if (!game || !player || game.finished) return;
    finishGame(game, player.color === 'white' ? 'black' : 'white', 'resignation');
  });

  socket.on('offerDraw', ({ gameId } = {}) => {
    const game = games.get(gameId);
    const player = game?.players.find((candidate) => candidate.id === socket.id);
    if (!game || !player || game.finished) return;
    game.drawOfferedBy = player.color;
    socket.to(gameId).emit('drawOffered', { by: player.username });
  });

  socket.on('respondDraw', ({ gameId, accept } = {}) => {
    const game = games.get(gameId);
    const player = game?.players.find((candidate) => candidate.id === socket.id);
    if (!game || !player || !game.drawOfferedBy || game.drawOfferedBy === player.color || game.finished) return;
    if (accept) finishGame(game, 'draw', 'agreement');
    else {
      game.drawOfferedBy = null;
      socket.to(gameId).emit('drawDeclined');
    }
  });

  socket.on('leaveGame', () => removePlayer(socket));
  socket.on('disconnect', () => removePlayer(socket));
});

const frontendBuild = path.resolve(__dirname, '../frontend/dist');
if (fs.existsSync(frontendBuild)) {
  app.use(express.static(frontendBuild));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(frontendBuild, 'index.html')));
}

const PORT = process.env.PORT || 5001;

// Initialize MongoDB and start server
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📂 Database is now hosted on MongoDB Atlas.`);
  });
}).catch(err => {
  console.error('Failed to start server due to DB connection error:', err);
});
