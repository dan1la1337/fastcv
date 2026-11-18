import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DiscriminationWarning from "@/components/DiscriminationWarning";

const render = (text: string) => renderToStaticMarkup(createElement(DiscriminationWarning, { text }));

describe("DiscriminationWarning", () => {
  it("renders nothing for a clean vacancy", () => {
    expect(render("Python-разработчик\nDjango, PostgreSQL, удалёнка")).toBe("");
  });

  it("warns that a vacancy with an age or sex requirement will be hidden from the feed", () => {
    const html = render("Менеджер\nТолько мужчины до 35 лет");
    expect(html).toContain("Вакансия не попадёт в ленту");
    expect(html).toContain("«до 35 лет»");
    expect(html).toContain("требование: возраст");
    expect(html).toContain("«Только мужчины»");
    expect(html).toContain("13.11.1");
  });

  it("only asks to check a citizenship requirement", () => {
    const html = render("Аналитик\nГражданство РФ обязательно");
    expect(html).toContain("Проверьте требование гражданства");
    expect(html).not.toContain("не попадёт в ленту");
  });
});
