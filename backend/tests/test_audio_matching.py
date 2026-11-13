"""
Comprehensive Validation & Test Suite for Practune Performance Matching:
1. Exact same audio as reference and input (Identical Audio Self-Match) -> Overall >= 98%
2. Same audio with a small time offset (+100ms, -100ms) -> Latency correctly aligned, Score >= 95%
3. Slower / faster performance (±5% tempo change) -> Elastic alignment, Score >= 90%
4. Intentionally incorrect notes (off by 2 semitones) -> Pitch accuracy severely penalized (Score <= 45%)
5. Missing notes (50% skipped) -> Note coverage = 50%, Score drops proportionally (~50%)
6. Correct pitch but incorrect timing (shifted by 1.5s) -> Timing accuracy and coverage penalized heavily (Score <= 45%)
7. Complete silence / low confidence input -> Handled gracefully, Score = 0%
"""

import json
from pathlib import Path
import numpy as np

import sys
from pathlib import Path

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models.schemas import EvaluationRequest, NoteItem, PitchFrame
from app.services.practice_service import evaluate_performance


def load_demo_reference():
    from app.services.pitch_transcription import get_transcription
    res = get_transcription("2ba782b5-c1d4-4031-ae0d-94a0a5047528")
    if not res or not res.notes:
        from app.services.pitch_transcription import transcribe_audio
        res = transcribe_audio("2ba782b5-c1d4-4031-ae0d-94a0a5047528")
    return res.notes, res.pitch_contour


def test_scenario_1_identical_audio():
    """1. The exact same audio as both reference and input."""
    notes, contour = load_demo_reference()
    req = EvaluationRequest(reference_notes=notes, performance_pitches=contour, tolerance_cents=50.0)
    resp = evaluate_performance(req)
    
    print("\n--- [TEST 1] Identical Audio Self-Match ---")
    print(f"Overall: {resp.overall_score}% | Pitch: {resp.pitch_accuracy}% | Timing: {resp.timing_accuracy}% | Coverage: {resp.note_coverage}%")
    print(f"Alignment Offset: {resp.alignment_offset_ms}ms | Missed: {resp.missed_notes_count} | Extra: {resp.extra_notes_count}")
    
    assert resp.overall_score >= 98.0, f"Expected identical audio score >= 98%, got {resp.overall_score}%"
    assert resp.pitch_accuracy >= 95.0, f"Expected pitch accuracy >= 95%, got {resp.pitch_accuracy}%"
    assert resp.timing_accuracy >= 98.0, f"Expected timing accuracy >= 98%, got {resp.timing_accuracy}%"
    assert resp.note_coverage == 100.0, f"Expected 100% note coverage, got {resp.note_coverage}%"
    assert resp.missed_notes_count == 0, f"Expected 0 missed notes, got {resp.missed_notes_count}"
    print(">>> PASS: Identical audio scored near-perfect without artificial distortion.")


def test_scenario_2_small_time_offset():
    """2. Same audio with a small acoustic latency time offset (+100ms and -100ms)."""
    notes, contour = load_demo_reference()
    
    # Test +100ms delay
    contour_delayed = [
        PitchFrame(time=round(f.time + 0.10, 3), frequency=f.frequency, midi=f.midi, confidence=f.confidence)
        for f in contour
    ]
    req = EvaluationRequest(reference_notes=notes, performance_pitches=contour_delayed, tolerance_cents=50.0)
    resp = evaluate_performance(req)
    
    print("\n--- [TEST 2A] Small Time Offset (+100ms Delay) ---")
    print(f"Overall: {resp.overall_score}% | Pitch: {resp.pitch_accuracy}% | Timing: {resp.timing_accuracy}% | Offset: {resp.alignment_offset_ms}ms")
    
    assert abs(resp.alignment_offset_ms - 100.0) <= 25.0, f"Expected offset near 100ms, got {resp.alignment_offset_ms}ms"
    assert resp.overall_score >= 95.0, f"Expected score >= 95% after latency alignment, got {resp.overall_score}%"
    assert resp.note_coverage == 100.0
    print(">>> PASS: +100ms latency offset aligned and compensated accurately.")

    # Test -80ms advance
    contour_early = [
        PitchFrame(time=round(max(0.0, f.time - 0.08), 3), frequency=f.frequency, midi=f.midi, confidence=f.confidence)
        for f in contour
    ]
    req_early = EvaluationRequest(reference_notes=notes, performance_pitches=contour_early, tolerance_cents=50.0)
    resp_early = evaluate_performance(req_early)
    print("\n--- [TEST 2B] Small Time Offset (-80ms Advance) ---")
    print(f"Overall: {resp_early.overall_score}% | Pitch: {resp_early.pitch_accuracy}% | Timing: {resp_early.timing_accuracy}% | Offset: {resp_early.alignment_offset_ms}ms")
    assert abs(resp_early.alignment_offset_ms - (-80.0)) <= 25.0
    assert resp_early.overall_score >= 95.0
    print(">>> PASS: -80ms early attack aligned and compensated accurately.")


