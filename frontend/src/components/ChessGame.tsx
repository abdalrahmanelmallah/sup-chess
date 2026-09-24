import React, { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { ArrowLeft, Bot, Flag, Handshake, RotateCcw, Timer, UserRound, Volume2, X } from 'lucide-react';
import { io } from 'socket.io-client';
import { findStockfishMove } from '../stockfishEngine';
import { playSound } from '../sound';
import { SERVER_URL, apiUrl } from '../api';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const boardThemes = { midnight: { light: '#a7b9d3', dark: '#344766' }, classic: { light: '#f0d9b5', dark: '#b58863' }, forest: { light: '#e7edcf', dark: '#779556' } };

const botProfiles = {
  rookie: { depth: 1, maxNodes: 700, delay: 420 },
  scout: { depth: 1, maxNodes: 3_000, delay: 540 },
  ember: { depth: 2, maxNodes: 12_000, delay: 720 },
  sable: { depth: 3, maxNodes: 48_000, delay: 900 },
  orion: { depth: 3, maxNodes: 90_000, delay: 1_100, engineDepth: 13, engineTime: 3_600 },
  astra: { depth: 4, maxNodes: 180_000, delay: 1_250, engineDepth: 18, engineTime: 7_500 }
};

// The bot plays Black. These values are deliberately more nuanced than a
// capture-only bot: it values material, central squares, development and
// checkmate. Alpha-beta pruning lets harder levels look several moves ahead
// without making the board unresponsive.
const pieceValues = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20_000 };
const centralSquares = new Set(['c3', 'd3', 'e3', 'f3', 'c4', 'd4', 'e4', 'f4', 'c5', 'd5', 'e5', 'f5', 'c6', 'd6', 'e6', 'f6']);

const positionScore = (game, botColor) => {
  if (game.isCheckmate()) return game.turn() === botColor[0] ? -100_000 : 100_000;
  if (game.isDraw()) return 0;
  let score = 0;
  game.board().forEach((row, rankIndex) => row.forEach((piece, fileIndex) => {
    if (!piece) return;
    const square = `${String.fromCharCode(97 + fileIndex)}${8 - rankIndex}`;
    let value = pieceValues[piece.type];
    if (centralSquares.has(square)) value += piece.type === 'p' ? 13 : 8;
    // Reward pieces that have developed away from their home rank.
    if ((piece.type === 'n' || piece.type === 'b') && ((piece.color === 'b' && square[1] !== '8') || (piece.color === 'w' && square[1] !== '1'))) value += 9;
    score += piece.color === 'b' ? value : -value;
  }));
  return botColor === 'black' ? score : -score;
};

const orderedMoves = (game) => game.moves({ verbose: true }).sort((left, right) => {
  const leftPriority = (left.captured ? pieceValues[left.captured] : 0) + (left.promotion ? pieceValues[left.promotion] : 0);
  const rightPriority = (right.captured ? pieceValues[right.captured] : 0) + (right.promotion ? pieceValues[right.promotion] : 0);
  return rightPriority - leftPriority;
});

const chooseBotMove = (game, difficulty, botColor) => {
  const profile = botProfiles[difficulty] || botProfiles.rookie;
  let visitedNodes = 0;
  const search = (depth, alpha, beta) => {
    if (depth === 0 || game.isGameOver() || visitedNodes >= profile.maxNodes) return positionScore(game, botColor);
    const maximizing = game.turn() === botColor[0];
    let best = maximizing ? -Infinity : Infinity;
    for (const move of orderedMoves(game)) {
      visitedNodes += 1;
      game.move(move);
      const value = search(depth - 1, alpha, beta);
      game.undo();
      if (maximizing) { best = Math.max(best, value); alpha = Math.max(alpha, best); }
      else { best = Math.min(best, value); beta = Math.min(beta, best); }
      if (beta <= alpha || visitedNodes >= profile.maxNodes) break;
    }
    return best;
  };

  let selectedMove = null;
  let bestScore = -Infinity;
  for (const move of orderedMoves(game)) {
    visitedNodes += 1;
    game.move(move);
    const score = search(profile.depth - 1, -Infinity, Infinity);
    game.undo();
    if (score > bestScore || (score === bestScore && Math.random() < 0.2)) { selectedMove = move; bestScore = score; }
    if (visitedNodes >= profile.maxNodes) break;
  }
  return selectedMove?.san || null;
};

