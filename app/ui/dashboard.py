import json

import streamlit as st

from app.core import profile as profile_store
from app.core import analytics, tracker
from app.ui import charts
from app.core.config import DATA_DIR
from app.core.matcher import ResumeMatcher
from app.core.models import Profile
from app.core import interview
from learning_engine import planner

st.set_page_config(page_title="Career OS - Moses Kirubagar", layout="wide")


if not profile_store.exists():
    st.error("No profile yet. Go to the Profile page and build one from your resume.")

profile: Profile | None = profile_store.load() if profile_store.exists() else None
matcher = ResumeMatcher(profile) if profile else None

st.title("🚀 Career OS: Personal Growth Playground")
st.sidebar.header("Navigation")
page = st.sidebar.radio("Go to", ["Dashboard", "Profile", "Resume Tailor", "Applications", "Gap Analysis", "Interview Playground", "Learning Center"])

if page == "Dashboard" and profile:
    st.subheader(f"Welcome back, {profile.personal_info.name}!")
    k = analytics.kpis()
    plan = planner.load_plan()

    r1 = st.columns(5)
    r1[0].metric("Target", profile.target.primary_role)
    r1[1].metric("JDs tracked", k.tracked)
    r1[2].metric("Applied", k.applied)
    r1[3].metric("Response rate", f"{k.response_rate}%" if k.response_rate is not None else "—",
                 help="Applications that reached screening or later, as % of applied")
    r1[4].metric("Avg score (applied)", f"{k.avg_score_applied}%" if k.avg_score_applied is not None else "—",
                 delta=(f"rejected avg {k.avg_score_rejected}%" if k.avg_score_rejected is not None else None), delta_color="off")

    r2 = st.columns(5)
    r2[0].metric("Hands-on skills", len(profile.skills_by_proficiency("hands_on", "expert")))
    r2[1].metric("Mock interviews", k.interviews)
    r2[2].metric("MCQ accuracy", f"{k.mcq_accuracy}%" if k.mcq_accuracy is not None else "—", help=f"{k.mcq_answered} answered")
    if plan:
        pp = plan.portfolio_project
        done = sum(m.done for m in pp.milestones)
        r2[3].metric("Project milestones", f"{done}/{len(pp.milestones)}")
        skill_done = sum(s.progress >= 100 for s in plan.skills)
        r2[4].metric("Skills completed", f"{skill_done}/{len(plan.skills)}")
        st.progress(done / len(pp.milestones) if pp.milestones else 0.0, text=f"{pp.name} — {plan.weeks_to_complete} wks planned")
    else:
        r2[3].metric("Learning plan", "none yet")

    gaps = [g for g in tracker.aggregate_gaps() if g.pressure > 0][:5]
    if gaps:
        st.markdown("**Learn next:** " + " → ".join(f"`{g.skill}` ({g.jobs} JDs)" for g in gaps))

    c1, c2 = st.columns(2)
    with c1:
        st.markdown("#### Weekly activity")
        rows = analytics.weekly_activity()
        if rows:
            st.altair_chart(charts.weekly_activity(rows), width="stretch")
        else:
            st.caption("Nothing yet — analyze a JD to start the clock.")
    with c2:
        st.markdown("#### Pipeline funnel")
        st.altair_chart(charts.funnel(analytics.funnel()), width="stretch")

    c3, c4 = st.columns(2)
    with c3:
        st.markdown("#### Match score by application")
        rows = analytics.score_distribution()
        if rows:
            st.altair_chart(charts.scores(rows), width="stretch")
        else:
            st.caption("No applications tracked yet.")
    with c4:
        st.markdown("#### MCQ accuracy over time")
        rows = analytics.mcq_weekly_accuracy()
        if len(rows) >= 1:
            st.altair_chart(charts.mcq_trend(rows), width="stretch")
        else:
            st.caption("Answer some MCQs on the Interview Playground page.")

    if profile.risk_flags:
        with st.expander(f"⚠️ {len(profile.risk_flags)} things a recruiter will probe"):
            for r in profile.risk_flags:
                st.write(f"- {r}")

