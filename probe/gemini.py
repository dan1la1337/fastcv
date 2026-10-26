import traceback, sys, json
try:
    import os, time, statistics
    import requests
    from bs4 import BeautifulSoup
    from google import genai
    from google.genai import errors, types
    from pydantic import BaseModel
    import main

    texts = []
    for ch in ["forfrontend", "qa_jobs_rabota", "runello_jobs_devops", "mobiledevjobs", "frontend_rabota"]:
        s = BeautifulSoup(requests.get(f"https://t.me/s/{ch}", timeout=20).text, "html.parser")
        texts += [x.get_text("\n", strip=True) for x in s.select(".tgme_widget_message_text")][-6:]
    texts = [t for t in texts if len(t) > 80][:24]

    class Item(BaseModel):
        post: int
        vacancy: main.VacancyAI

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"], http_options=types.HttpOptions(timeout=90_000))
    out = {"posts": len(texts), "models": {}}
    models = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-2.5-flash"]
    for m in models:
        res = {"single": [], "errors": [], "batch": []}
        cfg = types.GenerateContentConfig(response_mime_type="application/json", response_schema=main.VacancyAI, temperature=0, system_instruction=main.PROMPT)
        for t in texts[:4]:
            t0 = time.monotonic()
            try:
                r = client.models.generate_content(model=m, contents=main.wrap_post(t), config=cfg)
                res["single"].append(round(time.monotonic() - t0, 1))
            except Exception as e:
                res["errors"].append(f"{getattr(e, 'code', type(e).__name__)} {round(time.monotonic() - t0, 1)}s")
                if getattr(e, "code", None) == 404: break
            time.sleep(1)
        if not res["single"]:
            out["models"][m] = res; continue
        bcfg = types.GenerateContentConfig(response_mime_type="application/json", response_schema=list[Item], temperature=0,
            system_instruction=main.PROMPT + "\nПостов несколько: каждый в своём блоке <post id=N>. Верни список, по элементу на каждый пост, post = его id.")
        for chunk in (texts[:10], texts[10:20]):
            body = "\n\n".join(f'<post id={i}>\n{t}\n</post>' for i, t in enumerate(chunk))
            t0 = time.monotonic()
            try:
                r = client.models.generate_content(model=m, contents=body, config=bcfg)
                items = r.parsed or []
                res["batch"].append({"s": round(time.monotonic() - t0, 1), "n": len(chunk), "got": len(items),
                                     "jobs": sum(1 for x in items if x.vacancy.is_job),
                                     "titles": [(x.post, x.vacancy.title, x.vacancy.direction) for x in items][:10]})
            except Exception as e:
                res["batch"].append({"err": f"{getattr(e, 'code', type(e).__name__)} {str(e)[:120]}", "s": round(time.monotonic() - t0, 1)})
            time.sleep(1)
        # одиночные ответы для сравнения направлений
        out["models"][m] = res
    json.dump(out, open("probe/gemini_result.json", "w"), ensure_ascii=False, indent=1)
except Exception:
    json.dump({'fatal': traceback.format_exc()[-3000:]}, open('probe/gemini_result.json','w'), ensure_ascii=False)