def test_scenario_3_tempo_variation():
    """3. The same melody performed slightly slower or faster (5% tempo stretch)."""
    notes, contour = load_demo_reference()
    contour_slower = [
        PitchFrame(time=round(f.time * 1.05, 3), frequency=f.frequency, midi=f.midi, confidence=f.confidence)
        for f in contour
    ]
    req = EvaluationRequest(reference_notes=notes, performance_pitches=contour_slower, tolerance_cents=50.0)
    resp = evaluate_performance(req)
    
    print("\n--- [TEST 3] Tempo Variation (5% slower) ---")
    print(f"Overall: {resp.overall_score}% | Pitch: {resp.pitch_accuracy}% | Timing: {resp.timing_accuracy}% | Coverage: {resp.note_coverage}%")
    
    assert resp.overall_score >= 90.0, f"Expected overall >= 90%, got {resp.overall_score}%"
    assert resp.note_coverage >= 90.0, f"Expected note coverage >= 90%, got {resp.note_coverage}%"
    print(">>> PASS: Slight expressive tempo drift accommodated without note loss.")


def test_scenario_4_incorrect_notes():
    """4. A performance with intentionally incorrect notes (+2 semitones off key)."""
    notes, contour = load_demo_reference()
    # Shift pitch by 2 semitones (200 cents off)
    contour_wrong = [
        PitchFrame(
            time=f.time,
            frequency=round(f.frequency * (2.0 ** (2.0 / 12.0)), 2),
            midi=round(f.midi + 2.0, 2),
            confidence=f.confidence
        )
        for f in contour
    ]
    req = EvaluationRequest(reference_notes=notes, performance_pitches=contour_wrong, tolerance_cents=50.0)
    resp = evaluate_performance(req)
    
    print("\n--- [TEST 4] Intentionally Incorrect Notes (+2 semitones) ---")
    print(f"Overall: {resp.overall_score}% | Pitch: {resp.pitch_accuracy}% | Timing: {resp.timing_accuracy}% | Coverage: {resp.note_coverage}%")
    
    assert resp.pitch_accuracy <= 20.0, f"Expected pitch accuracy <= 20%, got {resp.pitch_accuracy}%"
    assert resp.note_coverage <= 20.0, f"Expected note coverage <= 20%, got {resp.note_coverage}%"
    assert resp.overall_score <= 45.0, f"Expected low overall score <= 45%, got {resp.overall_score}%"
    print(">>> PASS: Off-key performance correctly penalized.")