elif page == "Profile":
    st.subheader("🧑‍💻 Master Profile")
    st.caption("The single source of truth every other tool reads from. Rebuild it from a resume, then edit anything by hand.")

    with st.expander("Build / rebuild from resume", expanded=profile is None):
        target_role = st.text_input("Target role", value=profile.target.primary_role if profile else "Cloud Data Engineer (AWS)")
        uploaded = st.file_uploader("Upload resume PDF (or leave empty to use data/resume.txt)", type=["pdf"])
        if st.button("Build profile", type="primary"):
            with st.spinner("Reading resume and building profile (~1 min)..."):
                if uploaded:
                    pdf_path = DATA_DIR / "resume.pdf"
                    pdf_path.write_bytes(uploaded.getvalue())
                    new_profile = profile_store.build_from_pdf(pdf_path, target_role)
                else:
                    new_profile = profile_store.build_from_text((DATA_DIR / "resume.txt").read_text(), target_role)
                profile_store.save(new_profile)
            st.success("Profile built and saved.")
            st.rerun()

    if profile:
        st.markdown(f"**{profile.personal_info.name}** — {profile.personal_info.headline or ''}  ")
        st.markdown(f"_Target: {profile.target.primary_role} ({profile.target.seniority})_ · updated {profile.updated_at}")
        st.write(profile.summary)

        st.markdown("#### Skills")
        rows = [{"skill": s.name, "category": s.category, "proficiency": s.proficiency, "evidence": len(s.evidence)} for s in profile.skills]
        st.dataframe(sorted(rows, key=lambda r: (r["category"], r["proficiency"])), width='stretch', hide_index=True)

        st.markdown("#### Experience")
        for e in profile.experience:
            st.markdown(f"**{e.title}** · {e.company} · {e.start} → {e.end or 'present'}")
            for b in e.bullets:
                st.write(f"- {b}")

        st.markdown("#### Projects")
        for pr in profile.projects:
            st.markdown(f"**{pr.name}** — {', '.join(pr.technologies)}")
            st.write(pr.description)

        c1, c2 = st.columns(2)
        with c1:
            st.markdown("#### Education")
            for ed in profile.education:
                st.write(f"- {ed.degree} {ed.field or ''} · {ed.institution} · {ed.end_year or ''}")
        with c2:
            st.markdown("#### Certifications")
            for c in profile.certifications:
                st.write(f"- {c.name} · {c.status.replace('_', ' ')}")

        with st.expander("Edit raw JSON"):
            edited = st.text_area("profile.json", value=profile.model_dump_json(indent=2), height=500)
            if st.button("Save JSON"):
                try:
                    profile_store.save(Profile.model_validate_json(edited))
                    st.success("Saved.")
                    st.rerun()
                except Exception as exc:
                    st.error(f"Invalid profile: {exc}")

