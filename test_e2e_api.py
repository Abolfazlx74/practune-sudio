import urllib.request
import json

def test():
    # 1. Health check
    req = urllib.request.urlopen('http://127.0.0.1:8000/api/health')
    print('1. API Health:', req.read().decode())

    # 2. List Audios
    req = urllib.request.urlopen('http://127.0.0.1:8000/api/audio/list')
    audios = json.loads(req.read().decode())
    print(f'2. Found {len(audios)} existing audios in library')
    audio = audios[0]
    audio_id = audio['id']
    duration = audio['duration']
    print(f'   Selected Audio ID: {audio_id}, Duration: {duration}s')

    # 3. Transcribe Audio
    trans_req = urllib.request.Request(f'http://127.0.0.1:8000/api/audio/{audio_id}/transcribe', data=b'', method='POST')
    trans_resp = urllib.request.urlopen(trans_req)
    trans_data = json.loads(trans_resp.read().decode())
    engine = trans_data['transcription_engine']
    key = trans_data['key_estimate']
    bpm = trans_data['bpm']
    notes = trans_data['notes']
    print(f'3. Transcription Success: Engine={engine}, Key={key}, BPM={bpm}, Notes={len(notes)}')
    for n in notes:
        print(f"   Note {n['note_name']} (MIDI {n['midi']}) {n['start']}s -> {n['end']}s (cents dev: {n['cents_deviation']})")

    # 4. NewTone Pitch Simplification
    corr_payload = json.dumps({'pitch_center_strength': 0.8, 'pitch_variation_reduction': 0.6}).encode('utf-8')
    corr_req = urllib.request.Request(f'http://127.0.0.1:8000/api/audio/{audio_id}/correct', data=corr_payload, headers={'Content-Type': 'application/json'}, method='POST')
    corr_resp = urllib.request.urlopen(corr_req)
    corr_data = json.loads(corr_resp.read().decode())
    print(f"4. Pitch Correction Applied: Notes={len(corr_data['notes'])}")
    print(f"   First note cents before: {notes[0]['cents_deviation']}, after: {corr_data['notes'][0]['cents_deviation']}")

    # 5. Practice Evaluation
    eval_payload = json.dumps({
        'reference_notes': notes,
        'performance_pitches': [
            {'time': n['start'] + 0.04, 'frequency': n['frequency'], 'midi': float(n['midi']) + 0.08, 'confidence': 0.95}
            for n in notes
        ],
        'tolerance_cents': 50.0
    }).encode('utf-8')
    eval_req = urllib.request.Request('http://127.0.0.1:8000/api/practice/evaluate', data=eval_payload, headers={'Content-Type': 'application/json'}, method='POST')
    eval_resp = urllib.request.urlopen(eval_req)
    eval_data = json.loads(eval_resp.read().decode())
    print(f"5. Practice Evaluation: Score={eval_data['overall_score']}%, PitchAcc={eval_data['pitch_accuracy']}%, TimingAcc={eval_data['timing_accuracy']}%")
    print(f"   Feedback item: {eval_data['feedback'][0]}")

    # 6. MIDI & MusicXML Exports
    midi_req = urllib.request.Request(f'http://127.0.0.1:8000/api/audio/{audio_id}/export/midi', data=b'', method='POST')
    midi_resp = urllib.request.urlopen(midi_req)
    midi_bytes = midi_resp.read()
    print(f'6. MIDI Export Status: {midi_resp.status}, Content-Length: {len(midi_bytes)} bytes')

    xml_req = urllib.request.Request(f'http://127.0.0.1:8000/api/audio/{audio_id}/export/musicxml', data=b'', method='POST')
    xml_resp = urllib.request.urlopen(xml_req)
    xml_bytes = xml_resp.read()
    print(f'7. MusicXML Export Status: {xml_resp.status}, Content-Length: {len(xml_bytes)} bytes')

    print('\nALL END-TO-END WORKFLOW CHECKS COMPLETED SUCCESSFULLY!')

if __name__ == '__main__':
    test()
