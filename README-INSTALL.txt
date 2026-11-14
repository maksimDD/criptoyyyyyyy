BLUP V2 — ОБНОВЛЕНИЕ ПРОЕКТА

ЧТО ДОБАВЛЕНО
- Регистрация и вход с bcrypt-хешированием паролей; аккаунты хранятся в SQLite.
- Постоянные серверные сессии в SQLite, срок cookie — 7 дней.
- Новая админ-панель в том же тёмном фиолетово-синем стиле: /admin.
- Ручные курсы USDT/RUB и GRAM/RUB.
- Настраиваемые общий и доступный резервы вывода в USD.
- Продажа через два шага: выбор TON или USDT, затем выбор сети и копирование кошелька BLUP; после подтверждения отправки — заполнение заявки. USDT: BEP20, TRC20, ERC20, TON, SPL; TON: TON.
- Получение по телефону (СБП) или карте, выбор банка. Каталог включает распространённые банки РФ; его можно расширять из админки.
- История заявок, статусы, журнал входов, IP и время последней активности.
- Блокировка аккаунта/IP. Заблокированный IP не сможет войти или зарегистрироваться; бан аккаунта повышает версию сессии и блокирует API-запросы. Открытая страница перепроверяет доступ каждые 15 секунд.
- При отклонении запроса на вывод резерв возвращается; при возврате отклонённого запроса в работу резерв снова резервируется.
- Пароли не отправляются в Telegram. Платёжные реквизиты в Telegram маскируются.
- Миграции добавляют недостающие колонки и таблицы без удаления существующих данных.

УСТАНОВКА
1. Останови приложение и сделай резервную копию текущего data.db.
2. Распакуй архив поверх проекта. ВАЖНО: архив не содержит data.db — оставь текущую рабочую базу на месте, не удаляй и не заменяй её.
3. Замени server.js, db.js, bot.js, bot_register.js, package.json, package-lock.json и папку public файлами из архива.
4. Выполни npm ci (либо npm install).
5. В настройках переменных окружения хостинга задай:
   SESSION_SECRET — длинная случайная строка;
   BLUP_ADMIN_PASSWORD — отдельный длинный пароль администратора;
   NODE_ENV=production;
   TRUST_PROXY=1 — только если платформа работает через доверенный reverse proxy.
6. Для двух Telegram-ботов задай TELEGRAM_BOT_1_TOKEN, TELEGRAM_BOT_1_CHAT_ID, TELEGRAM_BOT_2_TOKEN и TELEGRAM_BOT_2_CHAT_ID. Для Telegram Login отдельно задай TELEGRAM_LOGIN_BOT_TOKEN и TELEGRAM_LOGIN_BOT_USERNAME. Это необязательно для запуска сайта.
7. Перезапусти приложение. Открой /admin и войди с BLUP_ADMIN_PASSWORD.
8. В админке укажи реальные курсы, резерв и проверь список банков. Пока курс не задан (0), сайт показывает «не задан».

ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ
Пример находится в .env.example. Приложение не загружает .env автоматически: добавляй значения в панель переменных окружения хостинга либо подключи dotenv отдельно.

ВАЖНЫЕ ЗАМЕЧАНИЯ ПО БЕЗОПАСНОСТИ
- Токены Telegram-ботов и пароль администратора из ранее переданного исходного проекта были записаны прямо в коде. Считай их скомпрометированными: отзови/перевыпусти токены через BotFather и установи новые значения только в переменных окружения. Старый пароль администратора также замени.
- Не отправляй в Telegram пароль пользователя, CVV/CVC, PIN или одноразовые SMS-коды. BLUP не запрашивает CVV/CVC, PIN или SMS-коды.
- IP-адреса и платёжные реквизиты являются чувствительными данными. Перед запуском опубликуй политику конфиденциальности, ограничь доступ к БД/резервным копиям и установи срок хранения этих данных.
- IP-блокировка зависит от корректной настройки TRUST_PROXY. Если хостинг работает через прокси, включи доверие только к прокси хостинга; не доверяй произвольным X-Forwarded-For от клиентов.
- Каталог содержит распространённые банки РФ, а не юридически исчерпывающий список всех действующих банков. Его можно расширить из админки; значки — нейтральные обозначения, не официальные логотипы.
- Курсы задаются вручную администратором и не являются автоматически обновляемой рыночной котировкой.
- Это система приёма заявок, а не автоматический криптообменник: перевод средств, проверка транзакций и фактическая выплата по-прежнему требуют ручной обработки оператором.

ДАННЫЕ И СЕССИИ
Миграции добавляют колонки/таблицы к текущей базе без удаления аккаунтов и заявок. Старые аккаунты сохраняются; новые пароли при регистрации должны быть длиной не менее 10 символов. Уникальность ника проверяется без учёта регистра. Пароль не используется как идентификатор аккаунта.

