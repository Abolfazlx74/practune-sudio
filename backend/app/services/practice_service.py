import numpy as np
from typing import List, Dict, Any, Optional
from ..models.schemas import (
    NoteItem,
    PitchFrame,
    EvaluationRequest,
    EvaluationResponse,
    NoteScore,
)

def evaluate_performance(req: EvaluationRequest) -> EvaluationResponse:
    ref_notes = req.reference_notes
    perf_pitches = req.performance_pitches
    tol_cents = req.tolerance_cents

    if not ref_notes:
        return EvaluationResponse(
            pitch_accuracy=0.0,
            timing_accuracy=0.0,
            sequence_accuracy=0.0,
            overall_score=0.0,
            feedback=["No reference notes provided for evaluation."],
            note_scores=[]
        )

    # Filter out low-confidence silence frames
    valid_frames = [p for p in perf_pitches if p.confidence >= 0.45 and p.frequency > 50.0]

    if not valid_frames:
        return EvaluationResponse(
            pitch_accuracy=0.0,
            timing_accuracy=0.0,
            sequence_accuracy=0.0,
            overall_score=0.0,
            feedback=["No vocal pitch detected during the session. Please check microphone input and sing clearly."],
            note_scores=[]
        )

    note_scores: List[NoteScore] = []
    feedback_items: List[str] = []

    pitch_hits = 0
    total_analyzed_frames = 0
    timing_errors_ms: List[float] = []
    notes_attempted = 0

    for note in ref_notes:
        # Collect user frames that occurred during this reference note (with ±0.25s window for acoustic latency & vibrato)
        matching_frames = [
            f for f in valid_frames
            if (note.start - 0.25) <= f.time <= (note.end + 0.25)
        ]

        if not matching_frames:
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
            feedback_items.append(f"Note {note.note_name} at {note.start:.1f}s was not sung or missed.")
            continue

        notes_attempted += 1
        # Timing error on onset (allow 120ms natural acoustic/mic buffer without penalty)
        user_onset = matching_frames[0].time
        raw_onset_diff_ms = (user_onset - note.start) * 1000.0
        effective_onset_err_ms = max(0.0, abs(raw_onset_diff_ms) - 120.0)
        timing_errors_ms.append(effective_onset_err_ms)

        # Pitch error with octave-jump resilience & microtonal vibrato tolerance
        cents_errors = []
        user_midis = []
        effective_tol = max(tol_cents, 60.0)

        for f in matching_frames:
            midi_val = f.midi
            # Auto-correct single-frame harmonic octave lock if pitch class matches
            if abs((midi_val - 12) - note.midi) <= 1.2:
                midi_val -= 12
            elif abs((midi_val + 12) - note.midi) <= 1.2:
                midi_val += 12

            cents_err = (midi_val - note.midi) * 100.0
            cents_errors.append(cents_err)
            user_midis.append(midi_val)
            total_analyzed_frames += 1
            if abs(cents_err) <= effective_tol:
                pitch_hits += 1

        # Use median cents error to avoid transient ornament/transition spikes skewing the note
        avg_cents_err = float(np.median(cents_errors))
        avg_user_midi = float(np.median(user_midis))
        is_hit = abs(avg_cents_err) <= effective_tol

        # Score for this individual note (0 to 100)
        pitch_score = max(0.0, 100.0 - (max(0.0, abs(avg_cents_err) - 15.0) * 1.2))
        timing_score = max(0.0, 100.0 - (min(effective_onset_err_ms, 500.0) / 5.0))
        note_total_score = round(0.75 * pitch_score + 0.25 * timing_score, 1)

        note_scores.append(NoteScore(
            note_id=note.id,
            target_note=note.note_name,
            target_midi=note.midi,
            start=note.start,
            end=note.end,
            user_avg_cents_error=round(avg_cents_err, 1),
            user_detected_midi=round(avg_user_midi, 2),
            is_hit=is_hit,
            score=note_total_score
        ))

        # Actionable feedback
        if abs(avg_cents_err) > effective_tol:
            if avg_cents_err < 0:
                feedback_items.append(
                    f"Note {note.note_name} ({note.start:.1f}s) was ~{abs(avg_cents_err):.0f} cents flat (too low)."
                )
            else:
                feedback_items.append(
                    f"Note {note.note_name} ({note.start:.1f}s) was ~{avg_cents_err:.0f} cents sharp (too high)."
                )

        if effective_onset_err_ms > 180:
            if raw_onset_diff_ms < 0:
                feedback_items.append(
                    f"Note {note.note_name} attacked {abs(raw_onset_diff_ms):.0f}ms too early."
                )
            else:
                feedback_items.append(
                    f"Note {note.note_name} entered {raw_onset_diff_ms:.0f}ms late."
                )

    # 1. Pitch Accuracy: ratio of frames within tolerance
    pitch_accuracy = round((pitch_hits / total_analyzed_frames * 100.0), 1) if total_analyzed_frames > 0 else 0.0

    # 2. Timing Accuracy: average onset alignment
    if timing_errors_ms:
        avg_timing_err = float(np.mean(timing_errors_ms))
        timing_accuracy = round(max(0.0, 100.0 - (avg_timing_err / 3.5)), 1)
    else:
        timing_accuracy = 0.0

    # 3. Sequence Accuracy: percentage of reference notes attempted
    sequence_accuracy = round((notes_attempted / len(ref_notes) * 100.0), 1)

    # 4. Overall Weighted Match Score
    # 55% pitch, 25% timing, 20% sequence
    overall = round(
        0.55 * pitch_accuracy + 0.25 * timing_accuracy + 0.20 * sequence_accuracy,
        1
    )

    if overall >= 85:
        feedback_items.insert(0, "Outstanding performance! Pitch accuracy and rhythm alignment were remarkably precise.")
    elif overall >= 70:
        feedback_items.insert(0, "Good performance! Most notes were on pitch; focus on steadying vibrato and prompt note attacks.")
    elif overall >= 50:
        feedback_items.insert(0, "Solid practice run. Pay special attention to hitting the pitch centers and note transitions.")
    else:
        feedback_items.insert(0, "Keep practicing! Slowing down playback speed (75% or 50%) can help lock in tricky intervals.")

    return EvaluationResponse(
        pitch_accuracy=pitch_accuracy,
        timing_accuracy=timing_accuracy,
        sequence_accuracy=sequence_accuracy,
        overall_score=overall,
        feedback=feedback_items[:8],  # Top 8 most useful feedback points
        note_scores=note_scores
    )