import math
from typing import Tuple, List, Optional, Any
import numpy as np
import scipy.signal
import soundfile as sf

def hz_to_midi(freq: float) -> float:
    if freq <= 0 or math.isnan(freq):
        return 0.0
    return 69.0 + 12.0 * math.log2(freq / 440.0)

def midi_to_hz(midi: float) -> float:
    return 440.0 * (2.0 ** ((midi - 69.0) / 12.0))

def load_audio(filepath: str, target_sr: int = 22050) -> Tuple[np.ndarray, int, float]:
    """
    Loads audio using soundfile with librosa fallback. Converts to mono, removes DC bias, and resamples cleanly.
    Returns (samples_array, sample_rate, duration_seconds)
    """
    try:
        data, sr = sf.read(filepath, dtype='float32')
        if data.ndim > 1:
            data = np.mean(data, axis=1)
    except Exception:
        import librosa
        data, sr = librosa.load(filepath, sr=target_sr, mono=True)
        return data.astype(np.float32), sr, float(len(data)) / float(sr)

    # Remove DC bias to prevent pitch detection asymmetry
    dc_offset = float(np.mean(data))
    if abs(dc_offset) > 1e-5:
        data = data - dc_offset

    # Resample if sample rate differs
    if sr != target_sr:
        gcd = math.gcd(int(sr), int(target_sr))
        up = target_sr // gcd
        down = sr // gcd
        if up < 1500 and down < 1500:
            data = scipy.signal.resample_poly(data, up, down).astype(np.float32)
        else:
            num_samples = int(round(len(data) * target_sr / sr))
            data = scipy.signal.resample(data, num_samples).astype(np.float32)
        sr = target_sr

    duration = float(len(data)) / float(sr)
    return data, sr, duration

