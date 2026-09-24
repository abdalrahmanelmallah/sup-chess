const ENGINE_PATH = '/engine/stockfish-19-lite-single.js';

export type EngineAnalysis = { bestMove: string | null; evaluationCp: number | null; depth: number };

export const analyzeStockfishPosition = (fen: string, targetDepth = 14, maximumThinkMs = 2_500): Promise<EngineAnalysis> => new Promise((resolve) => {
  const worker = new Worker(ENGINE_PATH);
  let started = false;
  let finished = false;
  let latest: EngineAnalysis = { bestMove: null, evaluationCp: null, depth: 0 };
  const sideToMove = fen.split(' ')[1] || 'w';

  const finish = (bestMove = latest.bestMove) => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timeout);
    try { worker.postMessage('quit'); } catch { /* Worker may already be closed. */ }
    worker.terminate();
    resolve({ ...latest, bestMove: bestMove && bestMove !== '(none)' ? bestMove : null });
  };

  const timeout = window.setTimeout(() => { worker.postMessage('stop'); window.setTimeout(() => finish(), 250); }, maximumThinkMs);
  worker.onmessage = (event) => {
    const line = String(event.data || '').trim();
    if (line === 'uciok') worker.postMessage('isready');
    if (line === 'readyok' && !started) {
      started = true;
      worker.postMessage('ucinewgame');
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${targetDepth}`);
    }
    const info = line.match(/\bdepth (\d+).*?\bscore (cp|mate) (-?\d+).*?(?:\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?))?/);
    if (info) {
      const raw = info[2] === 'mate' ? (Number(info[3]) >= 0 ? 10_000 : -10_000) : Number(info[3]);
      latest = { bestMove: info[4] || latest.bestMove, evaluationCp: sideToMove === 'w' ? raw : -raw, depth: Number(info[1]) };
    }
    if (line.startsWith('bestmove ')) finish(line.split(/\s+/)[1]);
  };
  worker.onerror = () => finish();
  worker.postMessage('uci');
});

// Stockfish runs in a dedicated Web Worker so even a long search never blocks
// dragging pieces, clocks, or the rest of the interface.
export const findStockfishMove = async (fen: string, targetDepth: number, maximumThinkMs: number): Promise<string | null> => {
  const analysis = await analyzeStockfishPosition(fen, targetDepth, maximumThinkMs);
  return analysis.bestMove;
};