elif page == "Resume Tailor" and matcher:
    st.subheader("🎯 Resume Alchemist")
    st.caption("Paste a job description. You get an honest fit assessment first; tailoring is a second step.")
    jd_text = st.text_area("Job description", height=250, key="jd_text")

    if st.button("Analyze fit", type="primary", disabled=not jd_text.strip()):
        with st.spinner("Extracting requirements and assessing fit against your profile (1-2 min)..."):
            job, result = matcher.analyze(jd_text)
        st.session_state["analysis"] = {"jd": jd_text, "job": job, "result": result}
        st.session_state.pop("tailored", None)

    a = st.session_state.get("analysis")
    if a and a["jd"] == jd_text:
        job, result = a["job"], a["result"]
        score = result.score()

        st.markdown(f"### {job.title}" + (f" · {job.company}" if job.company else ""))
        st.caption(f"{job.seniority} · {job.years_required or '?'}+ yrs · {job.location or 'location n/a'}")
        st.write(job.summary)

        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Match score", f"{score}%")
        m2.metric("Strong", len(result.by_strength("strong")))
        m3.metric("Partial", len(result.by_strength("partial")))
        m4.metric("Missing", len(result.by_strength("none")))

        (st.success if score >= 70 else st.warning if score >= 45 else st.error)(result.verdict)

        st.markdown("**Top gaps to close, in order:** " + " → ".join(f"`{g}`" for g in result.top_gaps))

        cols = st.columns(3)
        for col, strength, icon in zip(cols, ("strong", "partial", "none"), ("✅", "🟡", "❌")):
            with col:
                st.markdown(f"#### {icon} {strength.title()}")
                for m in result.by_strength(strength):
                    tag = "**must**" if m.importance == "must_have" else "nice"
                    with st.expander(f"{m.skill} ({tag})"):
                        st.write(m.evidence)
                        if m.how_to_close:
                            st.info(f"How to close: {m.how_to_close}")

        if job.red_flags:
            with st.expander("⚠️ Red flags in this posting"):
                for r in job.red_flags:
                    st.write(f"- {r}")

        st.divider()
        tc1, tc2, tc3 = st.columns([2, 2, 1])
        track_company = tc1.text_input("Company", value=job.company or "", key="track_company")
        track_url = tc2.text_input("Job URL (optional)", key="track_url")
        if a.get("app_id"):
            tc3.success(f"Tracked (#{a['app_id']})")
        elif tc3.button("Track this application", type="primary"):
            a["app_id"] = tracker.add(job, result, jd_text, url=track_url or None, company=track_company or None,
                                      tailored=st.session_state.get("tailored"))
            st.rerun()

        if st.button("Generate tailored summary, bullets and cover letter"):
            with st.spinner("Rewriting your resume content for this job (~1 min)..."):
                st.session_state["tailored"] = matcher.tailor(job, result, jd_text)
            if a.get("app_id"):
                tracker.save_tailored(a["app_id"], st.session_state["tailored"])

        t = st.session_state.get("tailored")
        if t:
            st.markdown("#### Tailored summary")
            st.code(t.summary, language=None, wrap_lines=True)

            st.markdown("#### Rewritten bullets")
            for b in t.bullets:
                st.code(b.rewritten, language=None, wrap_lines=True)
                st.caption(f"↳ {b.why}  ·  was: _{b.original}_")

            st.markdown("#### Cover letter")
            st.code(t.cover_letter, language=None, wrap_lines=True)

            st.markdown("**Keywords now present:** " + ", ".join(f"`{k}`" for k in t.keywords_added))

            with st.expander("🛑 Do not claim these (honesty notes)", expanded=True):
                for n in t.honesty_notes:
                    st.write(f"- {n}")

            md = (
                f"# {job.title}{' - ' + job.company if job.company else ''}\n\n"
                f"Match score: {score}%\n\n## Summary\n{t.summary}\n\n## Bullets\n"
                + "\n".join(f"- {b.rewritten}" for b in t.bullets)
                + f"\n\n## Cover letter\n{t.cover_letter}\n\n## Do not claim\n"
                + "\n".join(f"- {n}" for n in t.honesty_notes)
            )
            st.download_button("Download as Markdown", md, file_name="tailored_application.md")

elif page == "Applications":
    st.subheader("🗂️ Applications")
    apps = tracker.list_all()
    if not apps:
        st.info("Nothing tracked yet. Analyze a JD on the Resume Tailor page and click 'Track this application'.")
    else:
        counts = tracker.counts_by_status()
        st.caption(" · ".join(f"{s}: {counts[s]}" for s in tracker.STATUSES if counts[s]))

        rows = [{"id": x.id, "company": x.company or "", "title": x.title, "status": x.status,
                 "score": x.match_score, "applied": (x.applied_at or "")[:10], "updated": x.updated_at[:16],
                 "url": x.url or "", "notes": x.notes} for x in apps]
        edited = st.data_editor(
            rows, hide_index=True, width="stretch", key="apps_editor",
            column_config={
                "id": st.column_config.NumberColumn(disabled=True, width="small"),
                "status": st.column_config.SelectboxColumn(options=tracker.STATUSES, required=True),
                "score": st.column_config.NumberColumn(format="%.0f%%", disabled=True, width="small"),
                "applied": st.column_config.TextColumn(disabled=True, width="small"),
                "updated": st.column_config.TextColumn(disabled=True),
                "url": st.column_config.LinkColumn(),
            },
            disabled=False,
        )
        if st.button("Save changes"):
            for before, after in zip(rows, edited):
                if before["status"] != after["status"]:
                    tracker.set_status(after["id"], after["status"])
                changed = {k: after[k] for k in ("company", "title", "url", "notes") if before[k] != after[k]}
                if changed:
                    tracker.update(after["id"], **changed)
            st.success("Saved.")
            st.rerun()

        st.divider()
        labels = {x.id: f"#{x.id} · {x.title}" + (f" @ {x.company}" if x.company else "") for x in apps}
        sel = st.selectbox("Open application", list(labels), format_func=labels.get)
        x = tracker.get(sel)
        m1, m2, m3 = st.columns(3)
        m1.metric("Match", f"{x.match_score:.0f}%")
        m2.metric("Status", x.status)
        m3.metric("Strong / Partial / Missing", f"{len(x.match.by_strength('strong'))} / {len(x.match.by_strength('partial'))} / {len(x.match.by_strength('none'))}")
        st.write(x.match.verdict)
        st.markdown("**Top gaps:** " + " → ".join(f"`{g}`" for g in x.match.top_gaps))
        if x.tailored:
            with st.expander("Tailored summary & cover letter"):
                st.code(x.tailored.summary, language=None, wrap_lines=True)
                st.code(x.tailored.cover_letter, language=None, wrap_lines=True)
        with st.expander("Job description"):
            st.text(x.jd_text)
        if st.button("Re-score against current profile"):
            with st.spinner("Re-assessing fit..."):
                new = tracker.rescore(x.id, profile)
            st.success(f"Score: {x.match_score:.0f}% → {new:.0f}%")
            st.rerun()
        with st.expander("Danger zone"):
            if st.button(f"Delete application #{x.id}"):
                tracker.delete(x.id)
                st.rerun()

