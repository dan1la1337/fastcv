"""Пробный обход: карьерные сайты компаний с мобильными и fullstack-командами."""
import json, re, urllib.robotparser
import requests

UA = "Mozilla/5.0 (compatible; FastCVBot/1.0; +https://fastcv.ru)"
H = {"User-Agent": UA}
SITES = ["https://career.ozon.ru", "https://job.ozon.ru", "https://career.rwb.ru", "https://yandex.ru/jobs",
         "https://career.kaspersky.ru", "https://careers.kaspersky.com", "https://kode.ru", "https://surf.ru",
         "https://redmadrobot.ru", "https://career.lamoda.ru", "https://lamoda.tech", "https://samokat.tech",
         "https://career.samokat.ru", "https://magnit.tech", "https://job.magnit.ru", "https://dodo.dev",
         "https://career.vtb.ru", "https://job.megafon.ru", "https://careers.beeline.ru", "https://job.raiffeisen.ru",
         "https://sovcombank.ru/vacancies", "https://kuper.ru/careers", "https://lemanapro.ru/career",
         "https://hr.lemanapro.ru", "https://career.sportmaster.ru", "https://lab.sportmaster.ru",
         "https://effective.band", "https://e-legion.ru", "https://www.uchi.ru/vacancies", "https://career.wb.ru",
         "https://jobs.kaspi.kz", "https://career.gazprombank.ru", "https://rabota.rshb.ru", "https://team.mail.ru",
         "https://hr.gazprom-neft.ru", "https://career.domclick.ru", "https://job.cian.ru", "https://cian.ru/vacancies"]
VAC = re.compile(r"vacanc|vakans|/jobs?/|career|position", re.I)
MOB = re.compile(r"ios|android|flutter|mobile|mobil|kotlin|swift", re.I)
FS = re.compile(r"full-?stack|fullstek|fulstek", re.I)
LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")

def get(url):
    try:
        r = requests.get(url, headers=H, timeout=20)
        return r.status_code, r.text
    except Exception as e:
        return 0, type(e).__name__

def probe(site):
    root = re.match(r"https?://[^/]+", site).group(0)
    st, robots = get(root + "/robots.txt")
    rp = urllib.robotparser.RobotFileParser(); rp.parse(robots.splitlines() if st == 200 else [])
    out = {"robots": st, "allowed": rp.can_fetch("FastCVBot", site), "home": get(site)[0]}
    maps = re.findall(r"(?im)^sitemap:\s*(\S+)", robots) if st == 200 else []
    if not maps:
        maps = [root + "/sitemap.xml"]
    urls, seen = [], 0
    for m in maps[:5]:
        s, body = get(m); seen += 1
        locs = LOC.findall(body) if s == 200 else []
        subs = [l for l in locs if l.endswith(".xml") or "sitemap" in l]
        for sub in sorted(subs, key=lambda u: not VAC.search(u))[:6]:
            s2, b2 = get(sub)
            if s2 == 200:
                urls += LOC.findall(b2)
        urls += [l for l in locs if l not in subs]
    vac = [u for u in urls if VAC.search(u)]
    out.update({"sitemaps": maps[:3], "urls": len(urls), "vac_urls": len(vac), "mob": len([u for u in vac if MOB.search(u)]),
                "fs": len([u for u in vac if FS.search(u)]), "sample": vac[:3] + [u for u in vac if MOB.search(u)][:3]})
    return out

json.dump({s: probe(s) for s in SITES}, open("probe/result.json", "w"), ensure_ascii=False, indent=1)
