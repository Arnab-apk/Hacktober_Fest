/**
 * soundEffects — Professional sound feedback system.
 * Subtle audio cues for better UX (respects user preferences).
 */

class SoundEffects {
  private enabled: boolean = true;
  private volume: number = 0.3;

  constructor() {
    // Check user preference for reduced motion (also applies to sounds)
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.enabled = !prefersReducedMotion;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    localStorage.setItem('sound-effects-enabled', enabled.toString());
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  private play(frequency: number, duration: number, type: OscillatorType = 'sine') {
    if (!this.enabled) return;

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = type;

      gainNode.gain.setValueAtTime(this.volume, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + duration);
    } catch (error) {
      console.warn('Sound effects not supported:', error);
    }
  }

  // Success sound (pleasant upward tone)
  success() {
    this.play(523.25, 0.1); // C5
    setTimeout(() => this.play(659.25, 0.15), 50); // E5
  }

  // Error sound (gentle downward tone)
  error() {
    this.play(392, 0.1); // G4
    setTimeout(() => this.play(329.63, 0.15), 50); // E4
  }

  // Notification sound (subtle beep)
  notification() {
    this.play(880, 0.08, 'sine'); // A5
  }

  // Click sound (very subtle)
  click() {
    this.play(1000, 0.03, 'square');
  }

  // Message received (friendly tone)
  messageReceived() {
    this.play(659.25, 0.08); // E5
    setTimeout(() => this.play(783.99, 0.1), 40); // G5
  }

  // User joined (welcoming tone)
  userJoined() {
    this.play(523.25, 0.08); // C5
    setTimeout(() => this.play(659.25, 0.08), 40); // E5
    setTimeout(() => this.play(783.99, 0.12), 80); // G5
  }

  // User left (gentle farewell)
  userLeft() {
    this.play(783.99, 0.08); // G5
    setTimeout(() => this.play(659.25, 0.12), 40); // E5
  }
}

export const soundEffects = new SoundEffects();
