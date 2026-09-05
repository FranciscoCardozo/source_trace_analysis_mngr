import hashlib
import os
import shutil
import sys
import tempfile

from huggingface_hub import hf_hub_download

REPO_ID = os.environ["HF_MODEL_REPO"]
FILENAME = os.environ["HF_MODEL_FILE"]
EXPECTED_SHA256 = os.environ["EXPECTED_SHA256"]
DEST_DIR = os.environ.get("DEST_DIR", "/mnt/model")


def sha256sum(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    # Download into a temp dir on the same EFS mount so the final move is an
    # atomic rename, and the app never reads a partially-written file.
    with tempfile.TemporaryDirectory(dir=DEST_DIR) as tmp_dir:
        downloaded_path = hf_hub_download(repo_id=REPO_ID, filename=FILENAME, local_dir=tmp_dir)
        digest = sha256sum(downloaded_path)
        if digest.lower() != EXPECTED_SHA256.lower():
            print(f"Checksum mismatch: expected {EXPECTED_SHA256}, got {digest}", file=sys.stderr)
            sys.exit(1)

        final_path = os.path.join(DEST_DIR, os.path.basename(FILENAME))
        shutil.move(downloaded_path, final_path)
        print(f"Model written to {final_path} (sha256={digest})")


if __name__ == "__main__":
    main()
