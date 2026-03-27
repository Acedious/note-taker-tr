import os
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")  # tiny, base, small, medium, large
MEETINGS_DIR = os.getenv("MEETINGS_DIR", "meetings")
LANGUAGE = "tr"  # Turkish
