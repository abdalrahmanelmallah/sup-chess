import React, { useState } from 'react';
import { ArrowRight, Crown, Lock, Sparkles, User } from 'lucide-react';
import axios from 'axios';
import { apiUrl } from '../api';

const levels = [
  { key: 'beginner', label: 'Beginner', elo: 400, copy: 'Learning the board' },
  { key: 'intermediate', label: 'Intermediate', elo: 700, copy: 'Ready to compete' },
  { key: 'professional', label: 'Professional', elo: 1200, copy: 'Tournament-ready' }
];

const Auth = ({ onAuthSuccess, onPlayAsGuest }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [skillLevel, setSkillLevel] = useState('beginner');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const endpoint = isLogin ? 'login' : 'register';
      const response = await axios.post(apiUrl(`/api/${endpoint}`), {
        username,
        password,
        ...(isLogin ? {} : { skillLevel })
      });
      localStorage.setItem('sup_token', response.data.token);
      localStorage.setItem('sup_user', JSON.stringify(response.data.user));
      onAuthSuccess(response.data.user);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not connect to the arena. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="brand-mark"><Crown size={27} /></div>
        <p className="eyebrow">SUP Chess</p>
        <h1>Play with a<br /><em>purpose.</em></h1>
        <p className="auth-copy">Build a real rating, find players at your pace, and keep every game in your story.</p>
        <div className="auth-points">
          <span><Sparkles size={16} /> Dark-first arena</span>
          <span><Sparkles size={16} /> Rated online games</span>
          <span><Sparkles size={16} /> Private bot practice</span>
        </div>
      </section>

      <section className="auth-panel" aria-label={isLogin ? 'Sign in' : 'Create account'}>
        <div className="auth-panel-heading">
          <p className="eyebrow">{isLogin ? 'Welcome back' : 'Your chess identity'}</p>
          <h2>{isLogin ? 'Sign in to the arena' : 'Create your account'}</h2>
          <p>{isLogin ? 'Pick up where you left off.' : 'Choose where your rated journey begins.'}</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            <span>Username <small>Shown to opponents</small></span>
            <div className="input-wrap"><User size={18} /><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your chess name" autoComplete="username" required /></div>
          </label>
          <label>
            <span>Password</span>
            <div className="input-wrap"><Lock size={18} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" autoComplete={isLogin ? 'current-password' : 'new-password'} required /></div>
          </label>

          {!isLogin && <fieldset className="level-picker">
            <legend>How would you describe your chess?</legend>
            <div className="level-options">
              {levels.map((level) => <button type="button" key={level.key} onClick={() => setSkillLevel(level.key)} className={skillLevel === level.key ? 'selected' : ''}>
                <strong>{level.label}</strong><span>{level.copy}</span><b>{level.elo} Elo</b>
              </button>)}
            </div>
          </fieldset>}

          {error && <p className="form-error">{error}</p>}
          <button className="primary-button auth-submit" disabled={isLoading} type="submit">
            {isLoading ? 'Please wait…' : isLogin ? 'Enter arena' : 'Create account'} <ArrowRight size={18} />
          </button>
        </form>

        <div className="auth-links">
          <button type="button" onClick={() => { setIsLogin(!isLogin); setError(''); }}>{isLogin ? 'New to SUP? Create an account' : 'Already have an account? Sign in'}</button>
          <button type="button" className="guest-link" onClick={onPlayAsGuest}>Continue as guest — bot games only</button>
        </div>
      </section>
    </main>
  );
};

export default Auth;
