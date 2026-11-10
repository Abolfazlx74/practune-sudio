class WebAudioSynth {
  private ctx: AudioContext | null = null;

  private init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public playMidiNote(midi: number, duration = 0.4, velocity = 0.8) {
    this.init();
    if (!this.ctx) return;

    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    this.playTone(freq, duration, velocity);
  }

  public playTone(freq: number, duration = 0.4, velocity = 0.8) {
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    // Dual oscillator: saw + sine for warm acoustic instrument tone
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, now);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, now); // 1st overtone

    // Lowpass filter for warm tone
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(freq * 3.5, 4500), now);

    // ADSR Envelope
    const attack = 0.03;
    const decay = 0.1;
    const sustain = velocity * 0.4;
    const release = 0.08;

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(velocity * 0.5, now + attack);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.001), now + attack + decay);

    const stopTime = now + duration;
    gainNode.gain.setValueAtTime(Math.max(sustain, 0.001), stopTime);
    gainNode.gain.exponentialRampToValueAtTime(0.00001, stopTime + release);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(stopTime + release);
    osc2.stop(stopTime + release);
  }
}

export const synth = new WebAudioSynth();
