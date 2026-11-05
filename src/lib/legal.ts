// Реквизиты для юридических страниц. При регистрации ИП или ООО — заменить здесь.
export const OPERATOR = {
  name: "Лобанов Данила Ильич",
  status: "физическое лицо",
  email: "eqytest@gmail.com",
  // Почтовый адрес оператора — обязательный реквизит согласия (п. 1 ч. 4 ст. 9 152-ФЗ). Заполнить
  address: "",
};

// Редакция документов: меняется вместе с текстом, сохраняется в согласии при регистрации
export const LEGAL_VERSION = "2026-11-05";
export const LEGAL_DATE = "5 ноября 2026 г.";

/**
 * Где хранится база — для политики и согласия. Берётся из адреса Supabase, чтобы после
 * переноса на свой сервер в России (infra/ru-migration) тексты поменялись сами, вместе
 * с переменной NEXT_PUBLIC_SUPABASE_URL, без отдельной правки документов.
 */
export const DB_ABROAD = /\.supabase\.co(\/|$)/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
export const DB_LOCATION = DB_ABROAD ? "Германия, Франкфурт" : "Россия";
