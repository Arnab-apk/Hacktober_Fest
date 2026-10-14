/**
 * Gemini API Key Rotation Service
 * Manages multiple API keys to prevent exhaustion of free tier limits
 */

const KEY_ROTATION_STORAGE = 'gemini-key-rotation-state';
const KEY_USAGE_LIMIT = 25; // Requests per key before rotation (free-tier friendly)
const DAILY_USAGE_LIMIT = 120; // Total requests per browser per day

interface KeyRotationState {
  currentIndex: number;
  usageCounts: Record<number, number>;
  lastRotation: number;
  dailyCount: number;
  dailyWindowStart: number;
}

class GeminiKeyRotationService {
  private keys: string[] = [];
  private state: KeyRotationState;

  constructor() {
    // Load keys from environment variable
    const envKeys = import.meta.env.VITE_GEMINI_API_KEYS;
    if (envKeys) {
      this.keys = envKeys.split(',').map((k: string) => k.trim()).filter(Boolean);
    }

    // Load or initialize rotation state
    this.state = this.loadState();
    this.ensureDailyWindow();
  }

  private loadState(): KeyRotationState {
    try {
      const stored = localStorage.getItem(KEY_ROTATION_STORAGE);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to load key rotation state:', e);
    }

    return {
      currentIndex: 0,
      usageCounts: {},
      lastRotation: Date.now(),
      dailyCount: 0,
      dailyWindowStart: Date.now(),
    };
  }

  private ensureDailyWindow(): void {
    const start = new Date(this.state.dailyWindowStart || Date.now());
    const now = new Date();
    const sameUtcDay =
      start.getUTCFullYear() === now.getUTCFullYear() &&
      start.getUTCMonth() === now.getUTCMonth() &&
      start.getUTCDate() === now.getUTCDate();

    if (!sameUtcDay) {
      this.state.dailyCount = 0;
      this.state.dailyWindowStart = Date.now();
      this.state.usageCounts = {};
      this.state.currentIndex = 0;
      this.saveState();
    }
  }

  private saveState(): void {
    try {
      localStorage.setItem(KEY_ROTATION_STORAGE, JSON.stringify(this.state));
    } catch (e) {
      console.warn('Failed to save key rotation state:', e);
    }
  }

  /**
   * Get the current API key to use
   */
  getCurrentKey(): string | null {
    this.ensureDailyWindow();

    if (this.keys.length === 0) {
      return null;
    }

    if (this.state.dailyCount >= DAILY_USAGE_LIMIT) {
      return null;
    }

    // Check if current key has exceeded usage limit
    const currentUsage = this.state.usageCounts[this.state.currentIndex] || 0;
    if (currentUsage >= KEY_USAGE_LIMIT) {
      this.rotateToNextKey();
    }

    return this.keys[this.state.currentIndex];
  }

  /**
   * Record that a key was used
   */
  recordUsage(): void {
    this.ensureDailyWindow();
    const currentIndex = this.state.currentIndex;
    this.state.usageCounts[currentIndex] = (this.state.usageCounts[currentIndex] || 0) + 1;
    this.state.dailyCount += 1;
    this.saveState();
  }

  /**
   * Rotate to the next available key
   */
  private rotateToNextKey(): void {
    if (this.keys.length <= 1) {
      // Reset usage if only one key
      this.state.usageCounts[0] = 0;
      this.saveState();
      return;
    }

    // Find next key with lowest usage
    let nextIndex = (this.state.currentIndex + 1) % this.keys.length;
    let lowestUsage = this.state.usageCounts[nextIndex] || 0;

    for (let i = 0; i < this.keys.length; i++) {
      const usage = this.state.usageCounts[i] || 0;
      if (usage < lowestUsage) {
        nextIndex = i;
        lowestUsage = usage;
      }
    }

    this.state.currentIndex = nextIndex;
    this.state.lastRotation = Date.now();
    this.saveState();

    console.log(`🔄 Rotated to API key #${nextIndex + 1} (usage: ${lowestUsage})`);
  }

  /**
   * Get usage statistics for all keys
   */
  getUsageStats(): Array<{ keyIndex: number; usage: number; isCurrent: boolean }> {
    return this.keys.map((_, index) => ({
      keyIndex: index + 1,
      usage: this.state.usageCounts[index] || 0,
      isCurrent: index === this.state.currentIndex,
    }));
  }

  /**
   * Reset all usage counters (useful for daily/weekly resets)
   */
  resetUsage(): void {
    this.state.usageCounts = {};
    this.state.currentIndex = 0;
    this.state.dailyCount = 0;
    this.state.dailyWindowStart = Date.now();
    this.saveState();
    console.log('✅ API key usage counters reset');
  }

  /**
   * Check if keys are available
   */
  hasKeys(): boolean {
    return this.keys.length > 0;
  }

  hasAvailableQuota(): boolean {
    this.ensureDailyWindow();
    return this.state.dailyCount < DAILY_USAGE_LIMIT;
  }

  getDailyRemaining(): number {
    this.ensureDailyWindow();
    return Math.max(0, DAILY_USAGE_LIMIT - this.state.dailyCount);
  }

  /**
   * Get total number of keys
   */
  getKeyCount(): number {
    return this.keys.length;
  }

  /**
   * Manually set a specific key (for user-provided keys)
   */
  setCustomKey(key: string): void {
    // This will be used when user provides their own key
    // It takes precedence over environment keys
    this.keys = [key];
    this.state = {
      currentIndex: 0,
      usageCounts: {},
      lastRotation: Date.now(),
      dailyCount: 0,
      dailyWindowStart: Date.now(),
    };
    this.saveState();
  }
}

// Export singleton instance
export const geminiKeyRotation = new GeminiKeyRotationService();
