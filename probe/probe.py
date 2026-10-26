import json, re, time, os
import careers

urls = """https://job.alfabank.ru/vacancies/volgograd/client-service/menedzher-priamyikh-prodazh_39006
https://ptsecurity.com/about/vacancy/glavnyj-arhitektor-proektov/
https://rabota.sber.ru/search/java-developer-4570903/
https://selectel.ru/careers/all/vacancy/1772/
https://www.tbank.ru/career/it/vacancy/abakan/setevoj-inzhener-v-t-cod/951573af-a8c1-4871-93a6-5c11f742ec73/
https://hr.tochka.com/vacancies/catalog/lider-marketinga-roznicy/
https://x5.tech/vacancy/b1d97d33-961d-421d-88d6-d44b5c5062a4""".split()
f = careers.Fetcher(); f.use_russian_ca()
os.makedirs("probe/pages", exist_ok=True)
out = {}
for i, u in enumerate(urls):
    try:
        page = f.get(u, 1.0) or ""
    except Exception as e:
        out[u] = str(e)[:100]; continue
    open(f"probe/pages/{i}.html", "w").write(page[:400000])
    out[u] = {"len": len(page), "ld": bool(careers.job_posting(page)),
              "next": "__NEXT_DATA__" in page, "nuxt": "__NUXT__" in page,
              "keys": [k for k in ("Обязанности", "Требования", "Задачи", "Чем предстоит", "Мы ожидаем", "Что нужно", "Условия") if k in page],
              "text": careers.page_text(page)[:1500]}
json.dump(out, open("probe/result.json", "w"), ensure_ascii=False, indent=1)
