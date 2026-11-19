export interface LivePitchData {
  time: number;
  frequency: number;
  midi: number;
  noteName: string;
  centsDeviation: number;
  confidence: number;
  rms: number;
  isVoiced: boolean;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function isValidInstrumentalNoteOnset(data: LivePitchData, noiseFloor = 0.012): boolean {
  return data.isVoiced && data.rms >= noiseFloor && data.confidence >= 0.50 && data.frequency >= 55;
}

export function midiToNote(midi: number): { noteName: string; octave: number; cents: number } {
  const rounded = Math.round(midi);
  // FL Studio standard: MIDI 60 is C5, MIDI 69 is A5 (440Hz), MIDI 70 is A#5
  const octave = Math.floor(rounded / 12);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const cents = (midi - rounded) * 100;
  return { noteName: `${name}${octave}`, octave, cents: Math.round(cents) };
}

export class MicPitchTracker {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private animFrameId: number | null = null;
  private startTime = 0;
  private isTracking = false;
  private history: LivePitchData[] = [];
  private onPitchCallback: ((data: LivePitchData) => void) | null = null;
  private recentMidis: number[] = [];

  public async start(onPitch: (data: LivePitchData) => void): Promise<void> {
    this.stop();
    this.history = [];
    this.recentMidis = [];
    this.onPitchCallback = onPitch;

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.0; // Hard real-time without artificial delay
    source.connect(this.analyser);

    this.startTime = performance.now() / 1000;
    this.isTracking = true;
    this.loop();
  }

  public stop(): void {
    this.isTracking = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }

  public getHistory(): LivePitchData[] {
    return this.history;
  }

  private loop = () => {
    if (!this.isTracking || !this.analyser || !this.audioCtx) return;

    const buffer = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buffer);

    // Calculate RMS for Voice Activity Detection
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    const nowTime = performance.now() / 1000 - this.startTime;

    // YIN Pitch Detection
    const sampleRate = this.audioCtx.sampleRate;
    let { freq, confidence } = this.yinDetect(buffer, sampleRate);

    // Dynamic voiced gate: sensitive for delicate acoustic instruments (rms > 0.004) while rejecting background hum/hiss
    const isVoiced = (
      ((rms > 0.004 && confidence > 0.55) || (rms > 0.007 && confidence > 0.44)) &&
      freq >= 55 && freq <= 2200
    );

    let midi = 0;
    let noteName = '--';
    let cents = 0;

    if (isVoiced) {
      const rawMidi = 69 + 12 * Math.log2(freq / 440);
      this.recentMidis.push(rawMidi);
      if (this.recentMidis.length > 3) {
        this.recentMidis.shift();
      }
      // 3-frame rolling median to eliminate 1-frame transient spikes and octave hops
      const sorted = [...this.recentMidis].sort((a, b) => a - b);
      midi = sorted[Math.floor(sorted.length / 2)];
      freq = 440 * Math.pow(2, (midi - 69) / 12);

      const noteInfo = midiToNote(midi);
      noteName = noteInfo.noteName;
      cents = noteInfo.cents;
    } else {
      this.recentMidis = [];
    }

    const pitchData: LivePitchData = {
      time: Math.round(nowTime * 1000) / 1000,
      frequency: Math.round(freq * 10) / 10,
      midi: Math.round(midi * 100) / 100,
      noteName,
      centsDeviation: cents,
      confidence: Math.round(confidence * 100) / 100,
      rms: Math.round(rms * 1000) / 1000,
      isVoiced,
    };

    if (isVoiced) {
      this.history.push(pitchData);
    }

    if (this.onPitchCallback) {
      this.onPitchCallback(pitchData);
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  private yinDetect(buffer: Float32Array, sampleRate: number): { freq: number; confidence: number } {
    const threshold = 0.15;
    const minTau = Math.floor(sampleRate / 2200); // ~2200 Hz max (covers C7 / full instrument registers)
    const maxTau = Math.floor(sampleRate / 60);   // ~60 Hz min (covers B1 / C2)
    const halfLen = Math.floor(buffer.length / 2);

    if (maxTau >= halfLen) {
      return { freq: 0, confidence: 0 };
    }

    // 1. Difference function
    const df = new Float32Array(maxTau);
    for (let tau = 1; tau < maxTau; tau++) {
      let sum = 0;
      for (let j = 0; j < halfLen; j++) {
        const delta = buffer[j] - buffer[j + tau];
        sum += delta * delta;
      }
      df[tau] = sum;
    }

    // 2. Cumulative Mean Normalized Difference Function (CMNDF)
    const cmndf = new Float32Array(maxTau);
    cmndf[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau < maxTau; tau++) {
      runningSum += df[tau];
      cmndf[tau] = runningSum === 0 ? 1 : df[tau] / (runningSum / tau);
    }

    // 3. Absolute threshold search
    let tauChosen = -1;
    for (let tau = minTau; tau < maxTau; tau++) {
      if (cmndf[tau] < threshold) {
        while (tau + 1 < maxTau && cmndf[tau + 1] < cmndf[tau]) {
          tau++;
        }
        tauChosen = tau;
        break;
      }
    }

    if (tauChosen === -1) {
      // Find local minimum
      let minVal = 999;
      let minIdx = minTau;
      for (let tau = minTau; tau < maxTau; tau++) {
        if (cmndf[tau] < minVal) {
          minVal = cmndf[tau];
          minIdx = tau;
        }
      }
      if (minVal > 0.45) {
        return { freq: 0, confidence: 0 };
      }
      tauChosen = minIdx;
    }

    // 4. Parabolic interpolation with convexity guard
    let betterTau = tauChosen;
    if (tauChosen > 0 && tauChosen < maxTau - 1) {
      const s0 = cmndf[tauChosen - 1];
      const s1 = cmndf[tauChosen];
      const s2 = cmndf[tauChosen + 1];
      const denom = 2 * (s0 - 2 * s1 + s2);
      if (denom > 0.0001) {
        betterTau = tauChosen + (s0 - s2) / denom;
      }
    }

    const freq = sampleRate / betterTau;
    const confidence = Math.max(0, Math.min(1, 1 - cmndf[tauChosen]));

    return { freq, confidence };
  }
}