const formatClock = (seconds) => {
  const safe = Math.max(0, Math.ceil(seconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

const kingSquare = (game, color) => {
  for (let row = 0; row < 8; row += 1) for (let file = 0; file < 8; file += 1) {
    const piece = game.board()[row][file];
    if (piece?.type === 'k' && piece.color === color[0]) return `${String.fromCharCode(97 + file)}${8 - row}`;
  }
  return null;
};

const BotAvatar = ({ bot }) => <span className={`bot-character bot-character-${bot?.key || 'rookie'} compact`} aria-hidden="true"><i /><b /><b /></span>;

const ChessGame = ({ gameMode, hiddenPawnFile, botDifficulty, botColor = 'white', bot, timeControl, user, onUserChange, settings, onBack }) => {
  const isOnlineGame = gameMode !== 'bot';
  const isHiddenPawn = gameMode === 'hidden-pawn';
  const isChess960 = gameMode === 'chess960';
  const matchTimeControl = isHiddenPawn ? 'blitz-5' : timeControl;
  const [fen, setFen] = useState(STARTING_FEN);
  const [status, setStatus] = useState(isOnlineGame ? 'Finding an opponent…' : botColor === 'white' ? 'Your turn' : 'Bot is thinking…');
  const [winner, setWinner] = useState(null);
  const [onlineMatch, setOnlineMatch] = useState(null);
  const [players, setPlayers] = useState([]);
  const [clocks, setClocks] = useState({ white: 0, black: 0 });
  const [clockSync, setClockSync] = useState(Date.now());
  const [clockTick, setClockTick] = useState(0);
  const [botThinking, setBotThinking] = useState(false);
  const [sendingMove, setSendingMove] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [premoves, setPremoves] = useState([]);
  const [drawOffer, setDrawOffer] = useState(null);
  const [confirmingResign, setConfirmingResign] = useState(false);
  const [boardFlipped, setBoardFlipped] = useState(false);
  const [hiddenPawn, setHiddenPawn] = useState(null);
  const [revealNotice, setRevealNotice] = useState(null);
  const socketRef = useRef(null);
  const previousFenRef = useRef(STARTING_FEN);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const queuePremove = (from, to) => {
    if (!settings.premoves) return;
    const limit = Math.max(1, Math.min(10, Number(settings.premoveLimit) || 1));
    setPremoves((current) => [...current, { from, to }].slice(-limit));
    setStatus(`Premove queued · ${Math.min(premoves.length + 1, limit)} of ${limit}`);
    playSound('premove', settings);
  };

  useEffect(() => {
    if (gameMode === 'bot') playSound('start', settingsRef.current);
  }, [gameMode]);

  useEffect(() => {
    if (!isOnlineGame) return undefined;
    const socket = SERVER_URL ? io(SERVER_URL, { auth: { token: localStorage.getItem('sup_token') } }) : io({ auth: { token: localStorage.getItem('sup_token') } });
    socketRef.current = socket;
    socket.on('matchWaiting', ({ gameId, color, fen: initialFen, clocks: initialClocks, hiddenPawn: assignedPawn, variant }) => {
      setOnlineMatch({ gameId, color, started: false, variant }); setHiddenPawn(assignedPawn || null); setFen(initialFen); setClocks(initialClocks); setClockSync(Date.now()); setStatus('Waiting for another player…');
    });
    socket.on('matchReady', ({ gameId, color, hiddenPawn: assignedPawn, variant }) => { setOnlineMatch((match) => ({ ...(match || {}), gameId, color, started: true, variant })); setHiddenPawn(assignedPawn || null); playSound('start', settingsRef.current); });
    socket.on('hiddenPawnAssigned', ({ square }) => setHiddenPawn(square));
    socket.on('matchFound', ({ fen: initialFen, players: nextPlayers, clocks: initialClocks, timeControl: control, variant }) => {
      setOnlineMatch((match) => match ? { ...match, started: true, timeControl: control, variant } : match);
      setPlayers(nextPlayers); setFen(initialFen); setClocks(initialClocks); setClockSync(Date.now()); setStatus('Match found. White to move.');
      playSound('join', settingsRef.current);
    });
    socket.on('gameState', ({ fen: nextFen, clocks: nextClocks, reveal }) => { setFen(nextFen); setClocks(nextClocks); setClockSync(Date.now()); setSendingMove(false); if (reveal) { setRevealNotice(`${reveal.color === 'white' ? 'White' : 'Black'} revealed their hidden pawn as a queen.`); playSound('check', settingsRef.current); } });
    socket.on('moveRejected', ({ message, fen: serverFen }) => { if (serverFen) setFen(serverFen); setSendingMove(false); setStatus(message); });
    socket.on('gameOver', async ({ winner: winningColor, draw, reason, ratingChanges }) => {
      setWinner(draw ? 'Draw agreed' : winningColor === 'white' ? 'White wins' : 'Black wins'); setSendingMove(false); setDrawOffer(null); setPremoves([]);
      if (!draw && reason === 'resignation') setStatus('Game ended by resignation.');
      else if (!draw && reason === 'timeout') setStatus('Time ran out.');
      else if (draw) setStatus('The draw was accepted.');
      playSound(draw ? 'draw' : reason === 'resignation' ? 'resign' : 'gameOver', settingsRef.current);
      if (ratingChanges && !user.isGuest) {
        const response = await fetch(apiUrl('/api/me'), { headers: { Authorization: `Bearer ${localStorage.getItem('sup_token')}` } });
        if (response.ok) onUserChange(await response.json());
      }
    });
    socket.on('drawOffered', ({ by }) => { setDrawOffer(by); setStatus(`${by} offered a draw.`); playSound('notify', settingsRef.current); });
    socket.on('drawDeclined', () => setStatus('Draw offer declined.'));
    socket.on('opponentLeft', () => setStatus('Opponent left the match.'));
    socket.on('matchError', ({ message }) => setStatus(message));
    socket.emit('joinQuickMatch', { timeControl: matchTimeControl, variant: isHiddenPawn ? 'hidden-pawn' : gameMode === 'knightfall' ? 'knightfall' : isChess960 ? 'chess960' : 'standard', hiddenPawnFile: isHiddenPawn ? hiddenPawnFile : undefined });
    return () => { socket.emit('leaveGame'); socket.disconnect(); socketRef.current = null; };
  }, [isOnlineGame, isHiddenPawn, matchTimeControl, hiddenPawnFile]);

  useEffect(() => {
    if (fen === previousFenRef.current) return;
    const nextGame = new Chess(fen);
    const lastMove = nextGame.history({ verbose: true }).at(-1);
    if (lastMove) playSound(lastMove.san.includes('#') || lastMove.san.includes('+') ? 'check' : lastMove.san.includes('O-O') ? 'castle' : lastMove.promotion ? 'promote' : lastMove.captured ? 'capture' : 'move', settingsRef.current);
    previousFenRef.current = fen;
  }, [fen]);

  useEffect(() => {
    if (!isOnlineGame || !onlineMatch?.started || winner) return undefined;
    const interval = window.setInterval(() => setClockTick((tick) => tick + 1), 250);
    return () => window.clearInterval(interval);
  }, [isOnlineGame, onlineMatch?.started, winner]);

  useEffect(() => {
    const game = new Chess(fen);
    if (game.isGameOver()) { setWinner(game.isCheckmate() ? (game.turn() === 'w' ? 'Black wins' : 'White wins') : 'Draw'); setStatus('Game over'); if (gameMode === 'bot') playSound('gameOver', settingsRef.current); return; }
    if (gameMode === 'bot') setStatus(game.turn() === botColor[0] ? 'Your turn' : 'Bot is thinking…');
    else if (onlineMatch?.started) setStatus(game.turn() === onlineMatch.color[0] ? 'Your turn' : 'Opponent’s turn');
  }, [fen, gameMode, onlineMatch]);

  useEffect(() => {
    const game = new Chess(fen);
    if (gameMode !== 'bot' || game.isGameOver() || game.turn() === botColor[0]) return undefined;
    setBotThinking(true);
    let cancelled = false;
    const profile = botProfiles[botDifficulty] || botProfiles.rookie;
    const timer = window.setTimeout(async () => {
      const botGame = new Chess(fen);
      let move = chooseBotMove(botGame, botDifficulty, botColor === 'white' ? 'black' : 'white');
      if (profile.engineDepth) {
        const engineMove = await findStockfishMove(fen, profile.engineDepth, profile.engineTime);
        if (engineMove) {
          const applied = botGame.move({ from: engineMove.slice(0, 2), to: engineMove.slice(2, 4), promotion: engineMove[4] || 'q' });
          if (applied) move = null;
        }
      }
      if (move) botGame.move(move);
      if (!cancelled) { setFen(botGame.fen()); setBotThinking(false); }
    }, profile.delay);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [fen, gameMode, botDifficulty, botColor]);

  function attemptMove(sourceSquare, targetSquare) {
    if (winner || botThinking || sendingMove) return false;
    const game = new Chess(fen);
    const playerColor = gameMode === 'bot' ? botColor : onlineMatch?.color;
    if (!playerColor) return false;
    if (isOnlineGame && onlineMatch?.started && game.turn() !== playerColor[0]) {
      queuePremove(sourceSquare, targetSquare); return false;
    }
    if (isOnlineGame && !onlineMatch?.started) return false;
    if (game.turn() !== playerColor[0]) return false;
    const movingPiece = game.get(sourceSquare);
    try {
      const move = game.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
      if (!move) return false;
      if (isHiddenPawn && hiddenPawn === sourceSquare && movingPiece?.type === 'p') setHiddenPawn(targetSquare);
      if (isOnlineGame) {
        setSendingMove(true); setFen(game.fen());
        socketRef.current?.emit('makeMove', { gameId: onlineMatch.gameId, move: { from: sourceSquare, to: targetSquare, promotion: 'q' } });
      } else setFen(game.fen());
      return true;
    } catch {
      // The local rules engine only knows standard chess. In Hidden Pawn, the
      // chosen pawn's first queen-style move must reach the authoritative
      // server, where the secret selection and king-safety are validated.
      const chosenPawn = isHiddenPawn && sourceSquare === hiddenPawn && game.get(sourceSquare)?.type === 'p';
      const chess960Castle = isChess960 && movingPiece?.type === 'k' && ['c1', 'g1', 'c8', 'g8'].includes(targetSquare);
      if ((!chosenPawn && !chess960Castle) || !isOnlineGame || !onlineMatch?.started) return false;
      setSendingMove(true);
      socketRef.current?.emit('makeMove', { gameId: onlineMatch.gameId, move: { from: sourceSquare, to: targetSquare, promotion: 'q' } });
      return true;
    }
  }

  useEffect(() => {
    const premove = premoves[0];
    if (!premove || !isOnlineGame || !onlineMatch?.started || winner || sendingMove) return;
    const game = new Chess(fen);
    if (game.turn() !== onlineMatch.color[0]) return;
    setPremoves((current) => current.slice(1));
    if (!attemptMove(premove.from, premove.to)) setStatus('A queued premove was no longer legal.');
  }, [fen, premoves, onlineMatch, winner, sendingMove]);

  const onDrop = ({ sourceSquare, targetSquare }) => { setSelectedSquare(null); return attemptMove(sourceSquare, targetSquare); };
  const onSquareClick = ({ piece, square }) => {
    const game = new Chess(fen); const playerColor = gameMode === 'bot' ? botColor : onlineMatch?.color;
    const isOwnPiece = piece?.pieceType?.[0] === playerColor?.[0];
    const canQueue = settings.premoves && isOnlineGame && onlineMatch?.started && !winner;
    const canMove = playerColor && game.turn() === playerColor[0] && !winner && !botThinking && !sendingMove;
    if (!canMove && !canQueue) { setSelectedSquare(null); return; }
    if (!selectedSquare) { if (isOwnPiece) setSelectedSquare(square); return; }
    if (selectedSquare === square) { setSelectedSquare(null); return; }
    if (canMove && attemptMove(selectedSquare, square)) setSelectedSquare(null);
    else if (canQueue) { queuePremove(selectedSquare, square); setSelectedSquare(null); }
    else setSelectedSquare(isOwnPiece ? square : null);
  };

  const effectiveClocks = { ...clocks };
  if (isOnlineGame && onlineMatch?.started && !winner) {
    const active = new Chess(fen).turn() === 'w' ? 'white' : 'black';
    effectiveClocks[active] = Math.max(0, clocks[active] - ((Date.now() - clockSync) / 1000));
  }
  void clockTick;
  const myColor = gameMode === 'bot' ? botColor : onlineMatch?.color;
  const me = players.find((player) => player.color === myColor) || { username: user.username, rating: user.rating, avatar: user.avatar, color: myColor };
  const opponent = players.find((player) => player.color !== myColor) || { username: gameMode === 'bot' ? bot?.name || 'Bot' : 'Finding player…', rating: gameMode === 'bot' ? bot?.rating : null, avatar: null, color: myColor === 'white' ? 'black' : 'white' };
  const theme = boardThemes[settings.board] || boardThemes.midnight;
  const preferredOrientation = settings.orientation === 'white' || settings.orientation === 'black' ? settings.orientation : (myColor || 'white');
  const boardOrientation = boardFlipped ? (preferredOrientation === 'white' ? 'black' : 'white') : preferredOrientation;
  const clockClass = (color) => `clock ${settings.clockWarning && effectiveClocks[color] <= 15 ? 'low-time' : ''}`;

  useEffect(() => {
    if (!settings.clockWarning || !isOnlineGame || !onlineMatch?.started || winner) return;
    const activeColor = new Chess(fen).turn() === 'w' ? 'white' : 'black';
    if (activeColor === myColor && effectiveClocks[activeColor] <= 10) playSound('lowTime', settings);
  }, [clockTick, clockSync, fen, settings, isOnlineGame, onlineMatch?.started, winner, myColor]);

  const clearPremoves = () => { setPremoves([]); setSelectedSquare(null); setStatus('Premoves cleared.'); };
  const rotateBoard = () => setBoardFlipped((flipped) => !flipped);
  const requestChess960Castle = (side) => {
    const game = new Chess(fen); const from = kingSquare(game, myColor);
    if (!from) return;
    attemptMove(from, `${side === 'short' ? 'g' : 'c'}${myColor === 'white' ? '1' : '8'}`);
  };

  const variantTitle = isHiddenPawn ? 'Hidden Pawn' : isChess960 ? 'Chess960' : gameMode === 'knightfall' ? 'Knightfall' : 'Online match';
  if (isOnlineGame && !onlineMatch?.started) return <main className="game-page matchmaking-page"><header className="game-topbar"><button className="back-link" onClick={onBack}><ArrowLeft size={18} /> Cancel search</button><div><p className="eyebrow">{isHiddenPawn ? 'Hidden Pawn · 5:00' : `${variantTitle} · Rated online`}</p><h1>Finding your opponent</h1></div><span className="premove-label">{isHiddenPawn ? '5:00' : timeControl}</span></header><section className="matchmaking-card"><div className="search-orbit"><span /><span /><i /></div><p className="eyebrow">Matchmaking</p><h2>{status}</h2><p>{isHiddenPawn ? 'Your pawn selection is locked in. This variant is always a 5-minute game; your opponent will choose theirs privately too.' : isChess960 ? 'Your back rank will be randomized when a player joins. The king begins between its rooks.' : gameMode === 'knightfall' ? 'Four knights per side, standard chess rules. Looking for a player at this exact time control.' : 'Looking for another player at this exact time control.'}</p>{isHiddenPawn && hiddenPawn && <div className="secret-pawn-note">Your secret pawn: <strong>{hiddenPawn}</strong></div>}<button className="dialog-cancel" onClick={onBack}>Cancel search</button></section></main>;

  return <main className="game-page">
    <header className="game-topbar"><button className="back-link" onClick={onBack}><ArrowLeft size={18} /> Back to arena</button><div><p className="eyebrow">{isOnlineGame ? onlineMatch?.timeControl?.label || variantTitle : `${bot?.rating || '—'} Elo practice`}</p><h1>{isOnlineGame ? variantTitle : `vs ${bot?.name || 'bot'}`}</h1></div><span className={`premove-label ${premoves.length ? 'ready' : ''}`}>{premoves.length ? `${premoves.length} premove${premoves.length === 1 ? '' : 's'} ready` : settings.premoves ? `Queue up to ${settings.premoveLimit}` : 'Premoves off'}</span></header>
    <section className="game-layout">
      <div className="board-column">
        <div className="player-bar opponent"><div><span className={`color-dot ${opponent.color}`} /> <strong>Opponent plays {opponent.color}</strong></div>{isOnlineGame && <b className={clockClass(opponent.color)}>{formatClock(effectiveClocks[opponent.color])}</b>}</div>
        <div className="board-frame"><div className="board-inner"><Chessboard options={{ position: fen, onPieceDrop: onDrop, onSquareClick, boardOrientation, animationDurationInMs: settings.moveAnimation && !settings.reducedMotion ? 180 : 0, showNotation: settings.boardLabels, boardStyle: { borderRadius: '6px' }, darkSquareStyle: { backgroundColor: theme.dark }, lightSquareStyle: { backgroundColor: theme.light }, squareStyles: { ...(selectedSquare ? { [selectedSquare]: { boxShadow: 'inset 0 0 0 3px #f8c965' } } : {}), ...(settings.moveHighlights ? premoves.reduce((styles, queued, index) => ({ ...styles, [queued.from]: { boxShadow: `inset 0 0 0 3px ${index ? '#8d6dff' : '#67a0ff'}` }, [queued.to]: { boxShadow: `inset 0 0 0 3px ${index ? '#8d6dff' : '#67a0ff'}` } }), {}) : {}) } }} /></div></div>
        <div className="player-bar me"><div><span className={`color-dot ${me.color}`} /> <strong>{me.color === 'white' ? 'You play White' : 'You play Black'}</strong></div>{isOnlineGame && <b className={clockClass(myColor)}>{formatClock(effectiveClocks[myColor])}</b>}</div>
      </div>
      <aside className="game-sidebar">
        <section className="matchup-card" aria-label="Players">
          <p className="eyebrow">Players</p>
          <div className="side-player opponent-player"><div className="side-player-name">{gameMode === 'bot' ? <BotAvatar bot={bot} /> : opponent.avatar ? <img src={opponent.avatar} alt="" /> : <UserRound size={20} />}<div><span>Opponent</span><strong>{opponent.username}</strong></div></div><b><small>Elo</small>{opponent.rating ?? '—'}</b></div>
          <div className="versus">vs</div>
          <div className="side-player"><div className="side-player-name">{me.avatar ? <img src={me.avatar} alt="" /> : <UserRound size={20} />}<div><span>You</span><strong>{me.username}</strong></div></div><b><small>Elo</small>{user.isGuest ? '—' : me.rating}</b></div>
        </section>
        <div className="status-card"><Timer size={19} /><div><span>Game status</span><strong>{status}</strong></div></div>{isHiddenPawn && hiddenPawn && <div className="secret-pawn-note">Your hidden pawn is <strong>{hiddenPawn}</strong>. A queen move will reveal it.</div>}{isChess960 && <div className="chess960-castle"><span>Chess960 castling</span><p>Finish with king on c/g and rook on d/f.</p><div><button disabled={!onlineMatch?.started || winner || sendingMove} onClick={() => requestChess960Castle('long')}>Castle long</button><button disabled={!onlineMatch?.started || winner || sendingMove} onClick={() => requestChess960Castle('short')}>Castle short</button></div></div>}{revealNotice && <div className="reveal-notice">{revealNotice}</div>}{winner && <div className="result-card"><span>Game complete</span><strong>{winner}</strong><p>{gameMode === 'bot' ? 'This practice game did not change your Elo.' : 'Your rating and game history have been updated.'}</p></div>}{drawOffer && <div className="draw-card"><strong>{drawOffer} offered a draw</strong><div><button onClick={() => { socketRef.current?.emit('respondDraw', { gameId: onlineMatch?.gameId, accept: true }); playSound('draw', settings); }}>Accept</button><button onClick={() => { socketRef.current?.emit('respondDraw', { gameId: onlineMatch?.gameId, accept: false }); setDrawOffer(null); }}>Decline</button></div></div>}<div className="game-actions"><div className="utility-actions"><button aria-label="Clear premoves" title="Clear premoves" onClick={clearPremoves} disabled={!premoves.length}><X size={17} /></button><button aria-label="Sound preview" title="Preview sound" onClick={() => playSound('move', settings)}><Volume2 size={17} /></button><button aria-label="Rotate board" title="Flip board" onClick={rotateBoard}><RotateCcw size={17} /></button></div>{isOnlineGame && <><button onClick={() => { socketRef.current?.emit('offerDraw', { gameId: onlineMatch?.gameId }); playSound('notify', settings); }}><Handshake size={18} /> Offer draw</button><button className="danger" onClick={() => { if (settings.confirmResign) setConfirmingResign(true); else { socketRef.current?.emit('resign', { gameId: onlineMatch?.gameId }); playSound('resign', settings); } }}><Flag size={18} /> Resign</button></>}{gameMode === 'bot' && <button onClick={() => { setFen(STARTING_FEN); setWinner(null); setPremoves([]); setSelectedSquare(null); playSound('start', settings); }}><RotateCcw size={18} /> Play {bot?.name || 'bot'} again</button>}</div><p className="game-note">{isHiddenPawn ? 'Your opponent cannot see which pawn you selected. When that pawn makes a queen move, it becomes a queen and the secret is revealed.' : isChess960 ? 'Your back rank is unique this game. Use the castle controls when the paths are clear; the king always finishes on c or g.' : gameMode === 'knightfall' ? 'Four knights replace the bishops. All other standard chess rules, including castling, still apply.' : isOnlineGame ? `Queue up to ${settings.premoveLimit} premoves while your opponent thinks. They only play when still legal.` : bot?.elite ? 'Astra uses the strongest local engine search available in the arena. Give it time to calculate tactical positions.' : `${bot?.name || 'This bot'} is rated ${bot?.rating || '—'} Elo. Bot practice does not affect your rating.`}</p></aside>
    </section>
    {confirmingResign && <div className="dialog-backdrop" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="resign-title"><div className="dialog-icon"><Flag size={22} /></div><h2 id="resign-title">Resign this game?</h2><p>Your opponent will be awarded the win and your rating may change.</p><div><button className="dialog-cancel" onClick={() => setConfirmingResign(false)}>Keep playing</button><button className="dialog-danger" onClick={() => { socketRef.current?.emit('resign', { gameId: onlineMatch?.gameId }); setConfirmingResign(false); playSound('resign', settings); }}>Resign game</button></div></section></div>}
  </main>;
};

export default ChessGame;