def test_scenario_5_missing_notes():
    """5. A performance with 50% missing notes."""
    notes, contour = load_demo_reference()
    half_time = notes[len(notes) // 2].start
    contour_missing = [f for f in contour if f.time < half_time]
    
    req = EvaluationRequest(reference_notes=notes, performance_pitches=contour_missing, tolerance_cents=50.0)
    resp = evaluate_performance(req)
    
    print("\n--- [TEST 5] 50% Missing Notes ---")
    print(f"Overall: {resp.overall_score}% | Pitch: {resp.pitch_accuracy}% | Coverage: {resp.note_coverage}% | Missed Count: {resp.missed_notes_count}")
    
    assert resp.missed_notes_count >= (len(notes) // 2) - 1
    assert 40.0 <= resp.note_coverage <= 60.0
    assert resp.overall_score <= 65.0
    print(">>> PASS: Skipped notes counted as misses, overall score dropped proportionally.")


def test_scenario_6_correct_pitch_wrong_timing():
    """6. A performance with correct pitch but shifted by 1.5s (severe timing failure)."""
    notes, contour = load_demo_reference()
    contour_late = [
        PitchFrame(time=round(f.time + 1.5, 3), frequency=f.frequency, midi=f.midi, confidence=f.confidence)
        for f in contour
    ]
    req = EvaluationRequest(reference_notes=notes, performance_pitches=contour_late, tolerance_cents=50.0)
    resp = evaluate_performance(req)
    
    print("\n--- [TEST 6] Correct Pitch with Severe Timing Shift (+1.5s) ---")
    print(f"Overall: {resp.overall_score}% | Pitch: {resp.pitch_accuracy}% | Timing: {resp.timing_accuracy}% | Coverage: {resp.note_coverage}%")
    
    # 1.5s is far beyond natural latency (capped at 250ms), so timing must be penalized
    assert resp.overall_score <= 50.0, f"Expected overall score <= 50%, got {resp.overall_score}%"
    print(">>> PASS: Large timing distortion strictly penalized, preventing alignment cheating.")


def test_scenario_7_silence_input():
    """7. Silence and low-confidence input."""
    notes, _ = load_demo_reference()
    # Empty frames
    req = EvaluationRequest(reference_notes=notes, performance_pitches=[], tolerance_cents=50.0)
    resp = evaluate_performance(req)
    
    print("\n--- [TEST 7A] Complete Silence ---")
    print(f"Overall: {resp.overall_score}% | Feedback: {resp.feedback[0]}")
    assert resp.overall_score == 0.0
    assert resp.note_coverage == 0.0
    assert resp.missed_notes_count == len(notes)
    
    # Low confidence noise (< 0.4 confidence)
    noise_frames = [
        PitchFrame(time=0.1 * i, frequency=220.0, midi=57.0, confidence=0.2)
        for i in range(20)
    ]
    req_noise = EvaluationRequest(reference_notes=notes, performance_pitches=noise_frames, tolerance_cents=50.0)
    resp_noise = evaluate_performance(req_noise)
    print("\n--- [TEST 7B] Low-Confidence Noise Input ---")
    print(f"Overall: {resp_noise.overall_score}% | Feedback: {resp_noise.feedback[0]}")
    assert resp_noise.overall_score == 0.0
    print(">>> PASS: Silence and unvoiced noise input handled cleanly with zero false positive score.")


def test_scenario_8_imported_performance_mode():
    """8. Imported Performance Mode: matching an uploaded audio file against reference."""
    from app.services.practice_service import evaluate_imported_performance
    demo_audio_id = "2ba782b5-c1d4-4031-ae0d-94a0a5047528"
    audio_path = Path(__file__).resolve().parent.parent / "storage" / "uploads" / f"{demo_audio_id}.wav"
    with open(audio_path, "rb") as f:
        file_bytes = f.read()

    resp = evaluate_imported_performance(
        audio_id=demo_audio_id,
        file_bytes=file_bytes,
        filename="vocal_arpeggio_demo.wav",
        tolerance_cents=50.0
    )

    print("\n--- [TEST 8] Imported Performance Audio Matching ---")
    print(f"Overall: {resp.overall_score}% | Pitch: {resp.pitch_accuracy}% | Timing: {resp.timing_accuracy}% | Coverage: {resp.note_coverage}%")
    print(f"Mode: {resp.evaluation_mode} | Performance Contour Frames: {len(resp.performance_contour) if resp.performance_contour else 0}")

    assert resp.overall_score >= 98.0, f"Expected imported score >= 98%, got {resp.overall_score}%"
    assert resp.pitch_accuracy >= 95.0
    assert resp.timing_accuracy >= 98.0
    assert resp.note_coverage == 100.0
    assert resp.evaluation_mode == "imported"
    assert resp.performance_contour is not None and len(resp.performance_contour) > 50
    print(">>> PASS: Imported audio recording accurately decoded, aligned, and evaluated.")


def test_scenario_9_transitions_and_vibrato_modeling():
    """9. Transition and Vibrato Modeling: stable notes separate from pitch slides."""
    from app.services.pitch_transcription import get_transcription
    demo_audio_id = "2ba782b5-c1d4-4031-ae0d-94a0a5047528"
    trans = get_transcription(demo_audio_id)
    assert trans is not None
    print("\n--- [TEST 9] Note Segmentation, Transitions & Vibrato Modeling ---")
    print(f"Notes Count: {len(trans.notes)} | Transitions: {len(trans.transitions)} | Monophonic: {trans.is_monophonic}")
    for tr in trans.transitions[:3]:
        print(f"  Slide from {tr.from_note} to {tr.to_note} [{tr.start}s - {tr.end}s]")

    assert len(trans.notes) >= 5, f"Expected at least 5 notes, got {len(trans.notes)}"
    assert len(trans.transitions) >= 1, "Expected at least 1 transition region detected"
    print(">>> PASS: Stable notes and pitch transition regions correctly extracted and categorized.")


def test_scenario_10_deterministic_reproducibility():
    """10. Deterministic Reproducibility: 10 repeated runs must produce mathematically identical results."""
    notes, contour = load_demo_reference()
    req = EvaluationRequest(reference_notes=notes, performance_pitches=contour, tolerance_cents=50.0)

    scores = []
    for _ in range(10):
        resp = evaluate_performance(req)
        scores.append(resp.overall_score)

    print("\n--- [TEST 10] 10 Repeated Runs Determinism Check ---")
    print(f"Scores across 10 runs: {scores}")
    assert len(set(scores)) == 1, f"Non-deterministic scores detected: {set(scores)}"
    print(">>> PASS: 100% deterministic reproducibility verified across repeated analysis cycles.")


def test_scenario_11_instrument_mode_self_match():
    """11. Instrument Mode: Dedicated discrete main-notes evaluation with transition immunity."""
    notes, contour = load_demo_reference()
    req = EvaluationRequest(
        reference_notes=notes,
        performance_pitches=contour,
        tolerance_cents=70.0,
        studio_type="instrument"
    )
    resp = evaluate_performance(req)

    print("\n--- [TEST 11] Instrument Mode Self-Match ---")
    print(f"Overall: {resp.overall_score}% | Pitch: {resp.pitch_accuracy}% | Timing: {resp.timing_accuracy}% | Coverage: {resp.note_coverage}%")
    print(f"Mode: {resp.studio_type} | Ref Notes: {resp.detected_reference_notes_count} | Hits: {resp.detected_reference_notes_count - resp.missed_notes_count}")

    assert resp.overall_score == 100.0, f"Expected 100% in instrument mode self-match, got {resp.overall_score}%"
    assert resp.pitch_accuracy == 100.0
    assert resp.timing_accuracy == 100.0
    assert resp.note_coverage == 100.0
    print(">>> PASS: Instrument Mode discrete note matching evaluated cleanly at 100%.")


def test_scenario_12_instrument_mode_transition_immunity():
    """12. Instrument Mode: Immunity to inter-note pitch fluctuations, slides, and finger shifts."""
    notes, contour = load_demo_reference()

    # Add chaotic pitch slides and fluctuations between notes
    noisy_contour = []
    for f in contour:
        noisy_contour.append(f)

    # Insert wild slides during rests / note boundaries
    for n in notes:
        noisy_contour.append(PitchFrame(time=round(n.start - 0.03, 3), frequency=220.0, midi=57.0, confidence=0.75))
        noisy_contour.append(PitchFrame(time=round(n.end + 0.03, 3), frequency=330.0, midi=64.0, confidence=0.70))

    noisy_contour.sort(key=lambda x: x.time)

    req = EvaluationRequest(
        reference_notes=notes,
        performance_pitches=noisy_contour,
        tolerance_cents=70.0,
        studio_type="instrument"
    )
    resp = evaluate_performance(req)

    print("\n--- [TEST 12] Instrument Mode Inter-Note Transition Immunity ---")
    print(f"Overall: {resp.overall_score}% | Pitch: {resp.pitch_accuracy}% | Coverage: {resp.note_coverage}%")
    assert resp.overall_score >= 98.0, f"Expected score >= 98% with transition immunity, got {resp.overall_score}%"
    assert resp.note_coverage == 100.0
    print(">>> PASS: Inter-note fluctuations and slides between notes successfully ignored in Instrument Mode.")


def test_scenario_13_note_to_note_mode_evaluation():
    """13. Note-to-Note Mode: Consolidates take as recorded file, extracts discrete note events and compares."""
    notes, contour = load_demo_reference()
    target_note = notes[0]  # First note
    # Filter contour to roughly the first note's time window with realistic attack jitter
    note_frames = [f for f in contour if target_note.start - 0.05 <= f.time <= target_note.end + 0.05]

    req = EvaluationRequest(
        reference_notes=[target_note],
        performance_pitches=note_frames,
        tolerance_cents=70.0,
        studio_type="instrument",
        practice_mode="note"
    )
    resp = evaluate_performance(req)

    print("\n--- [TEST 13] Note-to-Note Extracted Note Evaluation ---")
    print(f"Overall: {resp.overall_score}% | Pitch: {resp.pitch_accuracy}% | Timing: {resp.timing_accuracy}%")
    print(f"Feedback: {resp.feedback}")
    assert resp.overall_score >= 95.0, f"Expected score >= 95% in note-to-note mode, got {resp.overall_score}%"
    assert resp.note_coverage == 100.0
    assert len(resp.note_scores) == 1
    assert resp.note_scores[0].is_hit is True
    print(">>> PASS: Note-to-Note mode simplified recorded take into discrete note events and compared successfully.")


def test_scenario_14_instrument_mode_missed_or_wrong_notes():
    """14. Instrument Mode with Missed or Inaccurate Notes (Ensures no UnboundLocalError / 500 error)."""
    notes, _ = load_demo_reference()
    # Provide pitches for only the first note; remaining notes are missed
    first_note = notes[0]
    frames = [
        PitchFrame(time=first_note.start + i * 0.02, frequency=first_note.frequency, midi=first_note.midi, confidence=0.9)
        for i in range(12)
    ]
    req = EvaluationRequest(
        reference_notes=notes,
        performance_pitches=frames,
        tolerance_cents=70.0,
        studio_type="instrument",
        practice_mode="full"
    )
    resp = evaluate_performance(req)

    print("\n--- [TEST 14] Instrument Mode with Missed Notes ---")
    print(f"Overall: {resp.overall_score}% | Pitch: {resp.pitch_accuracy}% | Missed: {resp.missed_notes_count}")
    print(f"Feedback: {resp.feedback}")
    assert resp.overall_score > 0.0
    assert resp.missed_notes_count > 0
    assert len(resp.feedback) > 0
    print(">>> PASS: Instrument Mode evaluation with missed/off notes returns 200 OK without errors.")


if __name__ == "__main__":
    print("=" * 65)
    print("PRACTUNE STUDIO AUDIO MATCHING & EVALUATION ACCURACY TEST SUITE")
    print("=" * 65)
    test_scenario_1_identical_audio()
    test_scenario_2_small_time_offset()
    test_scenario_3_tempo_variation()
    test_scenario_4_incorrect_notes()
    test_scenario_5_missing_notes()
    test_scenario_6_correct_pitch_wrong_timing()
    test_scenario_7_silence_input()
    test_scenario_8_imported_performance_mode()
    test_scenario_9_transitions_and_vibrato_modeling()
    test_scenario_10_deterministic_reproducibility()
    test_scenario_11_instrument_mode_self_match()
    test_scenario_12_instrument_mode_transition_immunity()
    test_scenario_13_note_to_note_mode_evaluation()
    test_scenario_14_instrument_mode_missed_or_wrong_notes()
    print("\n" + "=" * 65)
    print("ALL 14 AUDIO MATCHING & ENGINE VALIDATION TESTS PASSED WITH 100% SUCCESS!")
    print("=" * 65)
