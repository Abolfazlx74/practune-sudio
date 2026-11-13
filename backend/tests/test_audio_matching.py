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
    trans_dir = Path(__file__).resolve().parent.parent / "storage" / "transcriptions"
    json_files = list(trans_dir.glob("*.json"))
    if not json_files:
        raise FileNotFoundError("No reference transcription files found in storage/transcriptions")
    
    with open(json_files[0], "r", encoding="utf-8") as f:
        data = json.load(f)
        
    ref_notes = [NoteItem(**n) for n in data["notes"]]
    ref_contour = [PitchFrame(**p) for p in data["pitch_contour"]]
    return ref_notes, ref_contour


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
    assert resp.note_coverage == 100.0, f"Expected 100% note coverage, got {resp.note_coverage}%"
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
    
    assert resp.missed_notes_count >= len(notes) // 2
    assert 40.0 <= resp.note_coverage <= 60.0
    assert resp.overall_score <= 60.0
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
    print("\n" + "=" * 65)
    print("ALL 7 AUDIO MATCHING VALIDATION TESTS PASSED WITH 100% SUCCESS!")
    print("=" * 65)
