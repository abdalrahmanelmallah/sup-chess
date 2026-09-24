type SoundName = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'premove' | 'start' | 'join' | 'resign' | 'draw' | 'gameOver' | 'notify' | 'lowTime';

type AudioSettings = {
  soundEnabled?: boolean;
  soundVolume?: number;
  soundStyle?: 'classic' | 'soft';
};

let context: AudioContext | null = null;
let lastLowTimeAt = 0;

const tones: Record<SoundName, [number, number, number][]> = {
  move: [[440, 0.045, 0], [554, 0.06, 0.035]],
  capture: [[180, 0.06, 0], [120, 0.09, 0.045]],
  check: [[622, 0.06, 0], [784, 0.07, 0.055], [1_046, 0.16, 0.11]],
  castle: [[392, 0.05, 0], [523, 0.07, 0.04]],
  promote: [[523, 0.05, 0], [659, 0.06, 0.045], [784, 0.13, 0.09]],
  premove: [[740, 0.045, 0], [880, 0.05, 0.035]],
  start: [[392, 0.08, 0], [523, 0.08, 0.08], [784, 0.13, 0.16]],
  join: [[523, 0.07, 0], [659, 0.07, 0.06], [784, 0.11, 0.12]],
  resign: [[330, 0.1, 0], [247, 0.13, 0.08]],
  draw: [[440, 0.09, 0], [440, 0.09, 0.08]],
  gameOver: [[523, 0.1, 0], [659, 0.1, 0.09], [784, 0.18, 0.18]],
  notify: [[660, 0.06, 0]],
  lowTime: [[880, 0.04, 0]]
};

export function playSound(name: SoundName, settings: AudioSettings = {}) {
  if (!settings.soundEnabled || typeof window === 'undefined') return;
  if (name === 'lowTime' && Date.now() - lastLowTimeAt < 1300) return;
  if (name === 'lowTime') lastLowTimeAt = Date.now();

  try {
    context ||= new AudioContext();
    const now = context.currentTime;
    const volume = Math.max(0, Math.min(1, (settings.soundVolume ?? 65) / 100)) * (settings.soundStyle === 'soft' ? 0.45 : 0.72);
    tones[name].forEach(([frequency, duration, offset]) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = settings.soundStyle === 'soft' ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + offset + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + duration + 0.02);
    });
  } catch {
    // Audio is optional; browsers may block it before a user interaction.
  }
}
