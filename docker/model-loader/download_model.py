import hashlib
import os
import shutil
import sys
import tempfile
import threading

from huggingface_hub import hf_hub_download

REPO_ID = os.environ["HF_MODEL_REPO"]
FILENAME = os.environ["HF_MODEL_FILE"]
EXPECTED_SHA256 = os.environ["EXPECTED_SHA256"]
DEST_DIR = os.environ.get("DEST_DIR", "/mnt/model")
HEARTBEAT_SECONDS = int(os.environ.get("HEARTBEAT_SECONDS", "30"))
HF_TOKEN = os.environ.get("HF_TOKEN") or None


def sha256sum(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def start_heartbeat(tmp_dir: str) -> threading.Event:
    # Daemon thread: never blocks process exit even if the stop event is
    # never set (e.g. the main thread crashes before reaching `finally`).
    stop_event = threading.Event()

    def beat() -> None:
        while not stop_event.wait(HEARTBEAT_SECONDS):
            size_bytes = sum(
                os.path.getsize(os.path.join(root, name))
                for root, _, files in os.walk(tmp_dir)
                for name in files
            )
            print(f"[heartbeat] still downloading, {size_bytes / (1024 ** 2):.1f} MB written so far", flush=True)

    thread = threading.Thread(target=beat, daemon=True)
    thread.start()
    return stop_event


def main() -> None:
    print(f"Starting download: repo={REPO_ID} file={FILENAME} dest={DEST_DIR}", flush=True)

    # Download into a temp dir on the same EFS mount so the final move is an
    # atomic rename, and the app never reads a partially-written file.
    with tempfile.TemporaryDirectory(dir=DEST_DIR) as tmp_dir:
        stop_heartbeat = start_heartbeat(tmp_dir)
        try:
            downloaded_path = hf_hub_download(repo_id=REPO_ID, filename=FILENAME, local_dir=tmp_dir, token=HF_TOKEN)
        finally:
            stop_heartbeat.set()

        print(f"Download finished: {downloaded_path}, verifying checksum...", flush=True)
        digest = sha256sum(downloaded_path)
        if digest.lower() != EXPECTED_SHA256.lower():
            print(f"Checksum mismatch: expected {EXPECTED_SHA256}, got {digest}", file=sys.stderr)
            sys.exit(1)

        final_path = os.path.join(DEST_DIR, os.path.basename(FILENAME))
        shutil.move(downloaded_path, final_path)
        print(f"Model written to {final_path} (sha256={digest})", flush=True)


if __name__ == "__main__":
    main()