elif page == "Gap Analysis":
    st.subheader("📊 Gap Analysis across all JDs")
    st.caption("Every requirement from every JD you've analyzed, weighted by importance and by how far the application got. "
               "Pressure = how much that gap is costing you across the market you're actually applying to.")
    demand = tracker.aggregate_gaps()
    if not demand:
        st.info("Analyze and track a few JDs first.")
    else:
        n_apps = len(tracker.list_all())
        min_jobs = st.slider("Only skills asked for in at least N JDs", 1, max(1, n_apps), min(2, n_apps))
        demand = [d for d in demand if d.jobs >= min_jobs]

        gaps = [d for d in demand if d.pressure > 0]
        strengths = sorted([d for d in demand if d.strong == d.jobs], key=lambda d: -d.jobs)

        c1, c2 = st.columns([3, 2])
        with c1:
            st.markdown("#### Learn next")
            st.dataframe(
                [{"skill": d.skill, "JDs": d.jobs, "must-have in": d.must_have, "coverage": d.coverage, "pressure": round(d.pressure, 1)} for d in gaps],
                hide_index=True, width="stretch",
                column_config={"coverage": st.column_config.ProgressColumn(format="%.0f%%", min_value=0, max_value=100)},
            )
        with c2:
            st.markdown("#### Already covered")
            st.dataframe([{"skill": d.skill, "JDs": d.jobs, "must-have in": d.must_have} for d in strengths],
                         hide_index=True, width="stretch")

        if gaps:
            top = gaps[:5]
            st.markdown("#### Suggested learning order")
            for i, d in enumerate(top, 1):
                st.write(f"{i}. **{d.skill}** — asked for in {d.jobs}/{n_apps} JDs, must-have in {d.must_have}. Coverage {d.coverage:.0f}%.")

