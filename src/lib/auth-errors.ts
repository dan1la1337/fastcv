/** Сообщения Supabase Auth приходят на английском: переводим частые случаи. */
export function authErrorText(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login credentials")) return "Неверная почта или пароль.";
  if (m.includes("email not confirmed")) return "Почта не подтверждена. Перейдите по ссылке из письма, которое мы отправили при регистрации.";
  if (m.includes("already registered")) return "Аккаунт с этой почтой уже есть. Попробуйте войти.";
  if (m.includes("rate limit") || m.includes("too many")) return "Слишком много попыток. Подождите минуту и попробуйте снова.";
  if (m.includes("should be different")) return "Новый пароль совпадает со старым — придумайте другой.";
  if (m.includes("password should be")) return "Пароль слишком простой: нужно не меньше 6 символов.";
  if (isNetworkError(m)) return "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.";
  return message || "Не удалось войти. Попробуйте ещё раз.";
}

/** Обрыв связи: Chrome пишет «Failed to fetch», Safari — «Load failed», Firefox — «NetworkError». */
export function isNetworkError(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("failed to fetch") || m.includes("load failed") || m.includes("network");
}

/** Текст ошибки сохранения для человека: без «TypeError: Load failed» и подобного. */
export function saveErrorText(message: string | undefined): string {
  return isNetworkError(message)
    ? "Нет связи с сервером. Проверьте интернет и нажмите «Сохранить» ещё раз."
    : `Не удалось сохранить: ${message ?? "неизвестная ошибка"}`;
}
