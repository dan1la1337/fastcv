import { describe, expect, it } from "vitest";
import { NAME_TOKEN, nameFromResume, redactPersonal, restoreName } from "@/lib/redact";

describe("redactPersonal: contacts", () => {
  it.each([
    ["+7 (999) 123-45-67"],
    ["8 999 123 45 67"],
    // без кода страны
    ["999 123-45-67"],
    ["(999) 123 45 67"],
    ["9991234567"],
    ["(495) 123-45-67"],
    ["123-45-67"],
  ])("hides phone %s", phone => {
    const out = redactPersonal(`Телефон: ${phone}, звоните.`);
    expect(out).toBe("Телефон: [телефон], звоните.");
  });

  it.each([
    ["Зарплата 150 000 – 200 000 ₽"],
    ["Опыт 2019–2024, команда из 12 человек"],
    ["Обработали 1 200 000 заказов"],
    ["Версия 3.12.1, порт 5432"],
  ])("keeps numbers that are not phones: %s", text => {
    expect(redactPersonal(text)).toBe(text);
  });

  it("hides email, links and handles", () => {
    expect(redactPersonal("ivan@mail.ru, https://github.com/ivan, t.me/ivan, @ivan_dev"))
      .toBe("[email], [ссылка], [ссылка], [контакт]");
  });
});

describe("redactPersonal: birth dates", () => {
  it.each([
    ["Дата рождения: 01.02.1990", "[дата рождения]"],
    ["дата рождения 15 марта 1995 г.", "[дата рождения]"],
    ["Родилась 3 мая 2001", "[дата рождения]"],
    ["Date of birth: 12/31/1988", "[дата рождения]"],
    ["1992 г.р.", "[дата рождения]"],
    ["1992 года рождения", "[дата рождения]"],
    ["14.07.1987", "[дата рождения]"],
  ])("hides %s", (text, expected) => {
    expect(redactPersonal(text)).toBe(expected);
  });

  it("keeps work periods and recent dates", () => {
    const text = "09.2019 — по настоящее время; март 2015 — май 2018; сертификат от 12.04.2023";
    expect(redactPersonal(text)).toBe(text);
  });
});

describe("redactPersonal: addresses", () => {
  it.each([
    ["Адрес: г. Москва, ул. Ленина, д. 5, кв. 12", "Адрес: г. Москва, [адрес]"],
    ["Живу: Санкт-Петербург, Невский проспект 28", "Живу: Санкт-Петербург, Невский [адрес]"],
    ["пр-т Мира 10к2", "[адрес]"],
    ["улица 8 Марта, дом 3, корп. 1, квартира 7", "[адрес]"],
    ["Казань, д. 14, кв. 88", "Казань, [адрес]"],
  ])("hides %s", (text, expected) => {
    expect(redactPersonal(text)).toBe(expected);
  });

  it("keeps the city", () => {
    expect(redactPersonal("Город: Новосибирск, готов к переезду")).toBe("Город: Новосибирск, готов к переезду");
  });
});

describe("redactPersonal: names", () => {
  it.each([
    ["Сергеевич"], ["Сергеевича"], ["Сергеевичем"], ["Петровна"], ["Петровной"], ["Никитична"], ["Ильич"],
  ])("hides patronymic %s", word => {
    expect(redactPersonal(`Ответ ${word} был хорошим`)).toBe(`Ответ ${NAME_TOKEN} был хорошим`);
  });

  it("keeps ordinary words that look like patronymic endings", () => {
    const text = "Типичная задача, отлично справился, Белград";
    expect(redactPersonal(text)).toBe(text);
  });

  it("hides the profile name in any case form and collapses the full name into one label", () => {
    const out = redactPersonal("Иванов Иван Сергеевич. Ивану интересно, Иванова команда", ["Иван Иванов"]);
    expect(out).toBe(`${NAME_TOKEN}. ${NAME_TOKEN} интересно, ${NAME_TOKEN} команда`);
  });

  it("handles short and vowel-ending names", () => {
    expect(redactPersonal("Анне и Олегу передали", ["Анна", "Олег"])).toBe(`${NAME_TOKEN} и ${NAME_TOKEN} передали`);
    expect(redactPersonal("Лев и Левый фланг", ["Лев"])).toBe(`${NAME_TOKEN} и Левый фланг`);
  });

  it("ignores empty and missing names", () => {
    expect(redactPersonal("Python, Django", [null, undefined, ""])).toBe("Python, Django");
  });
});

describe("nameFromResume and restoreName", () => {
  it("takes the name from the first line of the resume", () => {
    expect(nameFromResume("\nИванов Иван Сергеевич\nPython-разработчик")).toBe("Иванов Иван Сергеевич");
    expect(nameFromResume("Python-разработчик\nопыт 5 лет")).toBeNull();
  });

  it("puts the real name back", () => {
    expect(restoreName(`Здравствуйте! Меня зовут ${NAME_TOKEN}.`, "Иван")).toBe("Здравствуйте! Меня зовут Иван.");
  });
});
