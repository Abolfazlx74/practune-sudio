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

  public playMetronomeClick(accent: 'downbeat' | 'secondary' | 'normal' = 'normal') {
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Acoustic woodblock resonant cavity frequencies (fundamental + hollow wooden overtone)
    const f1 = accent === 'downbeat' ? 1140 : accent === 'secondary' ? 920 : 810;
    const f2 = f1 * 1.56;
    const peakGain = accent === 'downbeat' ? 0.38 : accent === 'secondary' ? 0.26 : 0.22;

    const oscBody = this.ctx.createOscillator();
    const oscOvertone = this.ctx.createOscillator();
    const bodyGain = this.ctx.createGain();
    const overtoneGain = this.ctx.createGain();
    const woodFilter = this.ctx.createBiquadFilter();

    oscBody.type = 'sine';
    oscBody.frequency.setValueAtTime(f1 * 1.06, now);
    oscBody.frequency.exponentialRampToValueAtTime(f1, now + 0.008);

    oscOvertone.type = 'triangle';
    oscOvertone.frequency.setValueAtTime(f2 * 1.05, now);
    oscOvertone.frequency.exponentialRampToValueAtTime(f2, now + 0.006);

    woodFilter.type = 'bandpass';
    woodFilter.frequency.setValueAtTime(f1 * 1.25, now);
    woodFilter.Q.setValueAtTime(2.2, now);

    // Tight percussive wood envelope (~42ms)
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.linearRampToValueAtTime(peakGain, now + 0.002);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.044);

    overtoneGain.gain.setValueAtTime(0.0001, now);
    overtoneGain.gain.linearRampToValueAtTime(peakGain * 0.45, now + 0.0015);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);

    oscBody.connect(woodFilter);
    oscOvertone.connect(overtoneGain);
    overtoneGain.connect(woodFilter);
    woodFilter.connect(bodyGain);
    bodyGain.connect(this.ctx.destination);

    // Short wooden mallet strike transient
    const clickLen = Math.floor(this.ctx.sampleRate * 0.01);
    const clickBuf = this.ctx.createBuffer(1, clickLen, this.ctx.sampleRate);
    const chData = clickBuf.getChannelData(0);
    for (let i = 0; i < clickLen; i++) {
      chData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (clickLen * 0.25));
    }
    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = clickBuf;

    const malletFilter = this.ctx.createBiquadFilter();
    malletFilter.type = 'bandpass';
    malletFilter.frequency.setValueAtTime(2400, now);
    malletFilter.Q.setValueAtTime(3.0, now);

    const malletGain = this.ctx.createGain();
    malletGain.gain.setValueAtTime(peakGain * 0.55, now);
    malletGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.01);

    noiseSrc.connect(malletFilter);
    malletFilter.connect(malletGain);
    malletGain.connect(this.ctx.destination);

    oscBody.start(now);
    oscOvertone.start(now);
    noiseSrc.start(now);

    oscBody.stop(now + 0.05);
    oscOvertone.stop(now + 0.03);
  }
}

export const synth = new WebAudioSynth();