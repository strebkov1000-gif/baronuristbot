import { Telegraf, Context } from 'telegraf';
import { prisma } from './database';
import { config } from '../config';

/**
 * Отправляет напоминания о консультациях за 1 час
 */
export async function sendBookingReminders(bot: Telegraf<any>) {
  try {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const fiftyMinutesFromNow = new Date(now.getTime() + 50 * 60 * 1000);

    // Находим бронирования, которые начнутся через ~1 час (окно 50-60 минут)
    const bookings = await prisma.booking.findMany({
      where: {
        status: 'CONFIRMED',
        startTime: {
          gte: fiftyMinutesFromNow,
          lte: oneHourFromNow
        }
      },
      include: {
        user: true,
        service: true
      }
    });

    for (const booking of bookings) {
      // Проверяем, не отправляли ли мы уже напоминание
      // (можно добавить поле reminderSent в схему, но пока просто отправим)

      const startTimeFormatted = booking.startTime.toLocaleString('ru-RU', {
        timeZone: config.booking.timezone,
        hour: '2-digit',
        minute: '2-digit'
      });

      try {
        await bot.telegram.sendMessage(
          booking.user.telegramId.toString(),
          `<b>⏰ Напоминание о консультации</b>\n\n` +
          `Через 1 час у вас запланирована консультация:\n\n` +
          `🔧 <b>${booking.service.name}</b>\n` +
          `🕐 <b>Время:</b> ${startTimeFormatted} (МСК)\n\n` +
          `Пожалуйста, подготовьтесь к звонку!`,
          { parse_mode: 'HTML' }
        );

        console.log(`📨 Отправлено напоминание пользователю ${booking.user.telegramId} о бронировании ${booking.id}`);
      } catch (error) {
        console.error(`Ошибка отправки напоминания пользователю ${booking.user.telegramId}:`, error);
      }
    }

    if (bookings.length > 0) {
      console.log(`📨 Отправлено ${bookings.length} напоминаний о консультациях`);
    }
  } catch (error) {
    console.error('Ошибка в sendBookingReminders:', error);
  }
}

/**
 * Запускает проверку напоминаний каждые 10 минут
 */
export function startReminderChecker(bot: Telegraf<any>) {
  // Проверяем сразу при запуске
  sendBookingReminders(bot);

  // Затем каждые 10 минут
  setInterval(() => {
    sendBookingReminders(bot);
  }, 10 * 60 * 1000);

  console.log('✅ Система напоминаний запущена (проверка каждые 10 минут)');
}
