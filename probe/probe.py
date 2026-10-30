"""Пробный обход: Яндекс, Red Mad Robot, e-Legion — карта вакансий и разметка JobPosting."""
import json, re, urllib.robotparser
import requests

H = {"User-Agent": "Mozilla/5.0 (compatible; FastCVBot/1.0; +https://fastcv.ru)"}
LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")
MOB = re.compile(r"ios|android|flutter|mobile|mobil|kotlin|swift", re.I)
FS = re.compile(r"full-?stack|fulstek|fullstek", re.I)

def get(u):
    try:
        r = requests.get(u, headers=H, timeout=25); return r.status_code, r.text
    except Exception as e:
        return 0, type(e).__name__

out = {}
st, robots = get("https://yandex.ru/robots.txt")
rp = urllib.robotparser.RobotFileParser(); rp.parse(robots.splitlines())
out["yandex_robots_jobs"] = rp.can_fetch("FastCVBot", "https://yandex.ru/jobs/vacancies/x")
out["yandex_sitemaps"] = [l for l in re.findall(r"(?im)^sitemap:\s*(\S+)", robots)][:20]
for cand in ["https://yandex.ru/jobs/sitemap.xml", "https://yandex.ru/jobs/sitemap/sitemap.xml", "https://yandex.ru/jobs/sitemap_index.xml"]:
    s, b = get(cand)
    locs = LOC.findall(b) if s == 200 else []
    out[cand] = {"status": s, "locs": len(locs), "sample": locs[:5]}
# первая страница со списком вакансий: есть ли ссылки на вакансии в HTML
s, b = get("https://yandex.ru/jobs/vacancies")
links = sorted(set(re.findall(r'href="(/jobs/vacancies/[^"?#]+)"', b)))
out["yandex_list"] = {"status": s, "links": len(links), "sample": links[:8], "mob": [l for l in links if MOB.search(l)][:8]}
if links:
    s, b = get("https://yandex.ru" + links[0])
    out["yandex_page"] = {"status": s, "jobposting": '"JobPosting"' in b, "len": len(b)}

for name, site, pat in [("rmr", "https://redmadrobot.ru", r"/vakansii/[\w-]+$"), ("elegion", "https://e-legion.ru", r"/about/career/[\w-]+/?$")]:
    s, robots = get(site + "/robots.txt")
    maps = re.findall(r"(?im)^sitemap:\s*(\S+)", robots) or [site + "/sitemap.xml"]
    urls = []
    for m in maps[:3]:
        s, b = get(m); locs = LOC.findall(b)
        for sub in [l for l in locs if l.endswith(".xml")][:10]:
            urls += LOC.findall(get(sub)[1])
        urls += [l for l in locs if not l.endswith(".xml")]
    vac = sorted({u for u in urls if re.search(pat, u)})
    page = get(vac[0])[1] if vac else ""
    out[name] = {"vac": len(vac), "mob": [u for u in vac if MOB.search(u)], "fs": [u for u in vac if FS.search(u)],
                 "jobposting": '"JobPosting"' in page, "sample": vac[:5]}
json.dump(out, open("probe/result.json", "w"), ensure_ascii=False, indent=1)
