# 📁 СТРУКТУРА ПРОЕКТА PRAVO XII BOT

```
telegram-bot/
│
├── 📄 README.md                    # Документация проекта
├── 📄 QUICKSTART.md                # Быстрый старт
├── 📄 package.json                 # Зависимости и скрипты
├── 📄 tsconfig.json                # Конфигурация TypeScript
├── 📄 ecosystem.config.js          # Конфигурация PM2
├── 📄 .env                         # Переменные окружения (НЕ в Git!)
├── 📄 .env.example                 # Пример переменных окружения
├── 📄 .gitignore                   # Исключения для Git
│
├── 📂 src/                         # Исходный код приложения
│   │
│   ├── 📄 bot.ts                   # 🤖 ГЛАВНЫЙ ФАЙЛ БОТА
│   │   ├─ Инициализация Telegraf
│   │   ├─ Session middleware
│   │   ├─ Все обработчики команд
│   │   ├─ Callback handlers
│   │   └─ Graceful shutdown
│   │
│   ├── 📄 config.ts                # ⚙️ Конфигурация приложения
│   │   ├─ Загрузка .env
│   │   ├─ Валидация переменных
│   │   ├─ Telegram настройки
│   │   ├─ TON настройки
│   │   └─ Настройки бронирования
│   │
│   ├── 📄 webapp-server.ts         # 🌐 Express сервер для WebApp
│   │   ├─ API /api/services/:id
│   │   ├─ API /api/slots
│   │   ├─ Раздача статики /webapp
│   │   └─ Error handling
│   │
│   ├── 📂 handlers/                # Обработчики команд и событий
│   │   │
│   │   ├── 📄 start.ts             # Команда /start
│   │   │   ├─ Создание пользователя
│   │   │   ├─ Загрузка услуг из БД
│   │   │   └─ Отображение кнопок
│   │   │
│   │   ├── 📄 services.ts          # Обработка выбора услуг
│   │   │   ├─ handleServiceSelect()
│   │   │   ├─ showServiceDescription()
│   │   │   ├─ handleOtherService()
│   │   │   └─ handleBackToServices()
│   │   │
│   │   ├── 📄 webapp.ts            # Обработка WebApp данных
│   │   │   ├─ handleWebAppData()
│   │   │   ├─ handleTonPayment()
│   │   │   ├─ handleCheckPayment()
│   │   │   ├─ handleCancelBooking()
│   │   │   └─ sendBookingNotificationToAdmins()
│   │   │
│   │   ├── 📄 survey.ts            # Система анкет
│   │   │   ├─ handleSurveyResponse()
│   │   │   ├─ handleVoiceResponse()
│   │   │   ├─ completeSurvey()
│   │   │   ├─ sendSurveyToAdmins()
│   │   │   └─ startSurveyAfterPayment()
│   │   │
│   │   └── 📄 admin.ts             # Админ-панель
│   │       ├─ isAdmin() - проверка прав
│   │       ├─ handleAdminCommand()
│   │       ├─ handleBookingsCommand()
│   │       ├─ handleWeekCommand()
│   │       ├─ handleStatsCommand()
│   │       ├─ handleConfirmCommand()
│   │       └─ handleCancelCommand()
│   │
│   ├── 📂 services/                # Бизнес-логика
│   │   │
│   │   ├── 📄 database.ts          # Prisma Client
│   │   │   └─ Singleton подключение к БД
│   │   │
│   │   ├── 📄 user.ts              # Управление пользователями
│   │   │   ├─ findOrCreateUser()
│   │   │   ├─ getUserByTelegramId()
│   │   │   ├─ getUserById()
│   │   │   └─ getUsersCount()
│   │   │
│   │   ├── 📄 booking.ts           # Управление бронированиями
│   │   │   ├─ createBooking()
│   │   │   ├─ getBookingById()
│   │   │   ├─ confirmBooking()
│   │   │   ├─ cancelBooking()
│   │   │   ├─ getTodayBookings()
│   │   │   ├─ getWeekBookings()
│   │   │   └─ formatBookingInfo()
│   │   │
│   │   └── 📄 slots.ts             # Управление временными слотами
│   │       ├─ isAvailableDay()
│   │       ├─ generateTimeSlots()
│   │       ├─ isSlotAvailable()
│   │       ├─ getAvailableSlots()
│   │       ├─ createReservation()
│   │       ├─ cancelReservation()
│   │       └─ cleanupExpiredReservations()
│   │
│   └── 📂 ton/                     # TON Blockchain интеграция
│       │
│       └── 📄 payment-checker.ts   # 💎 Проверка TON платежей
│           ├─ initTonClient()
│           ├─ checkIncomingTransactions()
│           ├─ notifyUserAboutPayment()
│           ├─ notifyAdminsAboutPayment()
│           ├─ startPaymentChecker()
│           └─ cleanupExpiredPayments()
│
├── 📂 webapp/                      # 📱 Mini App интерфейс
│   │
│   ├── 📄 index.html               # Главная страница
│   │   ├─ Шаги бронирования (1-2-3)
│   │   ├─ Календарь выбора даты
│   │   ├─ Слоты времени
│   │   └─ Подтверждение
│   │
│   ├── 📄 styles.css               # 🎨 Стили в стиле PRAVO XII
│   │   ├─ Минималистичный дизайн
│   │   ├─ Крупная типографика
│   │   ├─ Контрастные цвета
│   │   └─ Адаптивная вёрстка
│   │
│   └── 📄 app.js                   # Логика WebApp
│       ├─ Telegram WebApp SDK
│       ├─ renderCalendar()
│       ├─ selectDate()
│       ├─ loadAvailableSlots()
│       ├─ selectTimeSlot()
│       └─ confirmBooking()
│
├── 📂 prisma/                      # 🗄️ База данных
│   │
│   ├── 📄 schema.prisma            # Схема БД
│   │   ├─ Model: User
│   │   ├─ Model: Service
│   │   ├─ Model: Booking
│   │   ├─ Model: Reservation
│   │   ├─ Model: Payment
│   │   ├─ Model: UserSurvey
│   │   └─ Enums: BookingStatus, PaymentStatus...
│   │
│   ├── 📄 seed.ts                  # Начальные данные
│   │   └─ 4 услуги (online, written, conclusion, other)
│   │
│   └── 📂 migrations/              # Миграции БД
│       ├── migration_lock.toml
│       └── 20251124160509_init/
│           └── migration.sql
│
└── 📂 logs/                        # Логи (не в Git)
    └── bot.log                     # Логи работы бота
```

