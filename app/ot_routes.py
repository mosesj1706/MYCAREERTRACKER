"""HTTP API for the OT pack: countries and licence routes, documents, CPD and case studies, cover
letters and the CV photo. Mounted by app.server only when the pack enables these features."""
from io import BytesIO

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from app.core import countries, cpd, documents, exams, flashcards, letters, library, profile as profile_store, tracker
from app.core.cv_ot import PHOTO_PATH

router = APIRouter(prefix="/api")


def _profile():
    if not profile_store.exists():
        raise HTTPException(404, "No profile yet - build one from a resume first.")
    return profile_store.load()


# ----------------------------------------------------------------------------- countries & licence routes
def _countries_payload() -> dict:
    prog = countries.progress()
    return {"countries": countries.all_countries(), "selection": countries.selection(), "progress": prog,
            "cv_standard": countries.cv_format(None),
            "summaries": [countries.route_summary(r, prog) for r in countries.tracked_routes()],
            "checks": {r: countries.last_check(r) for c in countries.all_countries() for r in [x["id"] for x in c["routes"]] if countries.last_check(r)}}


@router.get("/countries")
def get_countries():
    return _countries_payload()


class SelectionIn(BaseModel):
    selected: list[str]
    primary: str | None = None
    routes: dict[str, list[str]] = {}


@router.put("/countries/selection")
def put_selection(body: SelectionIn):
    countries.save_selection(body.selected, body.primary, body.routes)
    return _countries_payload()


class StepIn(BaseModel):
    status: str
    date: str | None = None
    cost: str | None = None
    notes: str = ""


