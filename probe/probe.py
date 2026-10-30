"""Пробный обход: кандидаты в источники мобильной разработки и fullstack."""
import json, re, time
import requests

UA = {"User-Agent": "Mozilla/5.0 (compatible; FastCVBot/1.0; +https://fastcv.ru)"}
MOB = re.compile(r"\b(ios|android|flutter|swift|kotlin|react native|mobile|мобильн)", re.I)
FS = re.compile(r"full[\s-]?stack|фулл?стек", re.I)

channels = """ios_jobs iosdevjobs ios_jobs_feed android_jobs androidjobs android_jobs_feed flutter_jobs flutterjobs flutter_jobs_feed
kotlin_jobs kotlin_jobs_feed swift_jobs swift_jobs_feed react_native_jobs reactnativejobs mobile_jobs mobilejobs mobile_jobs_feed
fullstack_jobs fullstackjobs fullstack_jobs_feed forios forandroid forflutter forfullstack forallmobile mobiledev_jobs mobiledevjobs
runello_rus_ios runello_rus_android runello_rus_flutter runello_rus_fullstack runello_jobs_mobile runello_rus_mobileappdevelopment
jobs_ios jobs_android rabota_ios rabota_android ios_vacancy android_vacancy flutter_vacancy mobile_vacancy iosjobs androidjob
flutter_ru_jobs dart_jobs kmp_jobs fullstack_rabota rabota_fullstack laravel_jobs vuejs_jobs vue_jobs_feed react_jobs_feed
nextjs_jobs php_jobs_feed ruby_jobs_feed django_jobs""".split()

def tg(name):
    try:
        r = requests.get(f"https://t.me/s/{name}", headers=UA, timeout=20)
    except Exception as e:
        return {"error": type(e).__name__}
    if r.status_code != 200 or "tgme_widget_message_text" not in r.text:
        return {"status": r.status_code, "posts": 0}
    texts = re.findall(r'tgme_widget_message_text[^>]*>(.*?)</div>', r.text, re.S)
    dates = re.findall(r'datetime="([^"]+)"', r.text)
    return {"posts": len(texts), "mob": sum(bool(MOB.search(t)) for t in texts), "fs": sum(bool(FS.search(t)) for t in texts),
            "last": dates[-1][:10] if dates else None, "first": dates[0][:10] if dates else None}

slugs = """flohealth bumble realtimeboardglobal miro joom indrive exness semrush palta mercuryo xsolla ecwid wrike jiji pinely
socialdiscoverygroup nexters playkot belkagames mytona appodeal gismart exante everix playrix plarium wargaming nexters-global
yango inventive-retail ozon-tech avito skyeng tabby revolut deel bolt wolt paysera kaspi vk joomgroup simple
appquantum zeptolab hypemasters playtika moonactive azur-games azurgames nordcurrent tilting-point""".split()

def ats(slug):
    out = {}
    tries = {
        "greenhouse": (f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs", lambda d: [(j.get("title",""), (j.get("location") or {}).get("name","")) for j in d.get("jobs", [])]),
        "lever": (f"https://api.lever.co/v0/postings/{slug}?mode=json", lambda d: [(j.get("text",""), (j.get("categories") or {}).get("location","")) for j in d] if isinstance(d, list) else []),
        "workable": (f"https://apply.workable.com/api/v1/widget/accounts/{slug}", lambda d: [(j.get("title",""), j.get("city","") + " " + j.get("country","")) for j in d.get("jobs", [])]),
        "ashby": (f"https://api.ashbyhq.com/posting-api/job-board/{slug}", lambda d: [(j.get("title",""), j.get("location","")) for j in d.get("jobs", [])]),
        "smartrecruiters": (f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100", lambda d: [(j.get("name",""), (j.get("location") or {}).get("city","")) for j in d.get("content", [])]),
    }
    for kind, (url, parse) in tries.items():
        try:
            r = requests.get(url, headers=UA, timeout=20)
            if r.status_code != 200:
                continue
            jobs = parse(r.json())
        except Exception:
            continue
        if not jobs:
            continue
        mob = [t for t, _ in jobs if MOB.search(t)]
        fs = [t for t, _ in jobs if FS.search(t)]
        out[kind] = {"jobs": len(jobs), "mob": len(mob), "fs": len(fs), "mob_titles": mob[:6], "fs_titles": fs[:4],
                     "locations": sorted({l for _, l in jobs if l})[:12]}
    return out

result = {"channels": {}, "ats": {}}
for c in channels:
    result["channels"][c] = tg(c); time.sleep(1)
for s in slugs:
    result["ats"][s] = ats(s)
json.dump(result, open("probe/result.json", "w"), ensure_ascii=False, indent=1)