## 🔄 ПОТОК ДАННЫХ

### 1. Бронирование консультации:
```
Пользователь → /start
    ↓
Выбор услуги (service_online/written/conclusion)
    ↓
Показ описания
    ↓
Нажатие "Забронировать" → Открытие Mini App
    ↓
Выбор даты в календаре → API /api/slots
    ↓
Выбор времени
    ↓
Подтверждение → sendData() в бот
    ↓
Создание Booking + Payment в БД
    ↓
Отправка реквизитов TON
    ↓
TON Payment Checker (каждые 30 сек) → Проверка транзакций
    ↓
Платёж найден → Обновление статуса → Уведомления
    ↓
Запуск анкеты (имя, телефон, проблема, материалы)
    ↓
Отправка данных админам в чат
```

### 2. "Иные услуги":
```
Пользователь → /start
    ↓
Выбор "Иные услуги"
    ↓
Сразу анкета (без бронирования и оплаты)
    ↓
Отправка данных админам
```

### 3. Админ-панель:
```
Админ → /admin
    ↓
/bookings - список на сегодня
/week - список на неделю
/stats - статистика
/confirm <id> - подтверждение оплаты вручную
/cancel <id> - отмена бронирования
```

## 📊 БАЗА ДАННЫХ

### Таблицы:
- **users** - пользователи Telegram
- **services** - 4 услуги
- **bookings** - бронирования консультаций
- **payments** - TON платежи
- **reservations** - временные резервирования (30 мин)
- **user_surveys** - анкеты пользователей

### Связи:
- User → Booking (1:N)
- User → Payment (1:N)
- User → Reservation (1:N)
- User → UserSurvey (1:N)
- Service → Booking (1:N)
- Booking → Payment (1:1)

## 🚀 ЗАПУСК

### Разработка:
```bash
npm run dev
```

### Продакшн:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 🔧 КОНФИГУРАЦИЯ

Все настройки в `.env`:
- TELEGRAM_BOT_TOKEN
- DATABASE_URL
- TON_WALLET_ADDRESS
- WEBAPP_URL (должен быть HTTPS!)

## ⚡ КЛЮЧЕВЫЕ ОСОБЕННОСТИ

1. **Session Management** - хранение состояния анкет
2. **TON Auto-Check** - автоматическая проверка платежей
3. **Slot Reservation** - резервирование на 30 минут
4. **Admin Panel** - полный контроль бронирований
5. **Mini App** - красивый UI в стиле PRAVO XII
6. **Graceful Shutdown** - корректное завершение

