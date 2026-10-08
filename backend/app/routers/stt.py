from fastapi import APIRouter, UploadFile, File

from backend.app.services.stt_service import transcribe

router = APIRouter()


@router.post("/stt")
def stt(file: UploadFile = File(...)):
    audio_bytes = file.file.read()
    result = transcribe(audio_bytes)
    return {
        "text": result["text"],
        "language": result["language"],
    }
