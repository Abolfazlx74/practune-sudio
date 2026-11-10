import copy
from typing import List, Tuple
import numpy as np
from ..models.schemas import TranscriptionResult, NoteItem, PitchFrame, CorrectionRequest
from .pitch_transcription import midi_to_note_info, NOTE_NAMES

def simplify_and_correct_pitch(
    transcription: TranscriptionResult,
    options: CorrectionRequest
) -> TranscriptionResult:
    """
    Non-destructive NewTone-inspired pitch correction:
    - Pitch Center: pulls pitches closer to exact semitones by factor 'pitch_center_strength'
    - Pitch Variation: smooths fluctuations/vibrato within notes by factor 'pitch_variation_reduction'
    """
    center_strength = float(np.clip(options.pitch_center_strength, 0.0, 1.0))
    variation_reduction = float(np.clip(options.pitch_variation_reduction, 0.0, 1.0))

    # Deep copy so original is completely preserved
    corrected_result = transcription.model_copy(deep=True)

    # 1. Correct discrete notes
    corrected_notes: List[NoteItem] = []
    for note in corrected_result.notes:
        new_note = note.model_copy(deep=True)
        # Pull cents deviation towards 0 based on center_strength
        new_cents = round(note.cents_deviation * (1.0 - center_strength), 1)
        new_note.cents_deviation = new_cents
        corrected_notes.append(new_note)

    corrected_result.notes = corrected_notes

    # 2. Correct continuous pitch contour
    if corrected_result.pitch_contour:
        corrected_frames: List[PitchFrame] = []
        midi_values = np.array([f.midi for f in corrected_result.pitch_contour])

        # A) Pitch Center Snap: attraction toward nearest integer MIDI note
        nearest_integers = np.round(midi_values)
        centered_midis = midi_values + center_strength * (nearest_integers - midi_values)

        # B) Pitch Variation Reduction: moving average / smoothing filter within sustained regions
        if variation_reduction > 0.0:
            window_size = int(3 + variation_reduction * 10)  # 3 to 13 frames
            if window_size % 2 == 0:
                window_size += 1
            # Moving average with padding
            kernel = np.ones(window_size) / window_size
            smoothed_midis = np.convolve(centered_midis, kernel, mode="same")
            final_midis = centered_midis * (1.0 - variation_reduction) + smoothed_midis * variation_reduction
        else:
            final_midis = centered_midis

        for frame, final_m in zip(corrected_result.pitch_contour, final_midis):
            # Compute new frequency from adjusted MIDI pitch: f = 440 * 2^((m - 69)/12)
            new_freq = 440.0 * (2.0 ** ((final_m - 69.0) / 12.0))
            corrected_frames.append(PitchFrame(
                time=frame.time,
                frequency=round(float(new_freq), 2),
                midi=round(float(final_m), 2),
                confidence=frame.confidence
            ))

        corrected_result.pitch_contour = corrected_frames

    return corrected_result
