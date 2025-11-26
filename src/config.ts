import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

// Валидация обязательных переменных
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Переменная окружения ${name} не установлена!`);
  }
  return value;
}

export const config = {
  // Telegram Bot
  telegram: {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    adminIds: requireEnv('TELEGRAM_ADMIN_ID').split(',').map(id => parseInt(id.trim())),
    adminChatId: requireEnv('TELEGRAM_ADMIN_CHAT_ID'),
    managerUsername: process.env.MANAGER_USERNAME || 'namewasntdrown'
  },

  // Database
  database: {
    url: requireEnv('DATABASE_URL')
  },

  // TON Blockchain & USDT
  ton: {
    walletAddress: requireEnv('TON_WALLET_ADDRESS'),
    apiEndpoint: process.env.TON_API_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TON_API_KEY || '',
    // USDT Jetton контракт в сети TON
    usdtJettonAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
  },

  // WebApp
  webapp: {
    url: process.env.WEBAPP_URL || 'http://localhost:3000',
    port: parseInt(process.env.PORT || '3000')
  },

  // Настройки бронирования
  booking: {
    // Доступные дни недели (0 = воскресенье, 1 = понедельник, ..., 6 = суббота)
    availableDays: [1, 2, 3, 4, 5], // понедельник - пятница
    // Часы работы (Москва UTC+3)
    startHour: 12,
    endHour: 16,
    // Длительность слота в минутах
    slotDuration: 60,
    // Часовой пояс
    timezone: 'Europe/Moscow',
    // Время резервирования слота в минутах
    reservationDuration: 30,
    // Время действия платежа в минутах
    paymentExpiration: 60
  },

  // Окружение
  env: process.env.NODE_ENV || 'development'
};

// Проверка конфигурации при загрузке модуля
console.log('✅ Конфигурация загружена успешно');
console.log(`📦 Окружение: ${config.env}`);
console.log(`🤖 Telegram Bot: ${config.telegram.botToken.substring(0, 20)}...`);
console.log(`💎 TON Wallet: ${config.ton.walletAddress}`);
console.log(`🌐 WebApp URL: ${config.webapp.url}`);
