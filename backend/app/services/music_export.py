import os
from pathlib import Path
from typing import List, Optional
import xml.etree.ElementTree as ET
from xml.dom import minidom
import mido

from ..config import EXPORTS_DIR
from ..models.schemas import TranscriptionResult, NoteItem

def export_to_midi(transcription: TranscriptionResult) -> Path:
    out_path = EXPORTS_DIR / f"{transcription.audio_id}.mid"
    
    mid = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    mid.tracks.append(track)

    bpm = transcription.bpm or 120.0
    tempo = mido.bpm2tempo(bpm)
    track.append(mido.MetaMessage('set_tempo', tempo=tempo, time=0))
    track.append(mido.MetaMessage('track_name', name='Practune Melody', time=0))

    # Convert notes to MIDI events
    # Each note has start and end times in seconds
    events = []
    for note in transcription.notes:
        events.append(('note_on', note.start, note.midi, int(note.confidence * 100 + 27)))
        events.append(('note_off', note.end, note.midi, 0))

    # Sort events by time
    events.sort(key=lambda x: (x[1], 0 if x[0] == 'note_off' else 1))

    # Calculate delta time in ticks: ticks = seconds * (ticks_per_beat * (bpm / 60))
    ticks_per_second = 480 * (bpm / 60.0)
    last_tick = 0

    for evt_type, time_sec, midi_val, vel in events:
        current_tick = int(time_sec * ticks_per_second)
        delta_ticks = max(0, current_tick - last_tick)
        if evt_type == 'note_on':
            track.append(mido.Message('note_on', note=int(midi_val), velocity=min(127, vel), time=delta_ticks))
        else:
            track.append(mido.Message('note_off', note=int(midi_val), velocity=0, time=delta_ticks))
        last_tick = current_tick

    mid.save(str(out_path))
    return out_path

def export_to_musicxml(transcription: TranscriptionResult) -> Path:
    out_path = EXPORTS_DIR / f"{transcription.audio_id}.musicxml"

    score = ET.Element('score-partwise', version='3.1')
    
    # Work and Title
    work = ET.SubElement(score, 'work')
    work_title = ET.SubElement(work, 'work-title')
    work_title.text = f"Practune Transcription - {transcription.audio_id[:8]}"

    # Part list
    part_list = ET.SubElement(score, 'part-list')
    score_part = ET.SubElement(part_list, 'score-part', id='P1')
    part_name = ET.SubElement(score_part, 'part-name')
    part_name.text = 'Vocal / Solo'

    # Part
    part = ET.SubElement(score, 'part', id='P1')

    # Group notes into measures based on estimated BPM and 4/4 time
    bpm = transcription.bpm or 120.0
    sec_per_beat = 60.0 / bpm
    sec_per_measure = sec_per_beat * 4.0

    # Attributes in measure 1
    measure_num = 1
    current_measure = ET.SubElement(part, 'measure', number=str(measure_num))

    attrs = ET.SubElement(current_measure, 'attributes')
    divisions = ET.SubElement(attrs, 'divisions')
    divisions.text = '4'  # 4 divisions per quarter note (16th note resolution)

    time_elem = ET.SubElement(attrs, 'time')
    beats = ET.SubElement(time_elem, 'beats')
    beats.text = '4'
    beat_type = ET.SubElement(time_elem, 'beat-type')
    beat_type.text = '4'

    clef = ET.SubElement(attrs, 'clef')
    sign = ET.SubElement(clef, 'sign')
    sign.text = 'G'
    line = ET.SubElement(clef, 'line')
    line.text = '2'

    current_measure_end = sec_per_measure

    for note in transcription.notes:
        if note.start >= current_measure_end:
            # Advance measures
            while note.start >= current_measure_end:
                measure_num += 1
                current_measure_end += sec_per_measure
                current_measure = ET.SubElement(part, 'measure', number=str(measure_num))

        note_elem = ET.SubElement(current_measure, 'note')
        pitch_elem = ET.SubElement(note_elem, 'pitch')
        
        step_str = note.note_name[0]
        step_elem = ET.SubElement(pitch_elem, 'step')
        step_elem.text = step_str

        if '#' in note.note_name:
            alter = ET.SubElement(pitch_elem, 'alter')
            alter.text = '1'

        octave_elem = ET.SubElement(pitch_elem, 'octave')
        octave_elem.text = str(note.octave)

        # Duration in divisions: note.duration / sec_per_beat * 4
        dur_divs = max(1, int(round((note.duration / sec_per_beat) * 4)))
        dur_elem = ET.SubElement(note_elem, 'duration')
        dur_elem.text = str(dur_divs)

        # Type (quarter, eighth, etc.)
        type_elem = ET.SubElement(note_elem, 'type')
        if dur_divs >= 16:
            type_elem.text = 'whole'
        elif dur_divs >= 8:
            type_elem.text = 'half'
        elif dur_divs >= 4:
            type_elem.text = 'quarter'
        elif dur_divs >= 2:
            type_elem.text = 'eighth'
        else:
            type_elem.text = '16th'

    # Format pretty XML
    xml_str = ET.tostring(score, encoding='utf-8')
    dom = minidom.parseString(xml_str)
    pretty_xml = dom.toprettyxml(indent="  ")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(pretty_xml)

    return out_path
