"""
Shared Supabase client initialization.
"""
from os import getenv
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

supabase: Client = create_client(
    getenv("SUPABASE_URL") or "https://placeholder.supabase.co",
    getenv("SUPABASE_SERVICE_KEY") or "placeholder-key"
)
