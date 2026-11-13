import os
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import UPLOADS_DIR, PROCESSED_DIR, EXPORTS_DIR
from .models.schemas import (
    AudioInfo,
    PreprocessRequest,
    TrimRequest,
    TranscriptionResult,
    CorrectionRequest,
    EvaluationRequest,
    EvaluationResponse,
)
from .services.audio_service import (
    save_uploaded_file,
    get_audio_info,
    get_audio_filepath,
    list_all_audios,
)
from .services.dsp_service import apply_preprocessing, trim_audio
from .services.pitch_transcription import transcribe_audio, get_transcription
from .services.pitch_correction import simplify_and_correct_pitch
from .services.practice_service import evaluate_performance, evaluate_imported_performance
from .services.music_export import export_to_midi, export_to_musicxml

app = FastAPI(
    title="Practune AI Music Analysis & Learning Studio API",
    version="1.0.0",
    description="Backend API for audio analysis, transcription, DSP preprocessing, and practice evaluation."
)

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {
        "service": "Practune AI Music Analysis & Learning Studio API",
        "status": "online",
        "frontend_ui_url": "http://127.0.0.1:5173",
        "api_documentation": "http://127.0.0.1:8000/docs",
        "endpoints": {
            "health": "/api/health",
            "audio_list": "/api/audio/list",
            "upload": "/api/audio/upload",
            "transcribe": "/api/audio/{audio_id}/transcribe",
            "evaluate": "/api/practice/evaluate"
        }
    }

@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "Practune API"}

@app.get("/api/audio/list", response_model=List[AudioInfo])
def get_recent_audios():
    return list_all_audios()

@app.post("/api/audio/upload", response_model=AudioInfo)
async def upload_audio(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        audio_info = save_uploaded_file(contents, file.filename or "upload.wav")
        return audio_info
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process upload: {str(e)}")

@app.get("/api/audio/{audio_id}", response_model=AudioInfo)
def get_audio(audio_id: str):
    info = get_audio_info(audio_id)
    if not info:
        raise HTTPException(status_code=404, detail="Audio file not found")
    return info

@app.get("/api/audio/{audio_id}/file")
def get_audio_stream(audio_id: str):
    filepath = get_audio_filepath(audio_id)
    if not filepath or not filepath.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk")
    
    # Determine media type
    ext = filepath.suffix.lower()
    media_types = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg"
    }
    media_type = media_types.get(ext, "application/octet-stream")
    return FileResponse(path=str(filepath), media_type=media_type, filename=filepath.name)

@app.post("/api/audio/{audio_id}/preprocess", response_model=AudioInfo)
def preprocess_audio(audio_id: str, request: PreprocessRequest):
    try:
        processed_info = apply_preprocessing(audio_id, request)
        return processed_info
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Source audio file not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preprocessing failed: {str(e)}")

@app.post("/api/audio/{audio_id}/trim", response_model=AudioInfo)
def trim_audio_endpoint(audio_id: str, request: TrimRequest):
    try:
        trimmed_info = trim_audio(audio_id, request.start_time, request.end_time)
        return trimmed_info
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Source audio file not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Trimming failed: {str(e)}")

@app.post("/api/audio/{audio_id}/transcribe", response_model=TranscriptionResult)
def run_transcription(audio_id: str):
    try:
        result = transcribe_audio(audio_id)
        return result
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Audio file not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

@app.get("/api/audio/{audio_id}/transcription", response_model=TranscriptionResult)
def fetch_transcription(audio_id: str):
    result = get_transcription(audio_id)
    if not result:
        # If not cached yet, run transcription
        try:
            return transcribe_audio(audio_id)
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"Transcription not found: {str(e)}")
    return result

@app.post("/api/audio/{audio_id}/correct", response_model=TranscriptionResult)
def correct_pitch(audio_id: str, request: CorrectionRequest):
    transcription = get_transcription(audio_id)
    if not transcription:
        try:
            transcription = transcribe_audio(audio_id)
        except Exception as e:
            raise HTTPException(status_code=404, detail="Transcription not found")
    
    corrected = simplify_and_correct_pitch(transcription, request)
    return corrected

@app.post("/api/audio/{audio_id}/export/midi")
def export_midi(audio_id: str):
    transcription = get_transcription(audio_id)
    if not transcription:
        raise HTTPException(status_code=404, detail="Transcription not found")
    midi_path = export_to_midi(transcription)
    return FileResponse(path=str(midi_path), filename=f"{transcription.audio_id}.mid", media_type="audio/midi")

@app.post("/api/audio/{audio_id}/export/musicxml")
def export_musicxml(audio_id: str):
    transcription = get_transcription(audio_id)
    if not transcription:
        raise HTTPException(status_code=404, detail="Transcription not found")
    xml_path = export_to_musicxml(transcription)
    return FileResponse(path=str(xml_path), filename=f"{transcription.audio_id}.musicxml", media_type="application/vnd.recordare.musicxml+xml")

@app.post("/api/practice/evaluate", response_model=EvaluationResponse)
def evaluate_user_practice(request: EvaluationRequest):
    try:
        response = evaluate_performance(request)
        return response
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {str(e)}")

@app.post("/api/practice/evaluate-recording", response_model=EvaluationResponse)
async def evaluate_recorded_file(
    audio_id: str = Form(...),
    file: UploadFile = File(...),
    tolerance_cents: float = Form(50.0),
    transpose_semitones: int = Form(0),
    studio_type: str = Form("vocal")
):
    try:
        content = await file.read()
        resp = evaluate_imported_performance(
            audio_id=audio_id,
            file_bytes=content,
            filename=file.filename or "recording.wav",
            tolerance_cents=tolerance_cents,
            transpose_semitones=transpose_semitones,
            studio_type=studio_type
        )
        return resp
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recorded audio evaluation failed: {str(e)}")
