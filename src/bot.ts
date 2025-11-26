import { Telegraf, session, Context as TelegrafContext } from 'telegraf';
import { config } from './config';
import { handleStart, showMainMenu, showConsultationsMenu, showMyBookings, showReferralProgram } from './handlers/start';
import { handleServiceSelect, handleBackToServices } from './handlers/services';
import { handleSurveyResponse, handleVoiceResponse, SurveyState } from './handlers/survey';
import {
  handleWebAppData,
  handleTonPayment,
  handleStarsPayment,
  handleCheckPayment,
  handleCancelBooking,
  handleSuccessfulPayment,
  handleUserDataInput,
  handlePromoButton,
  handlePromoCodeInput
} from './handlers/webapp';
import {
  adminMiddleware,
  isAdminChat,
  handleAdminCommand,
  handleBookingsCommand,
  handleWeekCommand,
  handleStatsCommand,
  handleConfirmCommand,
  handleCancelCommand,
  handleSlotCommand,
  handleSlotsCommand,
  handleDelSlotCommand,
  handleAddWeekCommand,
  handlePendingCommand,
  handleGenSlotsCommand,
  handlePromoCommand,
  handlePromosCommand,
  handlePromoDelCommand,
  handlePendingMemoCommand
} from './handlers/admin';
import { startPaymentChecker, cleanupExpiredPayments } from './ton/payment-checker';
import { cleanupExpiredReservations, startWeeklySlotScheduler } from './services/slots';
import { startWebAppServer } from './webapp-server';
import { startReminderChecker } from './services/reminders';

// Расширяем интерфейс Context для поддержки session
interface SessionData {
  surveyState?: SurveyState;
  pendingBookingId?: string;
  pendingServiceId?: string;
  awaitingUserData?: string; // ID бронирования для ввода данных
  awaitingPromoCode?: string; // ID платежа для ввода промокода
  appliedPromoCode?: { // Применённый промокод
    id: string;
    code: string;
    discountPercent: number;
    discountAmount: number;
  };
}

interface MyContext extends TelegrafContext {
  session: SessionData;
}

// Создаём бота
const bot = new Telegraf<MyContext>(config.telegram.botToken);

// Подключаем middleware для сессий
bot.use(session());

// Инициализация сессии
bot.use((ctx, next) => {
  if (!ctx.session) {
    ctx.session = {};
  }
  return next();
});

// ===================
// ОБРАБОТЧИКИ КОМАНД
// ===================

// Команда /start
bot.command('start', handleStart);

// Админ-команды
bot.command('admin', adminMiddleware, handleAdminCommand);
bot.command('bookings', adminMiddleware, handleBookingsCommand);
bot.command('week', adminMiddleware, handleWeekCommand);
bot.command('stats', adminMiddleware, handleStatsCommand);
bot.command('confirm', adminMiddleware, handleConfirmCommand);
bot.command('cancel', adminMiddleware, handleCancelCommand);

// Команды управления слотами (работают в админ-чате и для админа)
bot.command('slot', adminMiddleware, handleSlotCommand);
bot.command('slots', adminMiddleware, handleSlotsCommand);
bot.command('delslot', adminMiddleware, handleDelSlotCommand);
bot.command('addweek', adminMiddleware, handleAddWeekCommand);
bot.command('genslots', adminMiddleware, handleGenSlotsCommand);
bot.command('pending', adminMiddleware, handlePendingCommand);
bot.command('pending_memo', adminMiddleware, handlePendingMemoCommand);

// Команды управления промокодами
bot.command('promo', adminMiddleware, handlePromoCommand);
bot.command('promos', adminMiddleware, handlePromosCommand);
bot.command('promodel', adminMiddleware, handlePromoDelCommand);

// Команда /help
bot.command('help', async (ctx) => {
  await ctx.replyWithHTML(
    '<b>📚 Помощь</b>\n\n' +
    'Доступные команды:\n' +
    '/start - Начать работу с ботом\n' +
    '/help - Показать это сообщение\n\n' +
    'Для бронирования консультации нажмите /start и выберите услугу.'
  );
});

// ===================
// CALLBACK HANDLERS
// ===================

// ===================
// ОБРАБОТЧИКИ МЕНЮ
// ===================

// Главное меню
bot.action('menu:main', async (ctx) => {
  await ctx.answerCbQuery();
  await showMainMenu(ctx);
});

// Юридические консультации
bot.action('menu:consultations', async (ctx) => {
  await ctx.answerCbQuery();
  await showConsultationsMenu(ctx);
});

// Мои записи
bot.action('menu:bookings', async (ctx) => {
  await ctx.answerCbQuery();
  await showMyBookings(ctx);
});

// Реферальная программа
bot.action('menu:referrals', async (ctx) => {
  await ctx.answerCbQuery();
  await showReferralProgram(ctx);
});

// Поделиться реферальной ссылкой
bot.action('referral:share', async (ctx) => {
  await ctx.answerCbQuery();

  if (!ctx.from) return;

  const { getUserByTelegramId } = await import('./services/user');
  const user = await getUserByTelegramId(ctx.from.id);

  if (!user || !user.referralCode) {
    await ctx.reply('Ошибка получения реферальной ссылки');
    return;
  }

  const botInfo = await ctx.telegram.getMe();
  const referralLink = `https://t.me/${botInfo.username}?start=${user.referralCode}`;

  await ctx.reply(
    `Ваша реферальная ссылка:\n${referralLink}\n\n` +
    `Поделитесь ею с друзьями и получайте 5% от стоимости их консультаций!`
  );
});

