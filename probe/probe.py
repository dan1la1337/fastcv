import json, os, re, time
from datetime import datetime, timezone, timedelta
import requests
from bs4 import BeautifulSoup

UA = {"User-Agent": "Mozilla/5.0 (compatible; FastCVBot/1.0; +https://fastcv.ru)"}
JOB = re.compile(r"ваканси|зарплат|з/п|зп |требовани|обязанност|откликнуться|резюме|hiring|we are looking|ищем|в команду", re.I)
now = datetime.now(timezone.utc)
out = {"channels": [], "superjob": {}, "ats": []}

# 1. Telegram-каналы
for n in open("probe/channels.txt").read().split():
    row = {"u": n}
    try:
        r = requests.get(f"https://t.me/s/{n}", timeout=20, allow_redirects=False, headers={"User-Agent": "Mozilla/5.0"})
        row["status"] = r.status_code
        if r.status_code == 200:
            s = BeautifulSoup(r.text, "html.parser")
            t = s.find("meta", property="og:title"); row["title"] = t["content"][:60] if t else ""
            times = [datetime.fromisoformat(x["datetime"]) for x in s.select(".tgme_widget_message_date time")]
            texts = [x.get_text(" ", strip=True) for x in s.select(".tgme_widget_message_text")]
            row["posts"] = len(times)
            row["week"] = sum(1 for x in times if now - x < timedelta(days=7))
            row["last"] = max(times).date().isoformat() if times else None
            row["jobshare"] = round(sum(1 for x in texts if JOB.search(x)) / max(1, len(texts)), 2)
            txt = " ".join(texts).lower()
            row["cyr"] = round(len(re.findall("[а-яё]", txt)) / max(1, len(re.findall("[a-zа-яё]", txt))), 2)
            row["sample"] = (texts[-1] if texts else "")[:100]
    except Exception as e:
        row["err"] = str(e)[:80]
    out["channels"].append(row); time.sleep(0.7)

# 2. SuperJob: сколько ИТ-вакансий за 30 дней
key = os.environ.get("SUPERJOB_API_KEY")
if key:
    sj = requests.Session(); sj.headers.update({"X-Api-App-Id": key, **UA})
    since = int((now - timedelta(days=30)).timestamp())
    queries = {"it_all": {"catalogues": 33}}
    for d, kw in {"frontend": "frontend", "react": "react", "vue": "vue", "javascript": "javascript", "верстальщик": "верстальщик",
                  "devops": "devops", "sre": "sre", "системный администратор": "системный администратор",
                  "ios": "ios", "android": "android", "flutter": "flutter", "мобильн": "мобильных приложений",
                  "qa": "qa", "тестировщик": "тестировщик", "тестирован": "тестирования",
                  "руководитель it": "руководитель IT", "руководитель разработки": "руководитель разработки", "project manager": "project manager", "руководитель проектов": "руководитель проектов", "тимлид": "тимлид", "cto": "cto",
                  "fullstack": "fullstack", "full stack": "full stack", "веб-разработчик": "веб-разработчик", "php": "php", "1с": "1с программист",
                  "unity": "unity", "unreal": "unreal", "геймдизайнер": "геймдизайнер", "игр": "разработчик игр", "game": "game"}.items():
        queries[d] = {"keyword": kw}
        queries[d + " /it"] = {"keyword": kw, "catalogues": 33}
    for name, q in queries.items():
        try:
            r = sj.get("https://api.superjob.ru/2.0/vacancies/", params={**q, "date_published_from": since, "count": 1}, timeout=30)
            j = r.json(); out["superjob"][name] = j.get("total"); 
            if name in ("frontend", "devops", "unity", "тестировщик"):
                r2 = sj.get("https://api.superjob.ru/2.0/vacancies/", params={**q, "date_published_from": since, "count": 10}, timeout=30)
                out["superjob"][name + "_sample"] = [v.get("profession") for v in r2.json().get("objects", [])]
        except Exception as e:
            out["superjob"][name] = str(e)[:80]
        time.sleep(0.6)
    try:
        r = sj.get("https://api.superjob.ru/2.0/catalogues/33/", timeout=30)
        out["superjob"]["catalogue33"] = [(p.get("key"), p.get("title")) for p in r.json().get("positions", [])]
    except Exception as e:
        out["superjob"]["catalogue33"] = str(e)[:80]

# 3. Публичные API систем найма (для встраивания на сайты компаний)
ats = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{s}/jobs",
    "lever": "https://api.lever.co/v0/postings/{s}?mode=json",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{s}",
    "smartrecruiters": "https://api.smartrecruiters.com/v1/companies/{s}/postings?limit=100",
    "workable": "https://apply.workable.com/api/v1/widget/accounts/{s}",
    "recruitee": "https://{s}.recruitee.com/api/offers/",
    "personio": "https://{s}.jobs.personio.de/xml",
}
for s in open("probe/ats.txt").read().split():
    for kind, tpl in ats.items():
        try:
            r = requests.get(tpl.format(s=s), timeout=15, headers=UA)
        except Exception:
            continue
        if r.status_code != 200:
            continue
        titles = []
        try:
            j = r.json()
            jobs = j.get("jobs") if isinstance(j, dict) else j
            if isinstance(j, dict) and "content" in j: jobs = j["content"]
            if isinstance(j, dict) and "offers" in j: jobs = j["offers"]
            jobs = jobs or []
            for x in jobs:
                t = x.get("title") or x.get("text") or x.get("name")
                loc = x.get("location")
                loc = loc.get("name") if isinstance(loc, dict) else (loc or (x.get("categories") or {}).get("location") or x.get("city"))
                titles.append(f"{t} @ {loc}")
        except ValueError:
            titles = re.findall(r"<name>(.*?)</name>", r.text)
        if titles:
            out["ats"].append({"s": s, "kind": kind, "n": len(titles), "sample": titles[:25]})
        time.sleep(0.2)

json.dump(out, open("probe/result.json", "w"), ensure_ascii=False, indent=0)