elif page == "Interview Playground" and profile:
    st.subheader("🎮 Interview Playground")
    tab_mock, tab_mcq, tab_history = st.tabs(["Mock interview", "Quick-fire MCQs", "Past sessions"])

    # ------------------------------------------------------------------ mock interview
    with tab_mock:
        sess: interview.InterviewSession | None = st.session_state.get("interview")
        if sess is None:
            apps = tracker.list_all()
            labels = {0: f"General — {profile.target.primary_role}"}
            labels.update({x.id: f"#{x.id} · {x.title}" + (f" @ {x.company}" if x.company else "") for x in apps})
            c1, c2 = st.columns([3, 1])
            app_id = c1.selectbox("Interview for", list(labels), format_func=labels.get)
            mode = c2.selectbox("Mode", ["mixed", "technical", "behavioral"])
            st.caption("Type **tutor** if you're lost and want the concept explained. Type **end** for a final report.")
            if st.button("Start interview", type="primary"):
                sess = interview.InterviewSession(profile, mode=mode, application=tracker.get(app_id) if app_id else None)
                st.session_state["interview"] = sess
                st.session_state["interview_first"] = True
                st.rerun()
        else:
            for m in sess.messages[1:]:  # skip the 'Begin the interview.' kickoff
                with st.chat_message("assistant" if m["role"] == "assistant" else "user"):
                    st.markdown(m["content"])

            if st.session_state.pop("interview_first", False):
                with st.chat_message("assistant"):
                    st.write_stream(sess.start())
                st.rerun()

            if user_text := st.chat_input("Your answer..."):
                with st.chat_message("user"):
                    st.markdown(user_text)
                with st.chat_message("assistant"):
                    st.write_stream(sess.answer(user_text))
                if user_text.strip().lower() == "end":
                    sess.save(summary=sess.messages[-1]["content"])
                    st.session_state["interview_ended"] = True
                st.rerun()

            b1, b2, _ = st.columns([1, 1, 4])
            if st.session_state.get("interview_ended"):
                st.success("Session saved to Past sessions.")
            elif b1.button("End & save"):
                sess.save()
                st.session_state["interview_ended"] = True
                st.rerun()
            if b2.button("Discard"):
                for k in ("interview", "interview_first", "interview_ended"):
                    st.session_state.pop(k, None)
                st.rerun()

    # ------------------------------------------------------------------ MCQs
    with tab_mcq:
        gap_topics = [g.skill for g in tracker.aggregate_gaps() if g.pressure > 0][:8]
        default = gap_topics[:3] or ["AWS", "SQL", "Python"]
        topics = st.multiselect("Topics (defaults to your biggest gaps)", options=sorted(set(gap_topics + default + ["AWS", "SQL", "Python", "Airflow"])), default=default)
        n = st.slider("How many", 3, 10, 5)
        if st.button("Generate questions", disabled=not topics):
            with st.spinner("Writing questions..."):
                st.session_state["mcqs"] = interview.generate_mcqs(topics, n, profile.target.primary_role)
                st.session_state["mcq_submitted"] = False

        qs = st.session_state.get("mcqs")
        if qs:
            with st.form("mcq_form"):
                picks = []
                for i, q in enumerate(qs, 1):
                    st.markdown(f"**{i}. [{q.topic} · {q.difficulty}]** {q.question}")
                    picks.append(st.radio("", q.options, key=f"mcq_{i}", index=None, label_visibility="collapsed"))
                submitted = st.form_submit_button("Check answers")
            if submitted and not st.session_state.get("mcq_submitted"):
                st.session_state["mcq_submitted"] = True
                score = 0
                for q, pick in zip(qs, picks):
                    ok = pick == q.options[q.answer_index]
                    score += ok
                    interview.record_mcq(q, ok)
                st.session_state["mcq_results"] = (score, picks)
            if st.session_state.get("mcq_submitted"):
                score, picks = st.session_state["mcq_results"]
                st.metric("Score", f"{score}/{len(qs)}")
                for i, (q, pick) in enumerate(zip(qs, picks), 1):
                    ok = pick == q.options[q.answer_index]
                    (st.success if ok else st.error)(f"**{i}.** {'Correct' if ok else 'Wrong'} — answer: {q.options[q.answer_index]}")
                    st.caption(q.explanation)

        stats = interview.mcq_stats()
        if stats:
            st.markdown("#### Your accuracy by topic (weakest first)")
            st.dataframe(stats, hide_index=True, width="stretch",
                         column_config={"accuracy": st.column_config.ProgressColumn(format="%d%%", min_value=0, max_value=100)})

    # ------------------------------------------------------------------ history
    with tab_history:
        sessions = interview.list_sessions()
        if not sessions:
            st.info("No saved sessions yet.")
        for srow in sessions:
            title = f"#{srow['id']} · {srow['created_at'][:16]}" + (f" · {srow['title']} @ {srow['company']}" if srow.get("title") else " · general")
            with st.expander(title):
                if srow["summary"]:
                    st.markdown(srow["summary"])
                    st.divider()
                for m in json.loads(srow["transcript_json"])[1:]:
                    with st.chat_message("assistant" if m["role"] == "assistant" else "user"):
                        st.markdown(m["content"])