// ===================
// ОБРАБОТЧИКИ УСЛУГ
// ===================

// Обработчик выбора услуги
bot.action(/^service:(.+)$/, async (ctx) => {
  const serviceId = ctx.match[1];
  await handleServiceSelect(ctx, serviceId);
});

// Обработчик кнопки "Назад к услугам"
bot.action('back:services', handleBackToServices);

// Обработчик кнопки "Забронировать" (без Mini App)
bot.action(/^book:(.+)$/, async (ctx) => {
  const serviceId = ctx.match[1];
  await ctx.answerCbQuery();
  await ctx.reply(
    '📅 Для бронирования даты и времени, пожалуйста, свяжитесь с нашим менеджером:\n\n' +
    `👤 @${config.telegram.managerUsername}\n\n` +
    'Или напишите нам в чат, и мы подберём удобное для вас время!'
  );
});

// Обработчик кнопки "Оплатить TON"
bot.action(/^payment:ton:(.+)$/, async (ctx) => {
  const paymentId = ctx.match[1];
  await handleTonPayment(ctx, paymentId);
});

// Обработчик кнопки "Оплатить Stars"
bot.action(/^payment:stars:(.+)$/, async (ctx) => {
  const paymentId = ctx.match[1];
  await handleStarsPayment(ctx, paymentId);
});

// Обработчик кнопки "Проверить статус платежа" (новый формат check:paymentId)
bot.action(/^check:(.+)$/, async (ctx) => {
  const paymentId = ctx.match[1];
  await handleCheckPayment(ctx, paymentId);
});

// Обработчик кнопки "Отменить бронирование"
bot.action(/^cancel:(.+)$/, async (ctx) => {
  const bookingId = ctx.match[1];
  await handleCancelBooking(ctx, bookingId);
});

// Обработчик кнопки "У меня есть промокод"
bot.action(/^promo:(.+)$/, async (ctx) => {
  const paymentId = ctx.match[1];
  await handlePromoButton(ctx, paymentId);
});

// ===================
// ОБРАБОТЧИКИ СООБЩЕНИЙ
// ===================

// Обработчик WebApp данных (выбор даты и времени)
bot.on('web_app_data', handleWebAppData);

// Обработчик успешной оплаты Stars
bot.on('successful_payment', handleSuccessfulPayment);

// Pre-checkout query для Stars
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

// Обработчик голосовых сообщений (для анкеты)
bot.on('voice', handleVoiceResponse);

// Обработчик текстовых сообщений (для анкеты и общих вопросов)
bot.on('text', async (ctx) => {
  // Если ожидаем промокод
  if (ctx.session.awaitingPromoCode) {
    await handlePromoCodeInput(ctx);
    return;
  }

  // Если ожидаем данные пользователя (имя и username)
  if (ctx.session.awaitingUserData) {
    await handleUserDataInput(ctx);
    return;
  }

  // Если есть активная анкета, обрабатываем ответы
  if (ctx.session.surveyState) {
    await handleSurveyResponse(ctx);
  } else {
    // Иначе отправляем справку
    await ctx.reply(
      'Для начала работы используйте команду /start\n' +
      'Для помощи используйте команду /help'
    );
  }
});

// ===================
// ПЕРИОДИЧЕСКИЕ ЗАДАЧИ
// ===================

/**
 * Запускает периодические задачи бота
 */
function startPeriodicTasks() {
  // Проверка TON платежей каждые 30 секунд
  startPaymentChecker(bot, 30);

  // Очистка истекших резервирований каждые 5 минут
  setInterval(async () => {
    const count = await cleanupExpiredReservations();
    if (count > 0) {
      console.log(`🧹 Очищено истекших резервирований: ${count}`);
    }
  }, 5 * 60 * 1000);

  // Очистка истекших платежей каждые 10 минут
  setInterval(async () => {
    await cleanupExpiredPayments();
  }, 10 * 60 * 1000);

  // Напоминания о консультациях за 1 час
  startReminderChecker(bot);

  // Автоматическое создание слотов каждое воскресенье в 19:00
  startWeeklySlotScheduler(bot);
}

// ===================
// ЗАПУСК БОТА
// ===================

async function main() {
  try {
    console.log('🚀 Запуск бота PRAVO XII...');

    // Проверяем подключение к БД
    const { prisma } = await import('./services/database');
    await prisma.$connect();
    console.log('✅ Подключение к БД установлено');

    // Запускаем WebApp сервер
    startWebAppServer();

    // Запускаем периодические задачи
    startPeriodicTasks();

    // Запускаем бота
    await bot.launch();

    console.log('✅ Бот успешно запущен!');
    console.log(`📦 Окружение: ${config.env}`);
    console.log(`🤖 Бот: @${(await bot.telegram.getMe()).username}`);

    // Graceful shutdown
    process.once('SIGINT', () => {
      console.log('\n⚠️ Получен сигнал SIGINT, завершаем работу...');
      bot.stop('SIGINT');
      prisma.$disconnect();
    });

    process.once('SIGTERM', () => {
      console.log('\n⚠️ Получен сигнал SIGTERM, завершаем работу...');
      bot.stop('SIGTERM');
      prisma.$disconnect();
    });
  } catch (error) {
    console.error('❌ Ошибка при запуске бота:', error);
    process.exit(1);
  }
}

// Запускаем бота
if (require.main === module) {
  main();
}

export { bot };
