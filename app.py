import os, json, urllib.request
from pathlib import Path
from flask import Flask, Response

app = Flask(__name__)
_html_cache = None

def _get_secret(key: str) -> str:
    if val := os.environ.get(key, ""):
        return val
    data_dir = os.environ.get("OPENHOST_APP_DATA_DIR", "")
    if data_dir:
        p = Path(data_dir) / f"{key.lower()}.txt"
        if p.exists():
            return p.read_text().strip()
    router_url = os.environ.get("OPENHOST_ROUTER_URL", "")
    token = os.environ.get("OPENHOST_APP_TOKEN", "")
    if router_url and token:
        try:
            body = json.dumps({"keys": [key]}).encode()
            req = urllib.request.Request(
                f"{router_url}/api/services/v2/call/secrets/get",
                data=body,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=5) as r:
                return json.loads(r.read()).get("secrets", {}).get(key, "")
        except Exception as e:
            print(f"Secret fetch failed for {key}: {e}")
    return ""

def _build_html():
    html = Path("index.html").read_text()
    html = html.replace("'YOUR_OPENAI_API_KEY'",  f"'{_get_secret('OPENAI_API_KEY')}'")
    html = html.replace("'YOUR_SUPABASE_URL'",     f"'{_get_secret('SUPABASE_URL')}'")
    html = html.replace("'YOUR_SUPABASE_ANON_KEY'", f"'{_get_secret('SUPABASE_ANON_KEY')}'")
    return html

@app.route("/")
def index():
    global _html_cache
    if _html_cache is None:
        _html_cache = _build_html()
    return Response(_html_cache, mimetype="text/html")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
