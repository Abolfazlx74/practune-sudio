import os
import tempfile
from pathlib import Path
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from ..models.schemas import (
    NoteItem,
    PitchFrame,
    EvaluationRequest,
    EvaluationResponse,
    NoteScore,
    TransitionRegion,
)

def extract_instrument_main_notes(notes: List[NoteItem]) -> List[NoteItem]:
    """
    Purifies reference notes for Instrument Mode:
    - Filters out transient portamento/sliding artifacts (< 100ms) between notes.
    - Merges consecutive split notes of the same pitch separated by micro-breaks (< 120ms).
    - Focuses strictly on solid musical plateaus (main notes).
    """
    if not notes:
        return []
    
    # 1. Filter out short transition glides (< 100ms)
    filtered: List[NoteItem] = []
    for i, n in enumerate(notes):
        dur = n.end - n.start
        if dur < 0.10 and len(notes) > 1:
            prev_n = notes[i - 1] if i > 0 else None
            next_n = notes[i + 1] if i < len(notes) - 1 else None
            if prev_n and next_n and abs(prev_n.midi - next_n.midi) >= 1:
                # Inter-note transition fragment, ignore
                continue
            if dur < 0.07:
                continue
        filtered.append(n)

    if not filtered:
        filtered = notes

    # 2. Merge adjacent notes of the exact same pitch with negligible gap (< 120ms)
    merged: List[NoteItem] = []
    for n in filtered:
        if not merged:
            merged.append(n.model_copy())
            continue
        last = merged[-1]
        gap = n.start - last.end
        if last.midi == n.midi and gap < 0.12:
            last.end = n.end
            last.duration = round(last.end - last.start, 3)
            last.confidence = max(last.confidence, n.confidence)
        else:
            merged.append(n.model_copy())

    return merged

def extract_vocal_main_notes(notes: List[NoteItem]) -> List[NoteItem]:
    """
    Filters ultra-short inter-syllable pitch glides (< 85ms) in Vocal mode
    so natural transitions between words do not cause artificial score drops.
    """
    if len(notes) <= 1:
        return notes
    filtered = [n for n in notes if (n.end - n.start) >= 0.085]
    return filtered if filtered else notes

def extract_notes_from_pitch_frames(frames: List[PitchFrame]) -> List[NoteItem]:
    """
    Transforms a performance pitch contour (from a recorded practice take)
    into simplified, discrete musical note events.
    Consolidates attack transients, vibrato, and pitch drift into the core played note.
    """
    from .pitch_transcription import midi_to_note_info
    from .dsp_utils import midi_to_hz

    if not frames:
        return []

    sorted_frames = sorted(frames, key=lambda f: f.time)
    valid = [f for f in sorted_frames if f.confidence >= 0.35 and 50.0 <= f.frequency <= 2000.0]
    if not valid:
        return []

    midis = [f.midi for f in valid]
    smoothed_midis = []
    for k in range(len(midis)):
        win = midis[max(0, k - 1): min(len(midis), k + 2)]
        smoothed_midis.append(float(np.median(win)))

    notes: List[NoteItem] = []
    curr_seg: List[PitchFrame] = []

    def commit(seg: List[PitchFrame]):
        if not seg:
            return
        seg_dur = seg[-1].time - seg[0].time
        if seg_dur < 0.05:
            return
        seg_midis = [f.midi for f in seg]
        med_m = float(np.median(seg_midis))
        rounded_m = int(round(med_m))
        n_name, octv, c_dev = midi_to_note_info(med_m)
        freq = float(midi_to_hz(rounded_m))
        conf = float(np.mean([f.confidence for f in seg]))
        note_id = f"perf_{int(seg[0].time * 1000):06d}_{rounded_m}"
        notes.append(NoteItem(
            id=note_id,
            midi=rounded_m,
            note_name=n_name,
            octave=octv,
            start=round(seg[0].time, 3),
            end=round(seg[-1].time, 3),
            duration=round(max(0.04, seg_dur), 3),
            confidence=round(conf, 2),
            frequency=round(freq, 1),
            cents_deviation=c_dev
        ))

    for idx, f in enumerate(valid):
        if not curr_seg:
            curr_seg.append(f)
            continue
        prev = curr_seg[-1]
        dt = f.time - prev.time
        dm = abs(smoothed_midis[idx] - smoothed_midis[idx - 1])
        if dt > 0.090 or dm >= 0.80:
            commit(curr_seg)
            curr_seg = [f]
        else:
            curr_seg.append(f)

    if curr_seg:
        commit(curr_seg)

    return extract_instrument_main_notes(notes)

