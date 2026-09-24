import React, { useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { ArrowLeft, BarChart3, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Lightbulb, Sparkles } from 'lucide-react';
import { analyzeStockfishPosition } from '../stockfishEngine';

const boardThemes = { midnight: { light: '#a7b9d3', dark: '#344766' }, classic: { light: '#f0d9b5', dark: '#b58863' }, forest: { light: '#e7edcf', dark: '#779556' } };
const expectedPoints = (centipawns) => 1 / (1 + Math.exp(-Math.max(-1_000, Math.min(1_000, centipawns)) / 180));
const classifyMove = (loss) => loss === null ? 'Unclassified' : loss < .005 ? 'Best' : loss < .02 ? 'Excellent' : loss < .05 ? 'Good' : loss < .1 ? 'Inaccuracy' : loss < .2 ? 'Mistake' : 'Blunder';
const formatEvaluation = (value) => value === null || value === undefined ? '—' : value >= 9_000 ? '# White' : value <= -9_000 ? '# Black' : `${value >= 0 ? '+' : ''}${(value / 100).toFixed(2)}`;
const formatEngineMove = (move) => move ? `${move.slice(0, 2)} → ${move.slice(2, 4)}${move[4] ? ` = ${move[4].toUpperCase()}` : ''}` : null;
const coachCopy = (entry) => {
  if (!entry) return null;
  const side = entry.color === 'w' ? 'White' : 'Black';
  const messages = {
    Best: `${side} found the engine’s top line and kept the position under control.`,
    Excellent: `${side} played a very accurate move and kept nearly all of the advantage.`,
    Good: `${side} chose a sound continuation. There was a slightly sharper option, but no major damage.`,
    Inaccuracy: `${side} gave away a small amount of expected score. Look for a more active continuation.`,
    Mistake: `${side} missed a meaningful opportunity. This is worth replaying and comparing with the engine idea.`,
    Blunder: `${side} changed the game sharply. Jump back one move, then compare the recommended continuation.`
  };
  return messages[entry.label] || 'Run a full review to unlock a move-by-move explanation.';
};
const EvaluationGraph = ({ entries, activePly }) => {
  const values = entries?.map((entry) => Math.max(-800, Math.min(800, entry.evaluationCp || 0))) || [];
  if (!values.length) return <div className="evaluation-blank">Run game review to draw the evaluation graph.</div>;
  const points = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${50 - (value / 800) * 43}`).join(' ');
  const activeIndex = Math.max(0, Math.min(values.length - 1, (activePly || 1) - 1));
  const activeX = (activeIndex / Math.max(1, values.length - 1)) * 100;
  const activeY = 50 - (values[activeIndex] / 800) * 43;
  return <div className="evaluation-graph" aria-label="White-perspective evaluation graph"><div className="graph-caption"><span>After move {activeIndex + 1}</span><strong>{formatEvaluation(entries[activeIndex]?.evaluationCp)}</strong></div><div className="graph-label white">White better</div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"><line x1="0" y1="50" x2="100" y2="50" /><polyline points={`0,50 ${points} 100,50`} /><polyline className="graph-line" points={points} /><line className="graph-cursor" x1={activeX} y1="0" x2={activeX} y2="100" /><circle className="graph-dot" cx={activeX} cy={activeY} r="2.2" /></svg><div className="graph-label black">Black better</div></div>;
};

const GameAnalysis = ({ game, settings, onBack }) => {
  const moves = Array.isArray(game.moves) ? game.moves : [];
  const [ply, setPly] = useState(moves.length);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [review, setReview] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewProgress, setReviewProgress] = useState(0);
  const position = useMemo(() => {
    if (!ply) return game.initialFen || new Chess().fen();
    return moves[ply - 1]?.after || game.initialFen || new Chess().fen();
  }, [game, moves, ply]);
  const theme = boardThemes[settings.board] || boardThemes.midnight;
  const whitePlayer = game.players?.find((player) => player.color === 'white');
  const blackPlayer = game.players?.find((player) => player.color === 'black');
  const moveGroups = moves.reduce((groups, move, index) => {
    if (index % 2 === 0) groups.push([move]); else groups[groups.length - 1].push(move);
    return groups;
  }, []);
  const activeReview = ply ? review?.entries[ply - 1] : null;
  const labelCounts = review?.entries.reduce((counts, entry) => ({ ...counts, [entry.label]: (counts[entry.label] || 0) + 1 }), {}) || {};
  const keyMoments = review?.entries.filter((entry) => ['Inaccuracy', 'Mistake', 'Blunder'].includes(entry.label)).sort((a, b) => (b.loss || 0) - (a.loss || 0)).slice(0, 4) || [];
  const analyze = async () => {
    setIsAnalyzing(true); setSuggestion(null);
    const analysis = await analyzeStockfishPosition(position, 16, 2_500);
    const move = analysis.bestMove;
    setSuggestion(move ? { evaluation: analysis.evaluationCp, move: `${move.slice(0, 2)} → ${move.slice(2, 4)}${move[4] ? ` = ${move[4].toUpperCase()}` : ''}`, depth: analysis.depth } : { unavailable: true });
    setIsAnalyzing(false);
  };
  const reviewGame = async () => {
    if (!moves.length || reviewing) return;
    setReviewing(true); setReviewProgress(0); setReview(null);
    const positions = [game.initialFen || new Chess().fen(), ...moves.map((move) => move.after)];
    let previous = await analyzeStockfishPosition(positions[0], 10, 550);
    const entries = [];
    for (let index = 0; index < moves.length; index += 1) {
      const next = await analyzeStockfishPosition(positions[index + 1], 10, 550);
      const before = previous.evaluationCp;
      const after = next.evaluationCp;
      const moverIsWhite = moves[index].color === 'w';
      const loss = before === null || after === null ? null : Math.max(0, (moverIsWhite ? expectedPoints(before) - expectedPoints(after) : (1 - expectedPoints(before)) - (1 - expectedPoints(after))));
      entries.push({ ...moves[index], evaluationCp: after, beforeCp: before, bestMove: previous.bestMove, loss, label: classifyMove(loss) });
      previous = next;
      setReviewProgress(index + 1);
    }
    const accuracyFor = (color) => {
      const losses = entries.filter((entry) => entry.color === color && entry.loss !== null).map((entry) => entry.loss);
      return losses.length ? Math.max(0, Math.min(100, Math.round(100 * (1 - losses.reduce((sum, loss) => sum + loss, 0) / losses.length)))) : null;
    };
    setReview({ entries, whiteAccuracy: accuracyFor('w'), blackAccuracy: accuracyFor('b') });
    setReviewing(false);
  };

  return <main className="analysis-page">
    <header className="game-topbar"><button className="back-link" onClick={onBack}><ArrowLeft size={18} /> Back to history</button><div><p className="eyebrow">Post-game review</p><h1>Analyze game</h1></div><span className="premove-label">{game.variant === 'hidden-pawn' ? 'Hidden Pawn' : game.variant === 'chess960' ? 'Chess960' : game.variant === 'knightfall' ? 'Knightfall' : game.timeControl?.label || 'Online game'}</span></header>
    <section className="analysis-layout">
      {review ? <section className="review-overview"><div className="review-overview-copy"><p className="eyebrow">Game review complete</p><h2>Your game at a glance</h2><p>Accuracy measures how closely each side stayed to the engine’s preferred plans. Use the key moments to replay the moves that changed the game.</p></div><div className="accuracy-orbs"><div className="accuracy-orb white" style={{ '--score': review.whiteAccuracy ?? 0 }}><b>{review.whiteAccuracy ?? '—'}<small>%</small></b><span>{whitePlayer?.username || 'White'}</span></div><div className="accuracy-orb black" style={{ '--score': review.blackAccuracy ?? 0 }}><b>{review.blackAccuracy ?? '—'}<small>%</small></b><span>{blackPlayer?.username || 'Black'}</span></div></div><div className="review-breakdown"><span><b>{labelCounts.Best || 0}</b> Best</span><span><b>{labelCounts.Excellent || 0}</b> Excellent</span><span><b>{labelCounts.Mistake || 0}</b> Mistakes</span><span><b>{labelCounts.Blunder || 0}</b> Blunders</span></div>{keyMoments.length > 0 && <div className="key-moments"><span>Key moments</span>{keyMoments.map((moment) => { const momentPly = review.entries.indexOf(moment) + 1; return <button key={`${momentPly}-${moment.san}`} onClick={() => setPly(momentPly)} className={ply === momentPly ? 'active' : ''}>Move {Math.ceil(momentPly / 2)} · {moment.san}<b>{moment.label}</b></button>; })}</div>}</section> : <section className="review-start"><div><p className="eyebrow">Game review</p><h2>Find the moments that mattered.</h2><p>Review your whole game for accuracy, move labels, key mistakes, and engine suggestions — all in your browser.</p></div><button className="primary-button" disabled={reviewing || !moves.length} onClick={reviewGame}><BarChart3 size={17} />{reviewing ? `Reviewing ${reviewProgress}/${moves.length}` : 'Start game review'}</button></section>}
      <div className="analysis-board"><section className="analysis-scoreboard"><div><span>White</span><strong>{whitePlayer?.username || 'White'}</strong><b>{whitePlayer?.rating ?? '—'} <small>Elo</small></b></div><div className="analysis-result">{game.result === 'draw' ? '½–½' : game.result === 'white' ? '1–0' : '0–1'}</div><div><span>Black</span><strong>{blackPlayer?.username || 'Black'}</strong><b>{blackPlayer?.rating ?? '—'} <small>Elo</small></b></div></section>{activeReview && <div className={`active-move-insight ${activeReview.label.toLowerCase()}`}><span>Move {Math.ceil(ply / 2)}{ply % 2 ? ' · White' : ' · Black'}</span><strong>{activeReview.san} · {activeReview.label}</strong><b>{formatEvaluation(activeReview.evaluationCp)}</b></div>}<div className="board-frame"><div className="board-inner"><Chessboard options={{ position, boardOrientation: 'white', showNotation: settings.boardLabels, animationDurationInMs: settings.reducedMotion ? 0 : 140, darkSquareStyle: { backgroundColor: theme.dark }, lightSquareStyle: { backgroundColor: theme.light }, boardStyle: { borderRadius: '6px' } }} /></div></div><div className="analysis-controls"><button onClick={() => setPly(0)} disabled={!ply} aria-label="First position"><ChevronsLeft size={18} /></button><button onClick={() => setPly(Math.max(0, ply - 1))} disabled={!ply} aria-label="Previous move"><ChevronLeft size={18} /></button><span>{ply} / {moves.length} plies</span><button onClick={() => setPly(Math.min(moves.length, ply + 1))} disabled={ply === moves.length} aria-label="Next move"><ChevronRight size={18} /></button><button onClick={() => setPly(moves.length)} disabled={ply === moves.length} aria-label="Final position"><ChevronsRight size={18} /></button></div>{review && <EvaluationGraph entries={review.entries} activePly={ply} />}</div>
      <aside className="analysis-sidebar"><section className="analysis-card"><p className="eyebrow">Move list</p>{moves.length ? <div className="analysis-moves">{moveGroups.map(([white, black], index) => <div key={index}><span>{index + 1}.</span><button className={ply === index * 2 + 1 ? 'active' : ''} onClick={() => setPly(index * 2 + 1)}>{white?.san}{review?.entries[index * 2] && <i className={`move-label ${review.entries[index * 2].label.toLowerCase()}`}>{review.entries[index * 2].label}</i>}</button>{black && <button className={ply === index * 2 + 2 ? 'active' : ''} onClick={() => setPly(index * 2 + 2)}>{black.san}{review?.entries[index * 2 + 1] && <i className={`move-label ${review.entries[index * 2 + 1].label.toLowerCase()}`}>{review.entries[index * 2 + 1].label}</i>}</button>}</div>)}</div> : <p className="analysis-empty">This older game was saved before move review was available.</p>}</section><section className="analysis-card engine-card"><div className="analysis-card-title"><Lightbulb size={19} /><div><p className="eyebrow">Position insight</p><strong>Find the best continuation</strong></div></div><p>Run Stockfish locally in your browser for the current position.</p><button className="primary-button" disabled={isAnalyzing || !moves.length} onClick={analyze}><Sparkles size={17} />{isAnalyzing ? 'Analyzing…' : 'Analyze position'}</button>{suggestion && <div className="engine-suggestion">{suggestion.unavailable ? 'No engine suggestion is available for this position.' : <><b>{formatEvaluation(suggestion.evaluation)}</b><span>Best move: <strong>{suggestion.move}</strong></span><small>Analysis depth {suggestion.depth || '—'}</small></>}</div>}</section><section className="analysis-card review-card"><div className="analysis-card-title"><BarChart3 size={19} /><div><p className="eyebrow">Game review</p><strong>Classify every move</strong></div></div><p>See the graph, move labels, and an accuracy estimate for both sides.</p><button className="primary-button" disabled={reviewing || !moves.length} onClick={reviewGame}>{reviewing ? `Reviewing ${reviewProgress}/${moves.length}` : review ? 'Run review again' : 'Run game review'}</button>{review && <div className="accuracy-summary"><span>White <b>{review.whiteAccuracy ?? '—'}%</b></span><span>Black <b>{review.blackAccuracy ?? '—'}%</b></span></div>}</section><section className="analysis-card game-summary"><p className="eyebrow">Game result</p><strong>{game.result === 'draw' ? 'Draw' : `${game.result === 'white' ? 'White' : 'Black'} won`}</strong><span>{game.reason || 'completed'} · {game.timeControl?.label || 'Online'}</span></section></aside>
    </section>
  </main>;
};

export default GameAnalysis;
