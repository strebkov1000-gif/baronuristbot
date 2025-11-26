# Быстрый старт

Краткая инструкция для запуска бота на локальной машине или сервере.

## Предварительные требования

- Node.js 20+
- PostgreSQL 14+
- npm или yarn

## Установка за 5 минут

### 1. Установите зависимости

```bash
cd telegram-bot
npm install
```

### 2. Настройте PostgreSQL

```bash
# Создайте базу данных
sudo -u postgres psql
CREATE DATABASE pravo_xii_bot;
CREATE USER pravo_user WITH ENCRYPTED PASSWORD 'password123';
GRANT ALL PRIVILEGES ON DATABASE pravo_xii_bot TO pravo_user;
\q
```

### 3. Создайте .env файл

```bash
cp .env.example .env
nano .env
```

Минимальная конфигурация:

```env
TELEGRAM_BOT_TOKEN=8254023112:AAErSzOM8-2esYAkCmWYpwPZc9YiLUkKCUo
TELEGRAM_ADMIN_ID=669932688
TELEGRAM_ADMIN_CHAT_ID=-1003493855451
DATABASE_URL=postgresql://pravo_user:password123@localhost:5432/pravo_xii_bot
TON_WALLET_ADDRESS=UQCVeQzrFSinGaW-rX-_kBh5AJxpok2NMtzg9VmqGiMgYOW8
WEBAPP_URL=http://localhost:3000
PORT=3000
MANAGER_USERNAME=namewasntdrown
NODE_ENV=development
```

### 4. Инициализируйте базу данных

```bash
# Генерация Prisma Client
npx prisma generate

# Применение миграций
npx prisma migrate deploy

# Заполнение начальными данными
npm run prisma:seed
```

### 5. Запустите бота

```bash
# Режим разработки
npm run dev
```

Бот запустится и вы увидите:

```
✅ Конфигурация загружена успешно
✅ Подключение к БД установлено
✅ WebApp сервер запущен на порту 3000
🚀 Запущена периодическая проверка платежей (каждые 30 сек)
✅ Бот успешно запущен!
```

## Тестирование

1. Откройте бота в Telegram
2. Отправьте команду `/start`
3. Выберите услугу
4. Откроется WebApp с календарём
5. Выберите дату и время
6. Нажмите "Подтвердить бронирование"

## Проверка работы

### Проверка базы данных

```bash
# Откроется веб-интерфейс на http://localhost:5555
npx prisma studio
```

### Проверка WebApp

Откройте в браузере:
```
http://localhost:3000/booking?service=<SERVICE_ID>
```

Где `<SERVICE_ID>` - ID услуги из базы данных.

## Деплой на production

См. подробные инструкции в [README.md](README.md)

Основные шаги:
1. Установите PM2: `sudo npm install -g pm2`
2. Запустите: `pm2 start ecosystem.config.js`
3. Сохраните: `pm2 save`
4. Автозапуск: `pm2 startup`

## Полезные команды

```bash
# Разработка
npm run dev

# Просмотр БД
npx prisma studio

# Миграции
npx prisma migrate dev

# Seed данных
npm run prisma:seed

# Production
pm2 start ecosystem.config.js
pm2 logs pravo-xii-bot
pm2 restart pravo-xii-bot
```

## Возможные проблемы

### Ошибка подключения к БД

Проверьте `DATABASE_URL` в `.env` и убедитесь, что PostgreSQL запущен:

```bash
sudo systemctl status postgresql
```

### Ошибка с Prisma

Попробуйте:

```bash
npx prisma generate
npx prisma migrate deploy
```

### Бот не отвечает

Проверьте токен бота и убедитесь, что бот не запущен в другом месте.

---

Готово! Теперь ваш бот должен работать 🚀
