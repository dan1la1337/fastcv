import { expect, test, type APIRequestContext } from "@playwright/test";

// Разметка JobPosting (Google Jobs) на странице вакансии. Вакансии берём из тестовой базы
// через публичный REST API: нужны конкретные случаи — удалёнка без города и вакансия с городом.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function findVacancy(request: APIRequestContext, filter: string): Promise<string | null> {
  const url = `${SUPABASE_URL}/rest/v1/vacancies?select=id&archived_at=is.null&company_name=not.is.null`
    + `&source_url=like.https://t.me/*&${filter}&order=created_at.desc&limit=1`;
  const rows = await (await request.get(url, { headers: { apikey: ANON_KEY! } })).json();
  return rows[0]?.id ?? null;
}

async function jobPosting(request: APIRequestContext, id: string) {
  const html = await (await request.get(`/vacancy/${id}`)).text();
  const match = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  expect(match, "на странице нет JSON-LD").not.toBeNull();
  return JSON.parse(match![1]);
}

// Обязательные поля Google для JobPosting
function expectGoogleRequired(ld: Record<string, unknown>) {
  expect(ld["@type"]).toBe("JobPosting");
  for (const key of ["title", "description", "datePosted", "hiringOrganization", "employmentType"]) {
    expect(ld[key], key).toBeTruthy();
  }
}

test.describe("разметка JobPosting", () => {
  test.skip(!SUPABASE_URL || !ANON_KEY, "нужен адрес и публичный ключ тестовой базы");

  test("удалёнка без города: TELECOMMUTE и страна кандидата", async ({ request }) => {
    const id = await findVacancy(request, "city=is.null&work_format=eq.remote");
    test.skip(!id, "в тестовой базе нет удалённой вакансии без города");
    const ld = await jobPosting(request, id!);
    expectGoogleRequired(ld);
    expect(ld.jobLocationType).toBe("TELECOMMUTE");
    expect(ld.applicantLocationRequirements).toEqual({ "@type": "Country", name: "RU" });
  });

  test("вакансия с городом: адрес со страной", async ({ request }) => {
    const id = await findVacancy(request, "city=eq.Москва&work_format=neq.remote");
    test.skip(!id, "в тестовой базе нет вакансии с городом");
    const ld = await jobPosting(request, id!);
    expectGoogleRequired(ld);
    expect(ld.jobLocation.address.addressLocality).toBeTruthy();
    expect(ld.jobLocation.address.addressCountry).toBe("RU");
  });
});