@router.put("/licence/{route_id}/{step_id}")
def put_step(route_id: str, step_id: str, body: StepIn):
    try:
        countries.set_step(route_id, step_id, body.status, body.date, body.cost, body.notes)
    except KeyError:
        raise HTTPException(404, "Unknown route or step.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _countries_payload()


@router.post("/countries/check/{route_id}")
def check_route(route_id: str):
    """Live search of the regulator's own site for the current route (one model call with web search)."""
    try:
        return countries.check(route_id)
    except KeyError:
        raise HTTPException(404, "Unknown route.")


# ----------------------------------------------------------------------------- licensing exams
@router.get("/exams")
def list_exams():
    """Every OT licensing exam (format, style, blueprint), the ones on her tracked routes first,
    and the countries that register OTs without an exam."""
    tracked = set(countries.tracked_routes())
    selected = set(countries.selection()["selected"])
    exams = countries.exams()
    names = {c["code"]: c["name"] for c in countries.all_countries()}
    return {"exams": [e | {"country_name": names.get(e["country"], e["country"]), "tracked": e.get("route") in tracked,
                           "selected_country": e["country"] in selected} for e in exams],
            "no_exam": [n | {"country_name": names.get(n["country"], n["country"]), "selected_country": n["country"] in selected}
                        for n in countries.no_exam_notes()]}


# ----------------------------------------------------------------------------- exam question bank & sessions
@router.get("/exam-bank/{exam_id}")
def exam_bank(exam_id: str):
    if not countries.exam(exam_id):
        raise HTTPException(404, "Unknown exam.")
    return exams.bank_stats(exam_id) | {"sessions": exams.list_sessions(exam_id)}


class SessionIn(BaseModel):
    exam: str
    mode: str = "quick"      # quick | timed | full
    source: str = "bank"     # bank | mistakes
    n: int = 5
    topics: list[str] = []
    retry_of: int | None = None  # a finished session: practise exactly its wrong answers
    round: str | None = None     # a study-path round (exams.ROUNDS): sets mode and length, resumes one left part-way


@router.get("/exam-path/{exam_id}")
def exam_path(exam_id: str):
    try:
        return exams.path(exam_id)
    except KeyError:
        raise HTTPException(404, "Unknown exam.")


@router.post("/exam-path/{exam_id}/restart")
def exam_path_restart(exam_id: str):
    try:
        return exams.restart_path(exam_id)
    except KeyError:
        raise HTTPException(404, "Unknown exam.")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/exam-path/{exam_id}/report")
def exam_path_report(exam_id: str, cycle: int | None = None):
    try:
        return exams.report(exam_id, cycle)
    except KeyError:
        raise HTTPException(404, "No such study path run.")


@router.get("/exam-path/{exam_id}/report.pdf")
def exam_path_report_pdf(exam_id: str, cycle: int | None = None):
    try:
        data = exams.report_pdf(exam_id, cycle)
    except KeyError:
        raise HTTPException(404, "No such study path run.")
    return Response(data, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{exam_id}-study-path-report.pdf"'})


@router.post("/exam-sessions")
def start_session(body: SessionIn):
    try:
        if body.round:
            return exams.start_round(body.exam, body.round)
        return exams.start(body.exam, body.mode, body.source, body.n, body.topics, retry_of=body.retry_of)
    except KeyError:
        raise HTTPException(404, "Unknown exam.")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/exam-sessions/{session_id}")
def get_session(session_id: int):
    s = exams.get(session_id)
    if not s:
        raise HTTPException(404, "Session not found.")
    return s


class SubmitIn(BaseModel):
    answers: list[dict]
    seconds_used: int | None = None


@router.post("/exam-sessions/{session_id}/progress")
def session_progress(session_id: int, body: SubmitIn):
    try:
        exams.save_progress(session_id, body.answers, body.seconds_used)
    except KeyError:
        raise HTTPException(404, "Session not found.")
    return {"ok": True}


@router.post("/exam-sessions/{session_id}/submit")
def submit_session(session_id: int, body: SubmitIn):
    try:
        return exams.submit(session_id, body.answers, body.seconds_used)
    except KeyError:
        raise HTTPException(404, "Session not found.")


@router.delete("/exam-sessions/{session_id}")
def delete_session(session_id: int):
    exams.delete_session(session_id)
    return {"ok": True}


@router.get("/exam-sessions/{session_id}/pdf")
def session_pdf(session_id: int):
    s = exams.get(session_id)
    if not s:
        raise HTTPException(404, "Session not found.")
    return Response(exams.pdf(session_id), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{s["exam"]}-practice-{session_id}.pdf"'})


# ----------------------------------------------------------------------------- study materials (PDFs as they are)
@router.get("/library")
def list_library():
    return library.list_files()


@router.post("/library")
async def upload_library(file: UploadFile = File(...), title: str = Form(""), notes: str = Form("")):
    try:
        return library.add(await file.read(), file.filename or "upload.pdf", title, notes)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/library/{file_id}/file")
def library_file(file_id: int):
    f = library.get(file_id)
    if not f or not library.file_path(f).exists():
        raise HTTPException(404, "File not found.")
    return FileResponse(library.file_path(f), media_type="application/pdf", filename=library.safe_name(f), content_disposition_type="inline")


@router.get("/library/{file_id}/pages")
def library_pages(file_id: int, start: int, end: int, title: str = ""):
    """A chapter (pages start..end) as its own PDF."""
    f = library.get(file_id)
    if not f or not library.file_path(f).exists():
        raise HTTPException(404, "File not found.")
    try:
        part = library.chapter_pdf(f, start, end)
    except ValueError as e:
        raise HTTPException(400, str(e))
    name = library.safe_name({"title": f"{f['title']} - {title}" if title else f"{f['title']} pages {start}-{end}"})
    return FileResponse(part, media_type="application/pdf", filename=name, content_disposition_type="inline")


@router.delete("/library/{file_id}")
def delete_library(file_id: int):
    try:
        library.delete(file_id)
    except KeyError:
        raise HTTPException(404, "File not found.")
    return {"ok": True}


# ----------------------------------------------------------------------------- flashcards
@router.get("/flashcards")
def flashcard_summary():
    return flashcards.summary()


@router.get("/flashcards/next")
def flashcards_next(deck: str | None = None, topic: str | None = None, n: int = 20):
    return flashcards.next_cards(deck or None, topic or None, min(max(n, 1), 100))


class GradeIn(BaseModel):
    knew: bool


@router.post("/flashcards/{card_id}/grade")
def flashcard_grade(card_id: int, body: GradeIn):
    try:
        return flashcards.grade(card_id, body.knew)
    except KeyError:
        raise HTTPException(404, "Card not found.")


class HideIn(BaseModel):
    hidden: bool = True


@router.post("/flashcards/{card_id}/hide")
def flashcard_hide(card_id: int, body: HideIn):
    try:
        flashcards.set_hidden(card_id, body.hidden)
    except KeyError:
        raise HTTPException(404, "Card not found.")
    return {"ok": True}


# ----------------------------------------------------------------------------- documents
@router.get("/documents")
def list_documents():
    return {"documents": documents.list_all(), "categories": documents.CATEGORIES,
            "checklist": documents.checklist([countries.route(r)[1] for r in countries.tracked_routes()])}


@router.post("/documents")
async def upload_document(file: UploadFile = File(...), category: str = Form(...), title: str = Form(""),
                          expires: str = Form(""), notes: str = Form("")):
    try:
        return documents.add(await file.read(), file.filename or "upload", category, title, expires or None, notes)
    except ValueError as e:
        raise HTTPException(400, str(e))


class DocPatch(BaseModel):
    category: str | None = None
    title: str | None = None
    expires: str | None = None
    notes: str | None = None


@router.patch("/documents/{doc_id}")
def patch_document(doc_id: int, body: DocPatch):
    if not documents.get(doc_id):
        raise HTTPException(404, "Document not found.")
    try:
        return documents.update(doc_id, **body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: int):
    documents.delete(doc_id)
    return {"ok": True}


@router.get("/documents/{doc_id}/file")
def document_file(doc_id: int, download: bool = False):
    d = documents.get(doc_id)
    if not d:
        raise HTTPException(404, "Document not found.")
    return FileResponse(documents.file_path(d), media_type=d["mime"], filename=documents.safe_name(d),
                        content_disposition_type="attachment" if download else "inline")


class ZipIn(BaseModel):
    ids: list[int]


@router.post("/documents/zip")
def documents_zip(body: ZipIn):
    if not body.ids:
        raise HTTPException(400, "Pick at least one document.")
    return Response(documents.zip_bytes(body.ids), media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="documents.zip"'})


# ----------------------------------------------------------------------------- CV photo
@router.get("/profile/photo")
def get_photo():
    if not PHOTO_PATH.exists():
        raise HTTPException(404, "No photo.")
    return FileResponse(PHOTO_PATH, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.post("/profile/photo")
async def put_photo(file: UploadFile = File(...)):
    """Stored as a JPEG of at most 600 px, for the CV header."""
    try:
        img = Image.open(BytesIO(await file.read()))
        img = img.convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(400, "Use a JPG or PNG photo. (On an iPad: share the photo as JPEG, or take a screenshot of it.)")
    img.thumbnail((600, 600))
    PHOTO_PATH.parent.mkdir(parents=True, exist_ok=True)
    img.save(PHOTO_PATH, "JPEG", quality=88)
    return {"ok": True}


@router.delete("/profile/photo")
def delete_photo():
    PHOTO_PATH.unlink(missing_ok=True)
    return {"ok": True}


# ----------------------------------------------------------------------------- CPD
class CpdIn(BaseModel):
    date: str
    kind: str
    title: str
    provider: str = ""
    hours: float = 0
    reflection: str = ""


@router.get("/cpd")
def list_cpd():
    return {"entries": cpd.list_cpd(), "summary": cpd.cpd_summary(), "kinds": cpd.CPD_KINDS}


@router.post("/cpd")
def add_cpd(body: CpdIn):
    if not body.title.strip():
        raise HTTPException(400, "Give it a title.")
    try:
        cpd.add_cpd(body.date, body.kind, body.title, body.provider, body.hours, body.reflection)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return list_cpd()


@router.patch("/cpd/{entry_id}")
def patch_cpd(entry_id: int, body: CpdIn):
    try:
        cpd.update_cpd(entry_id, **body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))
    return list_cpd()


@router.delete("/cpd/{entry_id}")
def delete_cpd(entry_id: int):
    cpd.delete_cpd(entry_id)
    return list_cpd()


# ----------------------------------------------------------------------------- case studies
class CaseIn(BaseModel):
    title: str
    fields: dict[str, str]


@router.get("/cases")
def list_cases():
    return {"cases": cpd.list_cases(), "fields": cpd.CASE_FIELDS}


@router.post("/cases")
def add_case(body: CaseIn):
    if not body.title.strip():
        raise HTTPException(400, "Give the case a short title (no names).")
    return cpd.save_case(body.title, body.fields)


@router.put("/cases/{case_id}")
def put_case(case_id: int, body: CaseIn):
    if not cpd.get_case(case_id):
        raise HTTPException(404, "Case not found.")
    return cpd.save_case(body.title, body.fields, case_id)


@router.delete("/cases/{case_id}")
def delete_case(case_id: int):
    cpd.delete_case(case_id)
    return {"ok": True}


@router.post("/cases/{case_id}/story")
def case_story(case_id: int):
    try:
        return cpd.build_story(case_id, profile_store.load() if profile_store.exists() else None)
    except KeyError:
        raise HTTPException(404, "Case not found.")


# ----------------------------------------------------------------------------- cover letters
class LetterIn(BaseModel):
    app_id: int | None = None
    jd_text: str | None = None
    title: str | None = None
    country: str | None = None
    length: str = "standard"
    tone: str = "formal"
    addressee: str = ""
    include_licence: bool = True
    include_notice: bool = True
    include_visa: bool = False
    extra: str = ""


def _profile_or_none():
    return profile_store.load() if profile_store.exists() else None


@router.get("/cover-letters")
def list_letters(app_id: int | None = None):
    p = _profile_or_none()
    return [letters.with_checks(l, p) for l in letters.list_all(app_id)]


@router.post("/cover-letters")
def generate_letter(body: LetterIn):
    app = tracker.get(body.app_id) if body.app_id else None
    if body.app_id and app is None:
        raise HTTPException(404, "Application not found.")
    try:
        p = _profile()
        return letters.with_checks(letters.generate(p, body.model_dump(exclude={"app_id", "jd_text", "country"}), application=app,
                                                    jd_text=body.jd_text, country=body.country), p)
    except ValueError as e:
        raise HTTPException(400, str(e))


class LetterText(BaseModel):
    text: str


@router.patch("/cover-letters/{letter_id}")
def patch_letter(letter_id: int, body: LetterText):
    if not letters.get(letter_id):
        raise HTTPException(404, "Letter not found.")
    return letters.with_checks(letters.update_text(letter_id, body.text), _profile_or_none())


@router.delete("/cover-letters/{letter_id}")
def delete_letter(letter_id: int):
    letters.delete(letter_id)
    return {"ok": True}


@router.get("/cover-letters/{letter_id}/pdf")
def letter_pdf(letter_id: int):
    letter = letters.get(letter_id)
    if not letter:
        raise HTTPException(404, "Letter not found.")
    p = _profile()
    slug = "".join(ch if ch.isalnum() else "_" for ch in letter["title"])[:40]
    return Response(letters.pdf(letter, p), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{p.personal_info.name.replace(" ", "_")}_Cover_Letter_{slug}.pdf"'})


@router.get("/cover-letters/{letter_id}/tells")
def letter_tells(letter_id: int, detector_on: bool = False):
    from app.server import TellSection, _check  # the AI-tell scan lives with the other tell endpoints
    letter = letters.get(letter_id)
    if not letter:
        raise HTTPException(404, "Letter not found.")
    return _check([TellSection(label="Cover letter", text=letter["text"], field="text")], detector_on)


class TellApplyIn(BaseModel):
    field: str
    text: str


@router.post("/cover-letters/{letter_id}/tells/apply")
def letter_tells_apply(letter_id: int, body: TellApplyIn):
    if not letters.get(letter_id):
        raise HTTPException(404, "Letter not found.")
    return letters.update_text(letter_id, body.text)