ОБНОВЛЕНИЕ BLUP: ПРОДАЖА / ВЫВОД / ПРОФИЛЬ / ПРОМОКОДЫ
- Перед обновлением сделайте резервную копию data.db.
- Замените файлы проекта файлами из архива, но НЕ удаляйте и НЕ заменяйте существующую data.db.
- При старте сервер автоматически добавит новые поля и таблицу промокодов.
- Для Telegram-уведомлений задайте обе пары TELEGRAM_BOT_1_TOKEN / TELEGRAM_BOT_1_CHAT_ID и TELEGRAM_BOT_2_TOKEN / TELEGRAM_BOT_2_CHAT_ID. Telegram Login использует отдельную переменную TELEGRAM_LOGIN_BOT_TOKEN.
- Уведомления о регистрации не содержат пароль. Пароли хранятся только в виде bcrypt-хеша; восстановление возможно только через отдельную процедуру сброса.
- Время уведомлений указывается по часовому поясу Europe/Moscow.
- Запрос на вывод доступен только после того, как администратор переведёт соответствующую заявку продажи в статус «Выполнена». Сумма RUB вычисляется сервером по действующему курсу USDT/RUB или TON/RUB.

ОБНОВЛЁННЫЙ СЦЕНАРИЙ ПРОДАЖИ
- В заявке продажи пользователь указывает сумму, валюту/сеть, реквизиты выплаты (телефон/СБП или карту), банк, Telegram username и комментарий.
- На экране показывается точный кошелёк BLUP для выбранной валюты и сети; адрес и реквизиты выплаты сохраняются в заявке и передаются администратору в Telegram.
- Перевод криптовалюты, его подтверждение и отправка рублей остаются ручными действиями администратора; статус нельзя считать подтверждением блокчейн-платежа.

TELEGRAM SETUP (UPDATED)
------------------------
1. Set TELEGRAM_BOT_1_TOKEN and TELEGRAM_BOT_1_CHAT_ID in Amvera.
2. Set TELEGRAM_BOT_2_TOKEN and TELEGRAM_BOT_2_CHAT_ID in Amvera.
   Both bots receive the same registration, sale and promo notifications.
3. Set TELEGRAM_LOGIN_BOT_TOKEN to the token of the bot used for Telegram Login.
   Set TELEGRAM_LOGIN_BOT_USERNAME to that bot's username without @.
4. In @BotFather, open the login bot and run /setdomain. Select the same bot,
   then enter exactly: blup-bluup.msk1.amvera.tech (without https:// or a path).
   Telegram checks this on its side; a code change alone cannot register a domain.
5. Rotate any bot token that was pasted into a chat, repository or public log.
   Never put bot tokens into public/ JavaScript files.


=== BLUP CASES (НОВЫЙ РАЗДЕЛ) ===

Раздел кейсов открывается по адресу /cases. Старый адрес /games перенаправляет на /cases.
В интерфейсе оставлен один режим — «Кейсы»: 25 кейсов, по 15 возможных CS2-предметов в каждом.

Пополнение баланса:
- пользователь выбирает USDT или TON и сеть;
- указывает количество монет, вводит промокод (если есть), отправляет перевод на адрес BLUP и указывает TX hash;
- заявка появляется в админ-панели по адресу /admin/cases;
- баланс зачисляется только после ручной проверки транзакции и подтверждения администратором.

Вывод:
- пользователь указывает сумму (минимум 10 USD), способ выплаты, телефон/карту и банк;
- сумма резервируется при создании заявки;
- при отклонении администратором сумма возвращается на баланс.

Промокоды для бонуса к балансу кейсов создаются в админ-панели: «Пополнение кейсов +5% / +10% / +25%».
Курс TON для пересчёта в баланс берётся из действующих настроек TON/USDT (gram_rate / usdt_rate).

Цены скинов в каталоге — ориентировочные рыночные значения в USD, не live-котировки и не гарантия цены продажи. Изображения подгружаются из публичного каталога CS2-скинов ByMykel/CSGO-API. Выигрыши пока сохраняются во внутреннем инвентаре BLUP; Steam trade / реальная выдача предметов не подключены.

=== BLUP CASES UPDATE (14.11.2026) ===
- Case mode remains hidden from the main homepage; direct route: /cases.
- Case profile/inventory and Steam Trade URL settings: /cases/profile.
- 25 generated case cover images are served as WebP URLs: /assets/cases/case-01.webp ... case-25.webp.
- Case catalogue contains 25 cases with 18-22 items each. All configured skin prices are between $0.20 and $50.00.
- The case page currency selector displays USDT or RUB. RUB uses the admin usdt_rate setting; if unset, a fallback market snapshot is used until the admin configures the rate.
- Users can sell an inventory skin for 90% of the configured reference price, credited to their BLUP case balance.
- Users can request a Steam skin withdrawal after saving a valid Steam Trade URL in their profile. The request is visible in /admin/cases. Admin must manually send the Steam trade and then approve the request; approving removes the item from BLUP inventory.
- Market prices are indicative snapshots, not guaranteed live executable quotes. Refresh prices and verify exact wear/float before using the catalogue for real-money operations.