def evaluate_performance(req: EvaluationRequest) -> EvaluationResponse:
    """
    High-Precision Musical Performance Evaluator:
    - Dedicated modes: Instrument Mode (pure discrete main notes, transition-immune) and Vocal Mode (balanced vocal intonation & vibrato).
    - Constrained time alignment for acoustic / mic latency compensation (±250ms).
    - Non-bleeding note windowing to prevent adjacent notes from corrupting pitch accuracy.
    - Pitch accuracy measured in cents with natural vocal vibrato tolerance.
    - Octave jump disambiguation (supports male/female register octave shifts & instrument registers).
    - Onset timing accuracy with natural human perception thresholds.
    - Note coverage: tracks missed notes vs hit notes.
    - Returns detailed diagnostics and actionable musical feedback.
    """
    studio_type = getattr(req, "studio_type", "vocal") or "vocal"
    if studio_type == "instrument":
        ref_notes = extract_instrument_main_notes(req.reference_notes)
    else:
        ref_notes = extract_vocal_main_notes(req.reference_notes)

    perf_pitches = req.performance_pitches
    tol_cents = max(40.0, float(req.tolerance_cents or (70.0 if studio_type == "instrument" else 65.0)))

    if not ref_notes:
        return EvaluationResponse(
            pitch_accuracy=0.0,
            timing_accuracy=0.0,
            sequence_accuracy=0.0,
            note_coverage=0.0,
            overall_score=0.0,
            feedback=["No reference notes provided for evaluation."],
            note_scores=[]
        )

    # 1. Filter out unvoiced / low-confidence / noise frames
    valid_frames = [
        p for p in perf_pitches
        if p.confidence >= 0.40 and 55.0 <= p.frequency <= 1600.0
    ]

    if not valid_frames:
        feedback_msg = (
            "No instrument pitch detected during the session. Please check your microphone input and play along clearly."
            if studio_type == "instrument"
            else "No vocal pitch detected during the session. Please check your microphone input and sing along clearly."
        )
        return EvaluationResponse(
            pitch_accuracy=0.0,
            timing_accuracy=0.0,
            sequence_accuracy=0.0,
            note_coverage=0.0,
            overall_score=0.0,
            feedback=[feedback_msg],
            note_scores=[],
            detected_reference_notes_count=len(ref_notes),
            detected_live_notes_count=0,
            missed_notes_count=len(ref_notes),
            extra_notes_count=0,
            alignment_offset_ms=0.0,
            avg_cents_error=0.0,
            studio_type=studio_type
        )

    practice_mode = getattr(req, "practice_mode", "full") or "full"

    # Dedicated Note-by-Note Evaluator (Treats take as recorded file, extracts discrete note events)
    if practice_mode == "note" and len(ref_notes) == 1:
        target_ref = ref_notes[0]
        perf_notes = extract_notes_from_pitch_frames(valid_frames)

        if not perf_notes:
            feedback_msg = (
                f"Target note {target_ref.note_name} was not detected. Check microphone volume and play the note clearly."
                if studio_type == "instrument"
                else f"Target note {target_ref.note_name} was not detected. Check microphone volume and sing the note clearly."
            )
            return EvaluationResponse(
                pitch_accuracy=0.0,
                timing_accuracy=0.0,
                sequence_accuracy=0.0,
                note_coverage=0.0,
                overall_score=0.0,
                feedback=[feedback_msg],
                note_scores=[NoteScore(
                    note_id=target_ref.id,
                    target_note=target_ref.note_name,
                    target_midi=target_ref.midi,
                    start=target_ref.start,
                    end=target_ref.end,
                    user_avg_cents_error=100.0,
                    user_detected_midi=None,
                    is_hit=False,
                    score=0.0
                )],
                detected_reference_notes_count=1,
                detected_live_notes_count=0,
                missed_notes_count=1,
                extra_notes_count=0,
                alignment_offset_ms=0.0,
                avg_cents_error=0.0,
                studio_type=studio_type
            )

        # Select best overlapping or closest candidate note
        best_note = None
        best_dist = float("inf")
        for pn in perf_notes:
            time_overlap = max(0.0, min(pn.end, target_ref.end) - max(pn.start, target_ref.start))
            cents_d = abs(pn.midi - target_ref.midi)
            dist = (abs(pn.start - target_ref.start) * 2.0) + cents_d - (time_overlap * 3.0)
            if dist < best_dist:
                best_dist = dist
                best_note = pn

        if best_note is None:
            best_note = perf_notes[0]

        # Compare target note vs extracted user note
        ref_pitch = float(target_ref.midi) + (getattr(target_ref, "cents_deviation", 0.0) / 100.0)
        user_pitch = float(best_note.midi) + (getattr(best_note, "cents_deviation", 0.0) / 100.0)

        # Octave disambiguation
        octave_shift = 0
        diff_raw = user_pitch - ref_pitch
        if abs(diff_raw - 12.0) <= 1.5:
            user_pitch -= 12.0
            octave_shift = 12
        elif abs(diff_raw + 12.0) <= 1.5:
            user_pitch += 12.0
            octave_shift = -12

        cents_err = (user_pitch - ref_pitch) * 100.0
        semi_dist = abs(user_pitch - ref_pitch)
        is_same_semitone = (round(user_pitch) == target_ref.midi) or (semi_dist <= 0.85)

        if is_same_semitone:
            is_hit = True
            if abs(cents_err) <= 35.0:
                pitch_score = 100.0
            elif abs(cents_err) <= 80.0:
                pitch_score = max(75.0, 100.0 - (abs(cents_err) - 35.0) * 0.55)
            else:
                pitch_score = max(55.0, 75.0 - (abs(cents_err) - 80.0) * 0.40)
        else:
            is_hit = False
            pitch_score = max(0.0, 45.0 - (semi_dist - 0.85) * 20.0)

        onset_diff_ms = abs(best_note.start - target_ref.start) * 1000.0
        timing_score = max(40.0, 100.0 - max(0.0, onset_diff_ms - 80.0) / 2.0)

        note_coverage = 100.0 if is_hit else 0.0
        sequence_accuracy = 100.0 if is_hit else 0.0

        overall = round(
            0.40 * pitch_score
            + 0.30 * timing_score
            + 0.20 * note_coverage
            + 0.10 * sequence_accuracy,
            1
        )
        overall_score = max(0.0, min(100.0, overall))

        note_total = round(0.70 * pitch_score + 0.30 * timing_score, 1)

        note_scores = [NoteScore(
            note_id=target_ref.id,
            target_note=target_ref.note_name,
            target_midi=target_ref.midi,
            start=target_ref.start,
            end=target_ref.end,
            user_avg_cents_error=round(cents_err, 1),
            user_detected_midi=round(user_pitch, 2),
            is_hit=is_hit,
            score=note_total
        )]

        feedback_items: List[str] = []
        if is_hit:
            feedback_items.append(f"Excellent hit! Extracted {best_note.note_name} ({abs(cents_err):.0f}¢ dev, {best_note.duration:.2f}s sustain).")
            if onset_diff_ms <= 80.0:
                feedback_items.append("Spot-on onset attack timing!")
            else:
                feedback_items.append(f"Attack timing entered ~{onset_diff_ms:.0f}ms from target.")
        else:
            feedback_items.append(f"Detected note {best_note.note_name} ({best_note.frequency:.1f}Hz) instead of target {target_ref.note_name}.")
            feedback_items.append(f"Pitch was {semi_dist:.1f} semitones off. Focus on hitting {target_ref.note_name}.")

        if octave_shift != 0:
            feedback_items.append(f"Octave shift: played 1 octave {'higher' if octave_shift > 0 else 'lower'}.")

        return EvaluationResponse(
            pitch_accuracy=round(pitch_score, 1),
            timing_accuracy=round(timing_score, 1),
            sequence_accuracy=sequence_accuracy,
            note_coverage=note_coverage,
            overall_score=overall_score,
            feedback=feedback_items,
            note_scores=note_scores,
            detected_reference_notes_count=1,
            detected_live_notes_count=1,
            missed_notes_count=0 if is_hit else 1,
            extra_notes_count=max(0, len(perf_notes) - 1),
            alignment_offset_ms=round((best_note.start - target_ref.start) * 1000.0, 1),
            avg_cents_error=round(abs(cents_err), 1),
            evaluation_mode=getattr(req, "evaluation_mode", "live"),
            studio_type=studio_type
        )

    perf_times = np.array([f.time for f in valid_frames], dtype=np.float64)
    perf_midis = np.array([f.midi for f in valid_frames], dtype=np.float64)

    # 2. Constrained Global Latency / Alignment Search (-250ms to +250ms)
    candidate_offsets = np.linspace(-0.25, 0.25, 101)  # 5ms steps
    best_offset = 0.0
    best_cost = float("inf")

    max_overlap = 0
    for off in candidate_offsets:
        cnt = 0
        for n in ref_notes:
            cnt += int(np.sum((perf_times >= n.start + off) & (perf_times <= n.end + off)))
        if cnt > max_overlap:
            max_overlap = cnt

    for off in candidate_offsets:
        cost_sum = 0.0
        overlap_count = 0
        for n in ref_notes:
            mask = (perf_times >= n.start + off) & (perf_times <= n.end + off)
            if np.any(mask):
                raw_diff = np.abs(perf_midis[mask] - n.midi)
                oct_diff = np.minimum(raw_diff, np.minimum(np.abs(raw_diff - 12.0), np.abs(raw_diff + 12.0)))
                cost_sum += float(np.sum(oct_diff))
                overlap_count += int(np.sum(mask))
        if overlap_count >= max(1, int(max_overlap * 0.85)):
            reg_cost = (cost_sum / overlap_count) + abs(off) * 0.5
            if reg_cost < best_cost:
                best_cost = reg_cost
                best_offset = float(off)

    aligned_times = perf_times - best_offset

    # 3. Check for Global Octave Transposition
    overlapping_diffs = []
    for n in ref_notes:
        mask = (aligned_times >= n.start) & (aligned_times <= n.end)
        if np.any(mask):
            overlapping_diffs.extend((perf_midis[mask] - n.midi).tolist())

    global_octave_shift = 0
    if overlapping_diffs:
        med_raw_diff = float(np.median(overlapping_diffs))
        if abs(med_raw_diff - 12.0) <= 1.8:
            global_octave_shift = 12
        elif abs(med_raw_diff + 12.0) <= 1.8:
            global_octave_shift = -12

    # 4. Note-by-Note Evaluation with Strict Windowing (No Adjacent Bleeding)
    note_scores: List[NoteScore] = []
    pitch_scores_list: List[float] = []
    timing_scores_list: List[float] = []
    all_cents_errors: List[float] = []
    feedback_items: List[str] = []

    notes_hit_count = 0
    missed_notes_count = 0
    detected_live_segments = 0

    num_notes = len(ref_notes)
    for i, note in enumerate(ref_notes):
        prev_end = ref_notes[i - 1].end if i > 0 else 0.0
        next_start = ref_notes[i + 1].start if i < num_notes - 1 else float("inf")

        win_start = max(note.start - 0.05, (prev_end + note.start) / 2.0 if prev_end < note.start else prev_end)
        win_end = min(note.end + 0.05, (note.end + next_start) / 2.0 if next_start > note.end else next_start)

        mask = (aligned_times >= win_start) & (aligned_times <= win_end)

        if not np.any(mask):
            missed_notes_count += 1
            pitch_scores_list.append(0.0)
            timing_scores_list.append(0.0)
            note_scores.append(NoteScore(
                note_id=note.id,
                target_note=note.note_name,
                target_midi=note.midi,
                start=note.start,
                end=note.end,
                user_avg_cents_error=100.0,
                user_detected_midi=None,
                is_hit=False,
                score=0.0
            ))
            feedback_items.append(f"Note {note.note_name} at {note.start:.1f}s was missed or not sung.")
            continue

        matched_midis = perf_midis[mask]
        matched_times = aligned_times[mask]

        # Apply global or local octave adjustment
        adjusted_midis = []
        for m in matched_midis:
            adj = m - global_octave_shift
            diff = adj - note.midi
            if abs(diff - 12.0) <= 1.5:
                adj -= 12.0
            elif abs(diff + 12.0) <= 1.5:
                adj += 12.0
            adjusted_midis.append(adj)
        adjusted_midis = np.array(adjusted_midis, dtype=np.float64)

        # Discard sub-harmonic / transient unvoiced noise (> 8 semitones off target)
        core_mask = np.abs(adjusted_midis - note.midi) < 8.0
        if not np.any(core_mask):
            missed_notes_count += 1
            pitch_scores_list.append(0.0)
            timing_scores_list.append(0.0)
            note_scores.append(NoteScore(
                note_id=note.id,
                target_note=note.note_name,
                target_midi=note.midi,
                start=note.start,
                end=note.end,
                user_avg_cents_error=200.0,
                user_detected_midi=float(np.median(adjusted_midis)),
                is_hit=False,
                score=0.0
            ))
            feedback_items.append(f"Note {note.note_name} ({note.start:.1f}s) was sung with completely wrong pitch.")
            continue

        detected_live_segments += 1
        core_midis = adjusted_midis[core_mask]

        # Target reference pitch (accurate to fractions of a cent)
        ref_pitch_target = note.midi + (getattr(note, "cents_deviation", 0.0) / 100.0)

        # Transition-aware filtering: isolate stable note core frames
        stable_core_midis = []
        transitions = getattr(req, "transitions", None) or []
        dur = note.end - note.start
        eff_tolerance = max(tol_cents, 70.0 if studio_type == "instrument" else 65.0)

        if studio_type == "instrument":
            # Instrument Mode: Isolate stable body of the note
            attack_margin = min(0.08, dur * 0.25)
            release_margin = min(0.06, dur * 0.20)

            for mid_val, t_val in zip(core_midis, matched_times[core_mask]):
                in_transition = any(tr.start <= t_val <= tr.end for tr in transitions)
                is_boundary = (t_val < note.start + attack_margin) or (t_val > note.end - release_margin)
                if not in_transition and not is_boundary:
                    stable_core_midis.append(mid_val)

            if not stable_core_midis:
                stable_core_midis = core_midis.tolist()

            stable_core_midis = np.array(stable_core_midis, dtype=np.float64)
            med_user_midi = float(np.median(stable_core_midis))
            cents_err = (med_user_midi - note.midi) * 100.0
            all_cents_errors.append(cents_err)

            semi_dist = abs(med_user_midi - note.midi)
            is_same_semitone = (round(med_user_midi) == note.midi) or (semi_dist <= 0.85)

            if is_same_semitone:
                is_hit = True
                if abs(cents_err) <= 40.0:
                    pitch_score = 100.0
                elif abs(cents_err) <= 85.0:
                    pitch_score = max(75.0, 100.0 - (abs(cents_err) - 40.0) * 0.60)
                else:
                    pitch_score = max(60.0, 75.0 - (abs(cents_err) - 85.0) * 0.50)
            else:
                is_hit = False
                pitch_score = max(0.0, 50.0 - (semi_dist - 0.85) * 25.0)

            pitch_scores_list.append(pitch_score)

            onset_diff_ms = abs(matched_times[0] - note.start) * 1000.0
            if onset_diff_ms <= 90.0:
                timing_score = 100.0
            else:
                timing_score = max(40.0, 100.0 - max(0.0, onset_diff_ms - 90.0) / 2.0)
            timing_scores_list.append(timing_score)

            if is_hit:
                notes_hit_count += 1
        else:
            # Vocal Mode: Balanced intonation & vibrato scoring (no double-penalty)
            attack_margin = min(0.06, dur * 0.22)
            release_margin = min(0.05, dur * 0.20)

            for mid_val, t_val in zip(core_midis, matched_times[core_mask]):
                in_transition = any(tr.start <= t_val <= tr.end for tr in transitions)
                is_boundary = (t_val < note.start + attack_margin) or (t_val > note.end - release_margin)
                if not in_transition and not is_boundary:
                    stable_core_midis.append(mid_val)

            if not stable_core_midis:
                stable_core_midis = core_midis.tolist()

            stable_core_midis = np.array(stable_core_midis, dtype=np.float64)
            med_user_midi = float(np.median(stable_core_midis))
            cents_err = (med_user_midi - ref_pitch_target) * 100.0
            all_cents_errors.append(cents_err)

            cents_diffs = np.abs(stable_core_midis - ref_pitch_target) * 100.0
            in_tune_ratio = float(np.mean(cents_diffs <= eff_tolerance))

            # Full 100 within ±25 cents (natural vocal vibrato); single smooth linear decay beyond
            center_score = max(0.0, 100.0 - max(0.0, abs(cents_err) - 25.0) * 1.1)
            frame_score = in_tune_ratio * 100.0
            pitch_score = min(100.0, 0.65 * center_score + 0.35 * frame_score)
            pitch_scores_list.append(pitch_score)

            # Timing score for vocal: 110ms natural consonant/breath onset window
            onset_diff_ms = abs(matched_times[0] - note.start) * 1000.0
            if onset_diff_ms <= 110.0:
                timing_score = 100.0
            else:
                timing_score = max(40.0, 100.0 - max(0.0, onset_diff_ms - 110.0) / 2.2)
            timing_scores_list.append(timing_score)

            is_hit = abs(cents_err) <= eff_tolerance and pitch_score >= 55.0
            if is_hit:
                notes_hit_count += 1

        note_total = round(0.70 * pitch_score + 0.30 * timing_score, 1)

        note_scores.append(NoteScore(
            note_id=note.id,
            target_note=note.note_name,
            target_midi=note.midi,
            start=note.start,
            end=note.end,
            user_avg_cents_error=round(cents_err, 1),
            user_detected_midi=round(med_user_midi, 2),
            is_hit=is_hit,
            score=note_total
        ))

        # Actionable feedback for this note
        if not is_hit:
            if cents_err < -eff_tolerance:
                feedback_items.append(f"Note {note.note_name} ({note.start:.1f}s) was ~{abs(cents_err):.0f}¢ flat (too low).")
            elif cents_err > eff_tolerance:
                feedback_items.append(f"Note {note.note_name} ({note.start:.1f}s) was ~{cents_err:.0f}¢ sharp (too high).")
        elif onset_diff_ms > 150.0:
            if (matched_times[0] - note.start) > 0:
                feedback_items.append(f"Note {note.note_name} entered ~{onset_diff_ms:.0f}ms late.")
            else:
                feedback_items.append(f"Note {note.note_name} attacked ~{onset_diff_ms:.0f}ms early.")

    # 5. Check for Extra / Spurious Notes (singing/playing during long reference rests)
    extra_notes_count = 0
    ref_silence_intervals: List[Tuple[float, float]] = []
    min_rest_gap = 0.50 if studio_type == "instrument" else 0.35
    for i in range(len(ref_notes) - 1):
        gap_start = ref_notes[i].end + 0.1
        gap_end = ref_notes[i + 1].start - 0.1
        if gap_end - gap_start >= min_rest_gap:
            ref_silence_intervals.append((gap_start, gap_end))

    min_spurious_frames = 8 if studio_type == "instrument" else 5
    for g_start, g_end in ref_silence_intervals:
        spurious_mask = (aligned_times >= g_start) & (aligned_times <= g_end)
        if np.sum(spurious_mask) >= min_spurious_frames:
            extra_notes_count += 1
            feedback_items.append(
                f"Detected unsolicited playing during rest between {g_start:.1f}s and {g_end:.1f}s."
                if studio_type == "instrument"
                else f"Detected unsolicited singing during rest between {g_start:.1f}s and {g_end:.1f}s."
            )

    # 6. Overall Metrics Compilation
    pitch_accuracy = round(float(np.mean(pitch_scores_list)), 1) if pitch_scores_list else 0.0
    timing_accuracy = round(float(np.mean(timing_scores_list)), 1) if timing_scores_list else 0.0
    note_coverage = round(float((notes_hit_count / num_notes) * 100.0), 1)

    sequence_accuracy = round(float((notes_hit_count / max(1, detected_live_segments)) * 100.0), 1)
    sequence_accuracy = min(100.0, sequence_accuracy)

    raw_overall = (
        0.40 * pitch_accuracy
        + 0.30 * timing_accuracy
        + 0.20 * note_coverage
        + 0.10 * sequence_accuracy
    )
    overall_score = round(max(0.0, min(100.0, raw_overall)), 1)

    avg_cents = round(float(np.mean(np.abs(all_cents_errors))), 1) if all_cents_errors else 0.0

    # Summary Feedback Banner
    if overall_score >= 90:
        feedback_items.insert(0, "Superb performance! Pitch centers, note attacks, and rhythm were exceptionally accurate.")
    elif overall_score >= 75:
        feedback_items.insert(0, "Great practice run! Most notes were in tune; keep steadying pitch transitions and attacks.")
    elif overall_score >= 50:
        feedback_items.insert(0, "Decent attempt. Focus on holding pitch centers steadily and hitting the correct intervals.")
    else:
        feedback_items.insert(0, "Keep practicing! Slowing down playback speed (75% or 50%) will help master the melody.")

    if global_octave_shift != 0:
        feedback_items.insert(1, f"Octave auto-transposition active: detected singing 1 octave {'higher' if global_octave_shift > 0 else 'lower'}.")

    return EvaluationResponse(
        pitch_accuracy=pitch_accuracy,
        timing_accuracy=timing_accuracy,
        sequence_accuracy=sequence_accuracy,
        note_coverage=note_coverage,
        overall_score=overall_score,
        feedback=feedback_items[:8],
        note_scores=note_scores,
        performance_contour=perf_pitches if getattr(req, "evaluation_mode", "live") == "imported" else None,
        detected_reference_notes_count=num_notes,
        detected_live_notes_count=detected_live_segments,
        missed_notes_count=missed_notes_count,
        extra_notes_count=extra_notes_count,
        alignment_offset_ms=round(best_offset * 1000.0, 1),
        avg_cents_error=avg_cents,
        evaluation_mode=getattr(req, "evaluation_mode", "live"),
        studio_type=studio_type
    )