elif page == "Learning Center" and profile:
    st.subheader("📚 Learning Center")
    plan = planner.load_plan()
    gaps = tracker.aggregate_gaps(min_jobs=1)

    with st.expander("Generate / regenerate plan", expanded=plan is None):
        st.caption("Built from the gap analysis across every JD you've tracked. One portfolio project that closes several gaps, then a plan per skill.")
        weekly = st.slider("Hours per week you can commit", 3, 30, 10)
        top_n = st.slider("How many gap skills to include", 3, 10, 6)
        if st.button("Generate plan", type="primary", disabled=not gaps):
            with st.spinner("Designing your plan (~1-2 min)..."):
                plan = planner.generate_plan(profile, tracker.aggregate_gaps(min_jobs=min(2, len(tracker.list_all()))), weekly, top_n)
                planner.save_plan(plan)
            st.rerun()
        if not gaps:
            st.info("Track a few JDs first so there are gaps to plan against.")

    if plan:
        pp = plan.portfolio_project
        done_steps = sum(m.done for m in pp.milestones) + sum(s.done for sk in plan.skills for s in sk.steps)
        all_steps = len(pp.milestones) + sum(len(sk.steps) for sk in plan.skills)
        c1, c2, c3 = st.columns(3)
        c1.metric("Plan length", f"{plan.weeks_to_complete} wks @ {plan.weekly_hours_assumed}h")
        c2.metric("Steps done", f"{done_steps}/{all_steps}")
        c3.metric("Generated", plan.generated_at)

        st.markdown(f"### 🏗️ Portfolio project: {pp.name}")
        st.write(pp.pitch)
        st.markdown("**Covers:** " + ", ".join(f"`{k}`" for k in pp.skills_covered))
        changed = False
        for i, m in enumerate(pp.milestones):
            v = st.checkbox(f"{m.title}  · _{m.kind}, ~{m.hours:g}h_", value=m.done, key=f"pm_{i}")
            if v != m.done:
                m.done = v
                changed = True
        with st.expander("Suggested repo structure"):
            st.code("\n".join(pp.repo_structure), language=None)

        st.markdown("### Skills")
        for si, sk in enumerate(plan.skills):
            with st.expander(f"{sk.skill} — {sk.from_proficiency} → {sk.to_proficiency} · {sk.progress:.0f}% · ~{sk.hours:g}h", expanded=sk.progress < 100):
                st.caption(sk.why)
                for ti, step in enumerate(sk.steps):
                    v = st.checkbox(f"{step.title}  · _{step.kind}, ~{step.hours:g}h_", value=step.done, key=f"s_{si}_{ti}")
                    if v != step.done:
                        step.done = v
                        changed = True
                st.info(f"Proof it's learned: {sk.proof}")

                rc1, rc2 = st.columns([1, 3])
                if rc1.button("Find resources", key=f"res_{si}"):
                    with st.spinner(f"Searching the web for {sk.skill} resources (~1-2 min)..."):
                        st.session_state[f"resources_{sk.skill}"] = planner.find_resources(sk.skill, profile)
                for r in st.session_state.get(f"resources_{sk.skill}", []):
                    st.markdown(f"- [{r.title}]({r.url}) · _{r.kind.replace('_', ' ')}_ — {r.why}")

                already = any(s.name.lower() == sk.skill.lower() and s.proficiency in ("hands_on", "expert") for s in profile.skills)
                if already:
                    st.success("Marked hands-on in your profile.")
                else:
                    ev = st.text_input("Evidence (what you built — this goes on your profile)", key=f"ev_{si}",
                                       placeholder="e.g. Built Glue PySpark job writing partitioned Parquet to S3; repo github.com/...")
                    if st.button("Mark as learned → update profile", key=f"learned_{si}", disabled=not ev.strip()):
                        profile_store.save(planner.mark_learned(profile, sk.skill, ev.strip()))
                        for step in sk.steps:
                            step.done = True
                        planner.save_plan(plan)
                        st.success(f"{sk.skill} is now hands-on in your profile. Re-score applications on the Applications page to see match scores move.")
                        st.rerun()
        if changed:
            planner.save_plan(plan)
