"""Generate AI backgrounds for demo accounts."""
import os, sqlite3, sys
from dotenv import load_dotenv

# Load .env from backend directory
backend_dir = os.path.join(os.path.dirname(__file__), '..', 'backend')
load_dotenv(os.path.join(backend_dir, '.env'))

sys.path.insert(0, backend_dir)
from style_generator import _generate_background_image

DB = os.path.join(backend_dir, 'acacia.db')

PROMPTS = {
    'alex_gamedev': 'A futuristic game development workspace with floating holographic UI panels, level design blueprints, dark blue and cyan neon glow, cyberpunk aesthetic',
    'jamie_fullstack': 'Modern developer workspace with floating code snippets and terminal windows, emerald green and teal color palette, clean tech aesthetic',
    'emma_piano': 'Elegant classical music study with grand piano and floating musical notes, rose pink and soft purple tones, romantic atmosphere',
    'yuki_japanese': 'Anime-inspired Japanese study room with floating hiragana characters and sakura petals, cherry blossom pink aesthetic, cozy atmosphere',
}

def main():
    conn = sqlite3.connect(DB)

    for username, prompt in PROMPTS.items():
        uid = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        if not uid:
            print(f"[SKIP] {username} not found")
            continue
        uid = uid[0]

        print(f"[GEN] {username}...", flush=True)
        url, err = _generate_background_image(prompt, uid, force=True)
        if err:
            print(f"  ERROR: {err}")
        else:
            print(f"  OK: {url}")
            conn.execute("UPDATE user_styles SET background_url=? WHERE owner_id=?", (url, uid))
            conn.commit()

    conn.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
