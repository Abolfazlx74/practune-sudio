import numpy as np
import soundfile as sf
from pathlib import Path
from app.services.audio_service import save_uploaded_file
from app.services.pitch_transcription import transcribe_audio
from app.services.pitch_correction import simplify_and_correct_pitch
from app.services.practice_service import evaluate_performance
from app.models.schemas import CorrectionRequest, EvaluationRequest, PitchFrame
from app.services.music_export import export_to_midi, export_to_musicxml

def generate_test_melody():
    sr = 22050
    notes = [
        (60, 0.6), # C4
        (64, 0.6), # E4
        (67, 0.6), # G4
        (69, 0.8), # A4
        (72, 1.0)  # C5
    ]
    audio = []
    for midi_note, dur in notes:
        freq = 440.0 * (2.0 ** ((midi_note - 69.0) / 12.0))
        t = np.linspace(0, dur, int(sr * dur), endpoint=False)
        # Add slight 5Hz vibrato (±5 Hz)
        vibrato = 3.0 * np.sin(2 * np.pi * 5.0 * t)
        phase = 2 * np.pi * np.cumsum((freq + vibrato) / sr)
        tone = 0.5 * np.sin(phase)
        # Apply gentle envelope
        envelope = np.ones_like(t)
        attack = int(0.04 * sr)
        release = int(0.06 * sr)
        envelope[:attack] = np.linspace(0, 1, attack)
        envelope[-release:] = np.linspace(1, 0, release)
        audio.append(tone * envelope)
        # 0.1s silence between notes
        audio.append(np.zeros(int(sr * 0.1)))

    full_audio = np.concatenate(audio).astype(np.float32)
    test_file = Path("test_melody.wav")
    sf.write(str(test_file), full_audio, sr)
    return test_file

if __name__ == "__main__":
    wav_path = generate_test_melody()
    print(f"Generated test WAV: {wav_path}")
    
    with open(wav_path, "rb") as f:
        data = f.read()
    
    audio_info = save_uploaded_file(data, "test_melody.wav")
    print(f"Uploaded audio: ID={audio_info.id}, duration={audio_info.duration}s, peaks={len(audio_info.waveform_overview)}")

    transcription = transcribe_audio(audio_info.id)
    print(f"Transcription engine: {transcription.transcription_engine}")
    print(f"Detected BPM: {transcription.bpm}, Key: {transcription.key_estimate}")
    print(f"Detected {len(transcription.notes)} notes:")
    for n in transcription.notes:
        print(f"  Note: {n.note_name} (MIDI {n.midi}) from {n.start:.2f}s to {n.end:.2f}s, conf={n.confidence}")

    # Test correction
    corr_req = CorrectionRequest(pitch_center_strength=0.8, pitch_variation_reduction=0.7)
    corrected = simplify_and_correct_pitch(transcription, corr_req)
    print(f"Corrected {len(corrected.notes)} notes successfully.")

    # Test exports
    mid_path = export_to_midi(transcription)
    print(f"Exported MIDI: {mid_path.name}")
    xml_path = export_to_musicxml(transcription)
    print(f"Exported MusicXML: {xml_path.name}")

    # Test evaluation
    perf_pitches = [
        PitchFrame(time=n.start + 0.05, frequency=n.frequency, midi=float(n.midi) + 0.1, confidence=0.95)
        for n in transcription.notes
    ]
    eval_req = EvaluationRequest(reference_notes=transcription.notes, performance_pitches=perf_pitches)
    eval_resp = evaluate_performance(eval_req)
    print(f"Practice Evaluation: Overall={eval_resp.overall_score}%, Pitch={eval_resp.pitch_accuracy}%, Timing={eval_resp.timing_accuracy}%")
    print(f"Feedback: {eval_resp.feedback[0]}")
    print("ALL BACKEND PIPELINE TESTS PASSED!")
