"""
Minimal test endpoint to verify Space is working
"""
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def root():
    return {"status": "ok", "message": "Acacia backend is running"}

@app.get("/health")
def health():
    return {"status": "healthy"}
