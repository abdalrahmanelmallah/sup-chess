import React, { useEffect, useState } from 'react';
import { Bot, Clock3, Crown, EyeOff, LogOut, Search, Settings, ShieldQuestion, Shuffle, SlidersHorizontal, Sun, Swords, Trophy, UserRound, Users, Volume2, Zap } from 'lucide-react';
import ChessGame from './ChessGame';
import GameAnalysis from './GameAnalysis';
import { apiUrl } from '../api';

const controls = [
  { group: 'Bullet', items: [['bullet-1', '1:00'], ['bullet-1-1', '1:00 + 1'], ['bullet-2', '2:00']] },
  { group: 'Blitz', items: [['blitz-3', '3:00'], ['blitz-3-2', '3:00 + 2'], ['blitz-5', '5:00']] },
  { group: 'Rapid', items: [['rapid-10', '10:00'], ['rapid-10-5', '10:00 + 5'], ['rapid-15', '15:00']] }
];
const bots = [
  { key: 'rookie', name: 'Milo', title: 'The Starter', rating: 420 },
  { key: 'scout', name: 'Nora', title: 'The Scout', rating: 720 },
  { key: 'ember', name: 'Kai', title: 'The Tactician', rating: 1050 },
  { key: 'sable', name: 'Sable', title: 'The Strategist', rating: 1450 },
  { key: 'orion', name: 'Orion', title: 'The Master', rating: 1900 },
  { key: 'astra', name: 'Astra', title: 'Grandmaster engine', rating: 2600, elite: true }
];
const api = (path, options = {}) => fetch(apiUrl(path), { ...options, headers: { Authorization: `Bearer ${localStorage.getItem('sup_token')}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });

const Avatar = ({ user, size = 'normal' }) => user?.avatar
  ? <img className={`avatar ${size}`} src={user.avatar} alt="" />
  : <span className={`avatar ${size} avatar-fallback`}>{user?.username?.slice(0, 1)?.toUpperCase() || '?'}</span>;

const BotAvatar = ({ bot, compact = false }) => <span className={`bot-character bot-character-${bot.key} ${compact ? 'compact' : ''}`} aria-hidden="true"><i /><b /><b /></span>;

const EloTrend = ({ games, user }) => {
  if (!games.length) return <div className="elo-empty">Your rating journey appears after your first online game.</div>;
  let rating = user.rating || 0;
  const points = [{ rating, label: 'Now' }];
  games.slice(0, 12).forEach((game, index) => {
    const me = game.players.find((player) => player.id === user.id);
    rating -= game.ratingChanges?.[me?.color] || 0;
    points.push({ rating, label: `Game ${games.length - index}` });
  });
  points.reverse();
  const min = Math.min(...points.map((point) => point.rating)) - 8;
  const max = Math.max(...points.map((point) => point.rating)) + 8;
  const spread = Math.max(1, max - min);
  const coordinates = points.map((point, index) => `${(index / Math.max(1, points.length - 1)) * 100},${88 - ((point.rating - min) / spread) * 76}`).join(' ');
  return <div className="elo-trend" aria-label="Your Elo rating graph"><div className="elo-trend-heading"><span>Rating trend</span><b>{points.at(-1)?.rating} Elo</b></div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline className="elo-area" points={`0,100 ${coordinates} 100,100`} /><polyline className="elo-line" points={coordinates} /></svg><small>Last {points.length - 1} rated games</small></div>;
};

const Lobby = ({ user, settings, onSettingsChange, onUserChange, onLogout }) => {
  const [view, setView] = useState('home');
  const [gameMode, setGameMode] = useState(null);
  const [botDifficulty, setBotDifficulty] = useState('rookie');
  const [botColor, setBotColor] = useState('white');
  const [timeControl, setTimeControl] = useState('blitz-3');
  const [games, setGames] = useState([]);
  const [friends, setFriends] = useState({ friends: [], requests: [] });
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [notice, setNotice] = useState('');
  const [hiddenPawnFile, setHiddenPawnFile] = useState('e');
  const [hiddenPawnSetup, setHiddenPawnSetup] = useState(false);
  const [analysisGame, setAnalysisGame] = useState(null);

  const refreshProfileData = async () => {
    if (user.isGuest) return;
    const [gameResponse, friendResponse] = await Promise.all([api('/api/games'), api('/api/friends')]);
    if (gameResponse.ok) setGames(await gameResponse.json());
    if (friendResponse.ok) setFriends(await friendResponse.json());
  };

  useEffect(() => { if (view === 'profile') refreshProfileData(); }, [view]);
  useEffect(() => {
    if (search.trim().length < 2 || user.isGuest) { setResults([]); return; }
    const timer = window.setTimeout(async () => {
      const response = await api(`/api/users?query=${encodeURIComponent(search)}`);
      if (response.ok) setResults(await response.json());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const openGame = (mode) => {
    if (mode === 'hidden-pawn') { setHiddenPawnSetup(true); return; }
    setGameMode(mode); setView('game');
  };
  const startHiddenPawn = () => { setGameMode('hidden-pawn'); setHiddenPawnSetup(false); setView('game'); };
  const updatePhoto = (file) => {
    if (!file || user.isGuest) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const response = await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ avatar: reader.result }) });
      const updated = await response.json();
      if (response.ok) { onUserChange(updated); setNotice('Photo updated.'); }
      else setNotice(updated.error);
    };
    reader.readAsDataURL(file);
  };
  const requestFriend = async (id) => {
    const response = await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId: id }) });
    setNotice(response.ok ? 'Friend request sent.' : (await response.json()).error);
    setResults([]); setSearch('');
  };
  const acceptFriend = async (id) => {
    await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: id }) });
    refreshProfileData();
  };

  const selectedBot = bots.find((bot) => bot.key === botDifficulty) || bots[0];
  if (view === 'game') return <ChessGame gameMode={gameMode} hiddenPawnFile={hiddenPawnFile} botDifficulty={botDifficulty} botColor={botColor} bot={selectedBot} timeControl={timeControl} user={user} onUserChange={onUserChange} settings={settings} onBack={() => setView('home')} />;
  if (analysisGame) return <GameAnalysis game={analysisGame} settings={settings} onBack={() => { setAnalysisGame(null); setView('profile'); }} />;

  const wins = user.wins || 0;
  const played = wins + (user.losses || 0) + (user.draws || 0);
  return <main className="arena-shell">
    <header className="topbar">
      <button className="wordmark" onClick={() => setView('home')}><Crown size={21} /> SUP <span>CHESS</span></button>
      <nav>
        <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}>Play</button>
        {!user.isGuest && <button className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}>Profile</button>}
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>Settings</button>
      </nav>
      <div className="account-menu">
        <button className="identity" onClick={() => !user.isGuest && setView('profile')}><Avatar user={user} size="small" /><span>{user.username}<b>{user.isGuest ? 'Guest' : `${user.rating} Elo`}</b></span></button>
        <button aria-label="Log out" className="icon-button" onClick={onLogout}><LogOut size={18} /></button>
      </div>
    </header>

    {view === 'home' && <section className="arena-content">
      <div className="hero-row">
        <div><p className="eyebrow">{user.isGuest ? 'Guest practice' : 'Rated chess, made personal'}</p><h1>Choose your<br /><em>next game.</em></h1><p>Online matches pair players only with the exact same time control. Bot games are always unrated.</p></div>
        <div className="rating-card"><span>Current rating</span><strong>{user.isGuest ? '—' : user.rating}</strong><small>{user.isGuest ? 'Guests play bots only' : `${wins} wins · ${played} games`}</small></div>
      </div>

      <div className="play-grid">
        <section className={`mode-card online-card ${user.isGuest ? 'locked' : ''}`}>
          <div className="mode-icon blue"><Zap size={26} /></div><p className="eyebrow">Rated play</p><h2>Play online</h2><p>Win or lose 8, 9, or 11 Elo based on the matchup. Every result is saved.</p>
          {user.isGuest ? <div className="guest-notice">Sign in or create an account to play rated online.</div> : <>
            <div className="time-controls">{controls.map((control) => <div className="control-group" key={control.group}><span>{control.group}</span><div>{control.items.map(([key, label]) => <button key={key} onClick={() => setTimeControl(key)} className={timeControl === key ? 'selected' : ''}>{label}</button>)}</div></div>)}</div>
            <button className="primary-button" onClick={() => openGame('online')}>Find {controls.flatMap((group) => group.items).find(([key]) => key === timeControl)?.[1]} game <Clock3 size={18} /></button>
          </>}
        </section>
        <section className="mode-card bot-card">
          <div className="mode-icon gold"><Bot size={26} /></div><p className="eyebrow">Practice room</p><h2>Challenge a bot</h2><p>Choose an opponent at your level. Practice games never affect your Elo.</p>
          <div className="bot-roster">{bots.map((bot) => <button key={bot.key} onClick={() => setBotDifficulty(bot.key)} className={`bot-choice ${botDifficulty === bot.key ? 'selected' : ''} ${bot.elite ? 'elite' : ''}`}><BotAvatar bot={bot} /><span><strong>{bot.name}{bot.elite && <i>ELITE</i>}</strong><small>{bot.title}</small></span><b>{bot.rating}<em>Elo</em></b></button>)}</div>
          <div className="bot-side-picker" role="group" aria-label="Choose your color"><span>Your side</span><div><button className={botColor === 'white' ? 'selected' : ''} onClick={() => setBotColor('white')}>White</button><button className={botColor === 'black' ? 'selected' : ''} onClick={() => setBotColor('black')}>Black</button></div></div>
          <button className="secondary-button" onClick={() => openGame('bot')}>Play {selectedBot.name} as {botColor === 'white' ? 'White' : 'Black'} <Bot size={18} /></button>
        </section>
      </div>
      <section className="variant-heading"><div><p className="eyebrow">Different rules, same rating</p><h2>Chess variants</h2></div><span>Online matchmaking</span></section>
      <div className="variant-grid">
      <section className={`variant-card hidden-variant ${user.isGuest ? 'locked' : ''}`}>
        <div className="variant-icon"><EyeOff size={25} /></div><div><p className="eyebrow">Online variant · 5:00</p><h2>Hidden Pawn</h2><p>Secretly choose one pawn file. It moves normally until you unleash a queen move — then the hidden pawn reveals itself to both players. Always 5 minutes.</p></div>
        {user.isGuest ? <div className="guest-notice">Create an account to enter Hidden Pawn matchmaking.</div> : <button className="variant-button" onClick={() => openGame('hidden-pawn')}>Enter variant <ShieldQuestion size={18} /></button>}
      </section>
      <section className={`variant-card chess960-variant ${user.isGuest ? 'locked' : ''}`}>
        <div className="variant-icon"><Shuffle size={25} /></div><div><p className="eyebrow">Online variant · choose time</p><h2>Chess960</h2><p>A fresh randomized back rank each game. Bishops begin on opposite colors and the king begins between the rooks, so castling still finishes in its familiar squares.</p></div>
        {user.isGuest ? <div className="guest-notice">Create an account to play Chess960 online.</div> : <button className="variant-button" onClick={() => openGame('chess960')}>Play 960 <Shuffle size={18} /></button>}
      </section>
      <section className={`variant-card knightfall-variant ${user.isGuest ? 'locked' : ''}`}>
        <div className="variant-icon"><Swords size={25} /></div><div><p className="eyebrow">SUP original · choose time</p><h2>Knightfall</h2><p>Every bishop is replaced by a knight. Start with four knights, discover unusual attacks, and use standard chess rules for everything else.</p></div>
        {user.isGuest ? <div className="guest-notice">Create an account to play Knightfall online.</div> : <button className="variant-button" onClick={() => openGame('knightfall')}>Enter variant <Swords size={18} /></button>}
      </section>
      </div>
    </section>}

    {view === 'profile' && <section className="profile-page">
      <div className="page-heading"><p className="eyebrow">Your chess identity</p><h1>Profile</h1><p>Manage how opponents see you, revisit your games, and connect with players.</p></div>
      <div className="profile-grid">
        <section className="surface profile-card"><div className="profile-photo"><Avatar user={user} size="large" /><label className="photo-button">Change photo<input type="file" accept="image/*" onChange={(event) => updatePhoto(event.target.files?.[0])} /></label></div><label className="field-label">Username<input value={user.username} readOnly aria-readonly="true" /></label><p className="username-lock">Your username is permanent after account creation.</p><div className="profile-rating"><Trophy size={18} /><strong>{user.rating} Elo</strong><span>{user.skillLevel}</span></div><EloTrend games={games} user={user} />{notice && <p className="inline-notice">{notice}</p>}</section>
        <section className="surface history-card"><div className="section-title"><div><p className="eyebrow">Last 30</p><h2>Game history</h2></div><span>{played} total</span></div>{games.length ? <div className="game-list">{games.map((game) => { const me = game.players.find((player) => player.id === user.id); const opponent = game.players.find((player) => player.id !== user.id); const outcome = game.result === 'draw' ? 'Draw' : game.result === me?.color ? 'Win' : 'Loss'; const variantName = game.variant === 'hidden-pawn' ? 'Hidden Pawn' : game.variant === 'chess960' ? 'Chess960' : game.variant === 'knightfall' ? 'Knightfall' : 'Standard'; return <div className="history-game" key={game.id}><div><strong>{outcome}</strong><span>vs {opponent?.username || 'Opponent'} · {variantName} · {game.timeControl?.label}</span></div><div className="history-actions"><b className={outcome.toLowerCase()}>{game.ratingChanges?.[me?.color] > 0 ? '+' : ''}{game.ratingChanges?.[me?.color] || 0}</b><button onClick={() => setAnalysisGame(game)}>Analyze</button></div></div>; })}</div> : <div className="empty-state">Your completed online games will appear here.</div>}</section>
        <section className="surface friends-card"><div className="section-title"><div><p className="eyebrow">Community</p><h2>Friends</h2></div><Users size={20} /></div><div className="friend-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a player" /></div>{results.map((result) => <div className="friend-row" key={result.id}><span><Avatar user={result} size="small" /><b>{result.username}<small>{result.rating} Elo</small></b></span><button onClick={() => requestFriend(result.id)} disabled={result.friendship !== 'none'}>{result.friendship === 'friends' ? 'Friends' : result.friendship === 'requested' ? 'Sent' : 'Add'}</button></div>)}{friends.requests.map((request) => <div className="friend-row request" key={request.id}><span><Avatar user={request} size="small" /><b>{request.username}<small>Wants to be friends</small></b></span><button onClick={() => acceptFriend(request.id)}>Accept</button></div>)}{friends.friends.map((friend) => <div className="friend-row" key={friend.id}><span><Avatar user={friend} size="small" /><b>{friend.username}<small>{friend.rating} Elo</small></b></span><span className="friend-status">Friends</span></div>)}{!friends.friends.length && !friends.requests.length && <div className="empty-state">Search for a player to add your first friend.</div>}</section>
      </div>
    </section>}

    {view === 'settings' && <section className="settings-page">
      <div className="page-heading"><p className="eyebrow">Make it yours</p><h1>Settings</h1><p>Preferences are saved automatically on this device.</p></div>
      <div className="settings-grid">
        <section className="surface setting-panel"><div className="setting-icon"><Sun size={20} /></div><div><h2>Appearance</h2><p>Set the arena to match your space and your device.</p><div className="segmented"><button className={settings.theme === 'dark' ? 'selected' : ''} onClick={() => onSettingsChange({ ...settings, theme: 'dark' })}>Dark</button><button className={settings.theme === 'light' ? 'selected' : ''} onClick={() => onSettingsChange({ ...settings, theme: 'light' })}>Light</button><button className={settings.theme === 'system' ? 'selected' : ''} onClick={() => onSettingsChange({ ...settings, theme: 'system' })}>Device</button></div></div></section>
        <section className="surface setting-panel"><div className="setting-icon"><Settings size={20} /></div><div><h2>Board colors</h2><p>Change the board palette without changing the pieces or rules.</p><div className="segmented"><button className={settings.board === 'midnight' ? 'selected' : ''} onClick={() => onSettingsChange({ ...settings, board: 'midnight' })}>Midnight</button><button className={settings.board === 'classic' ? 'selected' : ''} onClick={() => onSettingsChange({ ...settings, board: 'classic' })}>Classic</button><button className={settings.board === 'forest' ? 'selected' : ''} onClick={() => onSettingsChange({ ...settings, board: 'forest' })}>Forest</button></div></div></section>
        <section className="surface setting-panel"><div className="setting-icon"><UserRound size={20} /></div><div><h2>Board view</h2><p>Auto rotates you to your playing color. You can also keep one fixed view.</p><div className="segmented"><button className={settings.orientation === 'auto' ? 'selected' : ''} onClick={() => onSettingsChange({ ...settings, orientation: 'auto' })}>Auto</button><button className={settings.orientation === 'white' ? 'selected' : ''} onClick={() => onSettingsChange({ ...settings, orientation: 'white' })}>White side</button><button className={settings.orientation === 'black' ? 'selected' : ''} onClick={() => onSettingsChange({ ...settings, orientation: 'black' })}>Black side</button></div></div></section>
        <section className="surface setting-panel setting-wide"><div className="setting-icon"><Zap size={20} /></div><div className="preference-list"><div><h2>Game preferences</h2><p>These options only change how your games feel; they never affect rating or matchmaking.</p></div><div className="preference-row"><div><strong>Board coordinates</strong><span>Show rank and file labels around the board.</span></div><button className={`toggle ${settings.boardLabels ? 'on' : ''}`} aria-pressed={settings.boardLabels} onClick={() => onSettingsChange({ ...settings, boardLabels: !settings.boardLabels })}><i /></button></div><div className="preference-row"><div><strong>Move animation</strong><span>Use a subtle motion when pieces move.</span></div><button className={`toggle ${settings.moveAnimation ? 'on' : ''}`} aria-pressed={settings.moveAnimation} onClick={() => onSettingsChange({ ...settings, moveAnimation: !settings.moveAnimation })}><i /></button></div><div className="preference-row"><div><strong>Premoves</strong><span>Queue a legal move while it is your opponent’s turn.</span></div><button className={`toggle ${settings.premoves ? 'on' : ''}`} aria-pressed={settings.premoves} onClick={() => onSettingsChange({ ...settings, premoves: !settings.premoves })}><i /></button></div><div className="preference-row"><div><strong>Low-time alert</strong><span>Highlight a clock with 15 seconds or less remaining.</span></div><button className={`toggle ${settings.clockWarning ? 'on' : ''}`} aria-pressed={settings.clockWarning} onClick={() => onSettingsChange({ ...settings, clockWarning: !settings.clockWarning })}><i /></button></div></div></section>
        <section className="surface setting-panel setting-wide"><div className="setting-icon"><Volume2 size={20} /></div><div className="preference-list"><div><h2>Sound & alerts</h2><p>Responsive, generated chess sounds with no download or account needed.</p></div><div className="preference-row"><div><strong>Game sounds</strong><span>Moves, captures, matchmaking, offers, results, and clock alerts.</span></div><button className={`toggle ${settings.soundEnabled ? 'on' : ''}`} aria-label="Toggle game sounds" aria-pressed={settings.soundEnabled} onClick={() => onSettingsChange({ ...settings, soundEnabled: !settings.soundEnabled })}><i /></button></div><div className="preference-row"><div><strong>Sound profile</strong><span>Choose a crisp classic tone or a quieter, softer tone.</span></div><div className="segmented"><button className={settings.soundStyle === 'classic' ? 'selected' : ''} onClick={() => onSettingsChange({ ...settings, soundStyle: 'classic' })}>Classic</button><button className={settings.soundStyle === 'soft' ? 'selected' : ''} onClick={() => onSettingsChange({ ...settings, soundStyle: 'soft' })}>Soft</button></div></div><div className="preference-row range-row"><div><strong>Volume</strong><span>{settings.soundVolume}%</span></div><input aria-label="Sound volume" type="range" min="0" max="100" value={settings.soundVolume} onChange={(event) => onSettingsChange({ ...settings, soundVolume: Number(event.target.value) })} /></div></div></section>
        <section className="surface setting-panel setting-wide"><div className="setting-icon"><SlidersHorizontal size={20} /></div><div className="preference-list"><div><h2>Play controls</h2><p>These controls keep fast games feeling deliberate, on desktop and phone.</p></div><div className="preference-row"><div><strong>Multiple premoves</strong><span>Queue several moves in advance while your opponent is thinking.</span></div><button className={`toggle ${settings.premoves ? 'on' : ''}`} aria-label="Toggle premoves" aria-pressed={settings.premoves} onClick={() => onSettingsChange({ ...settings, premoves: !settings.premoves })}><i /></button></div><div className="preference-row"><div><strong>Queue length</strong><span>Each premove is played only if it remains legal.</span></div><div className="segmented">{[1, 3, 5, 10].map((count) => <button key={count} className={settings.premoveLimit === count ? 'selected' : ''} onClick={() => onSettingsChange({ ...settings, premoveLimit: count })}>{count}</button>)}</div></div><div className="preference-row"><div><strong>Move highlights</strong><span>Show selected pieces and queued premoves on the board.</span></div><button className={`toggle ${settings.moveHighlights ? 'on' : ''}`} aria-pressed={settings.moveHighlights} onClick={() => onSettingsChange({ ...settings, moveHighlights: !settings.moveHighlights })}><i /></button></div><div className="preference-row"><div><strong>Reduced motion</strong><span>Turn off board motion for a calmer, more accessible experience.</span></div><button className={`toggle ${settings.reducedMotion ? 'on' : ''}`} aria-pressed={settings.reducedMotion} onClick={() => onSettingsChange({ ...settings, reducedMotion: !settings.reducedMotion })}><i /></button></div><div className="preference-row"><div><strong>Confirm resignation</strong><span>Show one final confirmation before resigning a rated game.</span></div><button className={`toggle ${settings.confirmResign ? 'on' : ''}`} aria-pressed={settings.confirmResign} onClick={() => onSettingsChange({ ...settings, confirmResign: !settings.confirmResign })}><i /></button></div></div></section>
      </div>
      <button className="reset-settings" onClick={() => onSettingsChange({ theme: 'dark', board: 'midnight', orientation: 'auto', boardLabels: true, moveAnimation: true, premoves: true, premoveLimit: 5, clockWarning: true, soundEnabled: true, soundVolume: 65, soundStyle: 'classic', moveHighlights: true, reducedMotion: false, confirmResign: true })}>Restore default settings</button>
    </section>}
    {hiddenPawnSetup && <div className="dialog-backdrop"><section className="confirm-dialog variant-dialog" role="dialog" aria-modal="true" aria-labelledby="hidden-pawn-title"><div className="dialog-icon"><EyeOff size={22} /></div><p className="eyebrow">Secret selection</p><h2 id="hidden-pawn-title">Choose your hidden pawn</h2><p>Pick a file now. You will play the pawn on that file, and your opponent will not see the choice unless you reveal it with a queen move.</p><div className="pawn-file-picker">{'abcdefgh'.split('').map((file) => <button key={file} className={hiddenPawnFile === file ? 'selected' : ''} onClick={() => setHiddenPawnFile(file)}>{file}</button>)}</div><small>You chose the {hiddenPawnFile}-file pawn.</small><div><button className="dialog-cancel" onClick={() => setHiddenPawnSetup(false)}>Cancel</button><button className="primary-button" onClick={startHiddenPawn}>Confirm & find game</button></div></section></div>}
  </main>;
};

export default Lobby;
