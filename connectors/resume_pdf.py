"""Resume PDF -> plain text. Used by the profile builder."""
import sys
from pathlib import Path

from pypdf import PdfReader


def extract_text(pdf_path: str | Path) -> str:
    reader = PdfReader(str(pdf_path))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m connectors.resume_pdf <pdf_path>")
        sys.exit(1)
    print(extract_text(sys.argv[1]))