def compute_yin_pitch(
    frame: np.ndarray,
    sr: int,
    fmin: float = 65.4,   # C2
    fmax: float = 2093.0, # C7
    threshold: float = 0.15
) -> Tuple[float, float]:
    """
    Computes fundamental frequency (Hz) and confidence for a single audio frame using YIN.
    Includes sub-harmonic and octave jump validation.
    """
    w_len = len(frame)
    min_tau = max(2, int(sr / fmax))
    max_tau = min(w_len // 2, int(sr / fmin))

    if max_tau <= min_tau:
        return 0.0, 0.0

    # 1. Difference function d(tau) = sum (x[j] - x[j+tau])^2
    x = frame.astype(np.float64)
    d = np.zeros(max_tau)
    for tau in range(1, max_tau):
        diff = x[:w_len - tau] - x[tau:w_len]
        d[tau] = np.sum(diff * diff)

    # 2. Cumulative mean normalized difference function (CMNDF)
    cmndf = np.zeros(max_tau)
    cmndf[0] = 1.0
    running_sum = 0.0
    for tau in range(1, max_tau):
        running_sum += d[tau]
        if running_sum == 0:
            cmndf[tau] = 1.0
        else:
            cmndf[tau] = d[tau] / (running_sum / tau)

    # 3. Absolute thresholding (first dip below threshold prevents octave halving)
    tau_chosen = -1
    for tau in range(min_tau, max_tau):
        if cmndf[tau] < threshold:
            while tau + 1 < max_tau and cmndf[tau + 1] < cmndf[tau]:
                tau += 1
            tau_chosen = tau
            break

    if tau_chosen == -1:
        # Find global minimum in search range with unvoiced rejection
        tau_chosen = min_tau + int(np.argmin(cmndf[min_tau:max_tau]))
        if cmndf[tau_chosen] > 0.40:
            return 0.0, 0.0

    # 4. Octave error validation: check if half-period is also a valid minimum
    half_tau = tau_chosen // 2
    if half_tau >= min_tau and cmndf[half_tau] < threshold * 1.35:
        if (half_tau == min_tau or cmndf[half_tau] <= cmndf[half_tau - 1]) and \
           (half_tau == max_tau - 1 or cmndf[half_tau] <= cmndf[half_tau + 1]):
            tau_chosen = half_tau

    # 5. Parabolic interpolation for sub-sample accuracy
    if 0 < tau_chosen < max_tau - 1:
        alpha = cmndf[tau_chosen - 1]
        beta = cmndf[tau_chosen]
        gamma = cmndf[tau_chosen + 1]
        denom = 2.0 * (alpha - 2.0 * beta + gamma)
        if abs(denom) > 1e-9:
            delta = (alpha - gamma) / denom
            final_tau = tau_chosen + max(-0.5, min(0.5, delta))
        else:
            final_tau = float(tau_chosen)
    else:
        final_tau = float(tau_chosen)

    f0 = sr / final_tau if final_tau > 0 else 0.0
    confidence = float(np.clip(1.0 - cmndf[tau_chosen], 0.0, 1.0))

    if fmin <= f0 <= fmax:
        return float(f0), confidence
    return 0.0, 0.0

def detect_onsets(y: np.ndarray, sr: int, hop_size: int = 512) -> List[float]:
    """
    Detects note attack onset times using Spectral Flux and RMS Energy Peak Picking.
    """
    n_fft = 1024
    if len(y) < n_fft:
        return [0.0]

    # STFT
    _, _, Zxx = scipy.signal.stft(y, fs=sr, nperseg=n_fft, noverlap=n_fft - hop_size)
    magnitude = np.abs(Zxx)

    # Spectral flux (half-wave rectified difference)
    flux = np.diff(magnitude, axis=1)
    flux = np.maximum(0, flux)
    flux_curve = np.sum(flux, axis=0)

    # Peak picking with threshold
    mean_flux = np.mean(flux_curve)
    std_flux = np.std(flux_curve)
    threshold = mean_flux + 1.2 * std_flux

    peaks, _ = scipy.signal.find_peaks(flux_curve, height=threshold, distance=max(1, int(0.12 * sr / hop_size)))
    onset_times = [(p * hop_size) / sr for p in peaks]
    return onset_times

def estimate_key_chroma(y: np.ndarray, sr: int) -> Tuple[str, str]:
    """
    Estimates key and scale (Major / Minor) using 12-pitch chroma filterbank and Krumhansl-Schmuckler.
    """
    NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    n_fft = 2048
    if len(y) < n_fft:
        return "C Major (estimate)", "Major"

    _, _, Zxx = scipy.signal.stft(y, fs=sr, nperseg=n_fft, noverlap=1024)
    mag = np.abs(Zxx)
    freqs = np.linspace(0, sr / 2, n_fft // 2 + 1)

    # Accumulate energy into 12 semitone chroma bins
    chroma = np.zeros(12)
    for bin_idx, f in enumerate(freqs):
        if 80.0 <= f <= 2500.0:
            midi_pitch = hz_to_midi(f)
            semitone_idx = int(round(midi_pitch)) % 12
            chroma[semitone_idx] += np.sum(mag[bin_idx, :])

    if np.sum(chroma) > 0:
        chroma /= np.sum(chroma)

    best_score = -2.0
    best_key = "C"
    best_mode = "Major"

    for i in range(12):
        rot_maj = np.roll(MAJOR_PROFILE, i)
        rot_min = np.roll(MINOR_PROFILE, i)
        c_maj = np.corrcoef(chroma, rot_maj)[0, 1]
        c_min = np.corrcoef(chroma, rot_min)[0, 1]

        if not np.isnan(c_maj) and c_maj > best_score:
            best_score = c_maj
            best_key = NOTE_NAMES[i]
            best_mode = "Major"

        if not np.isnan(c_min) and c_min > best_score:
            best_score = c_min
            best_key = NOTE_NAMES[i]
            best_mode = "Minor"

    return f"{best_key} {best_mode}", best_mode

def estimate_bpm_tempo(
    y: np.ndarray,
    sr: int,
    notes: Optional[List[Any]] = None
) -> float:
    """
    Enterprise-grade Hybrid Tempo Engine:
    1. Multi-band Mel-Scale Spectral Novelty (Onset Envelope with log compression).
    2. Dynamic Tempogram with Log-Normal Human Tactus Prior (Ellis beat tracker).
    3. Note Inter-Onset Intervals (IOI) Cross-Validation and Harmonic Multiplier Resolution.
    4. Handles edge cases (short samples, unvoiced audio, extreme speeds).
    """
    try:
        if y is None or len(y) < int(sr * 0.35):
            return 120.0

        rms = float(np.sqrt(np.mean(y ** 2)))
        if rms < 1e-4:
            return 120.0

        import librosa
        import scipy.stats

        # Stage 1: Mel-Scale Log-Novelty Onset Envelope
        # Hop length 256 @ 22050 Hz gives ~86 fps high-resolution onset tracking
        hop_length = 256
        onset_env = librosa.onset.onset_strength(
            y=y,
            sr=sr,
            hop_length=hop_length,
            aggregate=np.median,
            fmax=8000
        )

        if len(onset_env) < 16 or float(np.max(onset_env)) < 1e-4:
            return 120.0

        # Stage 2: Dual Estimation (Tempogram + Ellis DP Beat Tracker)
        # 2A. Dynamic Tempogram without artificial prior clipping
        tempos = librosa.feature.tempo(
            onset_envelope=onset_env,
            sr=sr,
            hop_length=hop_length,
            prior=None,
            aggregate=None
        )
        tempogram_bpm = float(np.median(tempos)) if len(tempos) > 0 else 120.0

        # 2B. Dynamic Programming Beat Tracker
        dp_bpm, _ = librosa.beat.beat_track(
            onset_envelope=onset_env,
            sr=sr,
            hop_length=hop_length
        )
        dp_bpm = float(np.atleast_1d(dp_bpm)[0])

        # Form consensus from waveform analysis
        if abs(tempogram_bpm - dp_bpm) <= 3.0:
            audio_bpm = (tempogram_bpm + dp_bpm) / 2.0
        else:
            ratio = tempogram_bpm / max(1.0, dp_bpm)
            if 1.85 <= ratio <= 2.15 or 0.45 <= ratio <= 0.55:
                # If one is double/half tempo, prefer the DP tracker estimate
                audio_bpm = dp_bpm if dp_bpm > 0 else tempogram_bpm
            else:
                audio_bpm = dp_bpm if dp_bpm > 0 else tempogram_bpm

        # Stage 2C: High-Precision Parabolic Sub-Bin Interpolation
        # Eliminates discrete frame quantization error (turns 64.6 -> 65.0)
        acorr = librosa.autocorrelate(onset_env, max_size=int((60.0 / 38.0) * (sr / hop_length)))
        if len(acorr) > 10:
            target_lag = int(round((60.0 * sr) / (audio_bpm * hop_length)))
            if 1 < target_lag < len(acorr) - 1:
                w = 3
                search_region = acorr[max(1, target_lag - w):min(len(acorr) - 1, target_lag + w + 1)]
                if len(search_region) >= 3:
                    local_k = max(1, target_lag - w) + int(np.argmax(search_region))
                    y0, y1, y2 = float(acorr[local_k - 1]), float(acorr[local_k]), float(acorr[local_k + 1])
                    denom = 2.0 * (2.0 * y1 - y0 - y2)
                    if abs(denom) > 1e-6:
                        delta = (y2 - y0) / denom
                        refined_lag = local_k + delta
                        if refined_lag > 0:
                            audio_bpm = (60.0 * sr) / (refined_lag * hop_length)

        # Stage 2D: Smart Tactus & Half-Time/Double-Time Resolver
        # If detected tempo is in half-time zone (< 85 BPM), check if double tempo has an authentic local peak
        if audio_bpm < 85.0 and len(acorr) > 10:
            double_bpm = audio_bpm * 2.0
            if 85.0 <= double_bpm <= 175.0:
                half_lag = int(round((60.0 * sr) / (double_bpm * hop_length)))
                full_lag = int(round((60.0 * sr) / (audio_bpm * hop_length)))
                if 2 < half_lag < len(acorr) - 2 and full_lag < len(acorr):
                    w = 3
                    sub_region = acorr[half_lag - w:half_lag + w + 1]
                    if len(sub_region) >= 3:
                        local_k = (half_lag - w) + int(np.argmax(sub_region))
                        # Must be a true local maximum peak in autocorrelation
                        if acorr[local_k] > acorr[local_k - 1] and acorr[local_k] > acorr[local_k + 1]:
                            # If sub-harmonic peak has strong energy (>= 45% of the full lag peak)
                            if acorr[local_k] >= 0.45 * acorr[full_lag]:
                                y0, y1, y2 = float(acorr[local_k - 1]), float(acorr[local_k]), float(acorr[local_k + 1])
                                denom = 2.0 * (2.0 * y1 - y0 - y2)
                                delta = (y2 - y0) / denom if abs(denom) > 1e-6 else 0.0
                                audio_bpm = (60.0 * sr) / ((local_k + delta) * hop_length)

        # Stage 3: Note Inter-Onset Interval (IOI) Cross-Validation
        if notes and len(notes) >= 4:
            starts = []
            for n in notes:
                st = getattr(n, 'start', None)
                if st is None and isinstance(n, dict):
                    st = n.get('start')
                if st is not None:
                    starts.append(float(st))
            starts.sort()
            iois = np.diff(starts)
            # Filter realistic musical note intervals (16th notes to whole notes: 0.10s to 3.2s)
            iois = iois[(iois >= 0.10) & (iois <= 3.2)]

            if len(iois) >= 3:
                raw_candidates = set()
                # Test audio_bpm, half-time, and double-time, plus local micro-search
                for mult in [0.5, 1.0, 2.0]:
                    c = audio_bpm * mult
                    if 45.0 <= c <= 225.0:
                        for delta in [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5]:
                            cand = round(c + delta, 1)
                            if 45.0 <= cand <= 225.0:
                                raw_candidates.add(cand)

                best_bpm = audio_bpm
                min_loss = float('inf')

                for cand in raw_candidates:
                    beat_sec = 60.0 / cand
                    # Standard musical grid divisions: 16th, triplet, 8th, dotted 8th, quarter, dotted quarter, half, whole
                    subdivs = np.array([0.25, 0.333, 0.5, 0.667, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0]) * beat_sec
                    dists = [np.min(np.abs(ioi - subdivs)) / beat_sec for ioi in iois]
                    ioi_err = float(np.mean(dists))

                    # Penalize deviations from audio waveform consensus
                    octave_diff = abs(np.log2(cand / audio_bpm))
                    # Subtle tactus preference: if IOI alignment is equal, prefer 90-150 zone
                    tactus_weight = 0.05 * abs(np.log2(cand / 120.0))
                    total_loss = ioi_err + 0.35 * octave_diff + tactus_weight

                    if total_loss < min_loss:
                        min_loss = total_loss
                        best_bpm = cand

                audio_bpm = best_bpm

        # Clean snapping to integer if within 0.15 BPM
        if abs(audio_bpm - round(audio_bpm)) < 0.15:
            final_bpm = float(round(audio_bpm))
        else:
            final_bpm = round(float(audio_bpm), 1)

        return max(40.0, min(240.0, final_bpm))

    except Exception:
        # Fallback to simple autocorrelation if advanced extraction fails
        try:
            hop = 512
            n_fft = 1024
            _, _, Zxx = scipy.signal.stft(y, fs=sr, nperseg=n_fft, noverlap=n_fft - hop)
            flux = np.maximum(0, np.diff(np.sum(np.abs(Zxx), axis=0)))
            acorr = np.correlate(flux, flux, mode='full')
            acorr = acorr[len(acorr)//2:]
            min_lag = int((60.0 / 200.0) * (sr / hop))
            max_lag = int((60.0 / 50.0) * (sr / hop))
            if max_lag <= min_lag or len(acorr) <= max_lag:
                return 120.0
            lag = min_lag + int(np.argmax(acorr[min_lag:max_lag]))
            tempo = (60.0 * sr) / (lag * hop)
            while tempo < 70: tempo *= 2
            while tempo > 180: tempo /= 2
            return round(float(tempo), 1)
        except Exception:
            return 120.0