def evaluate_imported_performance(
    audio_id: str,
    file_bytes: bytes,
    filename: str,
    tolerance_cents: float = 50.0,
    transpose_semitones: int = 0,
    studio_type: str = "vocal"
) -> EvaluationResponse:
    """
    Imported Audio Performance Evaluator:
    - Decodes and analyzes imported audio file using the exact same DSP YIN & Note Extractor.
    - Aligns with reference audio notes and computes high-precision performance metrics.
    - Returns EvaluationResponse including extracted performance pitch contour.
    """
    from .pitch_transcription import get_transcription, run_yin_transcription
    from .dsp_utils import load_audio

    ref = get_transcription(audio_id)
    if not ref or not ref.notes:
        raise ValueError(f"No reference transcription found for audio '{audio_id}'.")

    suffix = Path(filename).suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        y, sr, _ = load_audio(tmp_path, target_sr=22050)
        perf_notes, perf_pitches, perf_transitions, _, _, _ = run_yin_transcription(y, sr)
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass

    target_notes = ref.notes
    if transpose_semitones != 0:
        NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        target_notes = []
        for n in ref.notes:
            shifted_m = n.midi + transpose_semitones
            octv = shifted_m // 12
            n_name = f"{NOTE_NAMES[shifted_m % 12]}{octv}"
            target_notes.append(n.model_copy(update={"midi": shifted_m, "note_name": n_name}))

    req = EvaluationRequest(
        reference_notes=target_notes,
        performance_pitches=perf_pitches,
        tolerance_cents=tolerance_cents,
        transitions=ref.transitions,
        evaluation_mode="imported",
        studio_type=studio_type
    )
    resp = evaluate_performance(req)
    resp.performance_contour = perf_pitches
    resp.studio_type = studio_type
    return resp