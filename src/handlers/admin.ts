import { Context } from 'telegraf';
import { config } from '../config';
import { getTodayBookings, getWeekBookings, formatBookingInfo } from '../services/booking';
import { getUsersCount } from '../services/user';
import { prisma } from '../services/database';
import { format, parse, addDays, isValid } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  createPromoCode,
  getActivePromoCodes,
  deactivatePromoCode,
  getServiceIdFromShortName,
  getServiceNameById
} from '../services/promo';
import { ignoredTransactions } from '../ton/payment-checker';

/**
 * Создаёт дату в UTC без времени (только дата)
 */
function toUTCDate(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/**
 * Получает начало сегодняшнего дня в UTC
 */
function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Проверяет, является ли пользователь админом
 */
export function isAdmin(ctx: Context): boolean {
  return ctx.from ? config.telegram.adminIds.includes(ctx.from.id) : false;
}

/**
 * Проверяет, что сообщение из админ-чата
 */
export function isAdminChat(ctx: Context): boolean {
  const chatId = ctx.chat?.id?.toString();
  return chatId === config.telegram.adminChatId;
}

/**
 * Middleware для проверки прав админа
 */
export async function adminMiddleware(ctx: Context, next: () => Promise<void>) {
  if (!isAdmin(ctx)) {
    await ctx.reply('У вас нет доступа к этой команде.');
    return;
  }
  return next();
}

/**
 * Команда /admin - показывает список админ-команд
 */
export async function handleAdminCommand(ctx: Context) {
  const text = `<b>🔧 Админ-панель PRAVO XII</b>\n\n` +
    `<b>📅 Управление слотами:</b>\n` +
    `<code>/genslots</code> - Создать слоты до конца недели\n` +
    `<code>/slot ДД.ММ ЧЧ:ММ</code> - Создать один слот\n` +
    `<code>/slots</code> - Все слоты на 30 дней\n` +
    `<code>/slots ДД.ММ</code> - Слоты на дату\n` +
    `<code>/delslot ДД.ММ ЧЧ:ММ</code> - Удалить слот\n\n` +
    `<b>📋 Бронирования:</b>\n` +
    `<code>/pending</code> - Ожидают оплаты\n` +
    `<code>/pending_memo</code> - Платежи на ручной проверке\n` +
    `<code>/bookings</code> - На сегодня\n` +
    `<code>/week</code> - На неделю\n` +
    `<code>/confirm ID</code> - Подтвердить оплату\n` +
    `<code>/cancel ID</code> - Отменить\n\n` +
    `<b>💳 Платежи:</b>\n` +
    `<code>/ignore_tx HASH</code> - Игнорировать транзакцию\n` +
    `<code>/ignored_txs</code> - Список игнорируемых\n` +
    `<code>/clear_ignored</code> - Очистить список\n\n` +
    `<b>🎁 Промокоды:</b>\n` +
    `<code>/promo КОД % ДД.ММ.ГГГГ [услуга]</code> - Создать\n` +
    `<code>/promos</code> - Список промокодов\n` +
    `<code>/promodel КОД</code> - Деактивировать\n\n` +
    `<b>📊 Статистика:</b>\n` +
    `<code>/stats</code> - Общая статистика`;

  await ctx.replyWithHTML(text);
}

/**
 * Команда /bookings - показывает бронирования на сегодня
 */
export async function handleBookingsCommand(ctx: Context) {
  try {
    const bookings = await getTodayBookings();

    if (bookings.length === 0) {
      await ctx.reply('На сегодня нет бронирований.');
      return;
    }

    let response = `<b>📅 Бронирования на сегодня (${bookings.length})</b>\n\n`;

    for (const booking of bookings) {
      response += formatBookingInfo(booking) + '\n\n---\n\n';
    }

    // Telegram ограничивает длину сообщения, разбиваем на несколько
    const maxLength = 4000;
    if (response.length > maxLength) {
      const chunks = response.match(/.{1,4000}/gs) || [];
      for (const chunk of chunks) {
        await ctx.replyWithHTML(chunk);
      }
    } else {
      await ctx.replyWithHTML(response);
    }
  } catch (error) {
    console.error('Ошибка в handleBookingsCommand:', error);
    await ctx.reply('Произошла ошибка при получении бронирований.');
  }
}

/**
 * Команда /week - показывает бронирования на неделю
 */
export async function handleWeekCommand(ctx: Context) {
  try {
    const bookings = await getWeekBookings();

    if (bookings.length === 0) {
      await ctx.reply('На эту неделю нет бронирований.');
      return;
    }

    let response = `<b>📅 Бронирования на неделю (${bookings.length})</b>\n\n`;

    for (const booking of bookings) {
      response += formatBookingInfo(booking) + '\n\n---\n\n';
    }

    // Разбиваем на части, если слишком длинное
    const maxLength = 4000;
    if (response.length > maxLength) {
      const chunks = response.match(/.{1,4000}/gs) || [];
      for (const chunk of chunks) {
        await ctx.replyWithHTML(chunk);
      }
    } else {
      await ctx.replyWithHTML(response);
    }
  } catch (error) {
    console.error('Ошибка в handleWeekCommand:', error);
    await ctx.reply('Произошла ошибка при получении бронирований.');
  }
}

/**
 * Команда /stats - показывает статистику
 */
export async function handleStatsCommand(ctx: Context) {
  try {
    const usersCount = await getUsersCount();
    const bookingsCount = await prisma.booking.count();
    const confirmedBookings = await prisma.booking.count({
      where: { status: 'CONFIRMED' }
    });
    const pendingBookings = await prisma.booking.count({
      where: { status: 'PENDING' }
    });
    const completedBookings = await prisma.booking.count({
      where: { status: 'COMPLETED' }
    });

    const totalRevenue = await prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amountUsd: true }
    });

    const revenueUsd = totalRevenue._sum.amountUsd
      ? (totalRevenue._sum.amountUsd / 100).toFixed(2)
      : '0.00';

    const text = `<b>📊 Статистика бота</b>\n\n` +
      `👥 <b>Всего пользователей:</b> ${usersCount}\n` +
      `📋 <b>Всего бронирований:</b> ${bookingsCount}\n\n` +
      `✅ <b>Подтверждённых:</b> ${confirmedBookings}\n` +
      `⏳ <b>Ожидают оплаты:</b> ${pendingBookings}\n` +
      `✔️ <b>Завершённых:</b> ${completedBookings}\n\n` +
      `💰 <b>Общая выручка:</b> $${revenueUsd}`;

    await ctx.replyWithHTML(text);
  } catch (error) {
    console.error('Ошибка в handleStatsCommand:', error);
    await ctx.reply('Произошла ошибка при получении статистики.');
  }
}

/**
 * Команда /confirm <booking_id> - подтверждает оплату вручную
 */
export async function handleConfirmCommand(ctx: Context) {
  try {
    const args = ctx.message && 'text' in ctx.message
      ? ctx.message.text.split(' ')
      : [];

    if (args.length < 2) {
      await ctx.reply('Использование: /confirm <booking_id>');
      return;
    }

    const bookingId = args[1];

    // Проверяем, существует ли бронирование
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        payment: true,
        user: true,
        service: true
      }
    });

    if (!booking) {
      await ctx.reply('Бронирование не найдено.');
      return;
    }

    if (booking.status === 'CONFIRMED') {
      await ctx.reply('Бронирование уже подтверждено.');
      return;
    }

    // Подтверждаем бронирование и оплату
    await prisma.$transaction([
      prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: 'CONFIRMED',
          paymentStatus: 'COMPLETED'
        }
      }),
      prisma.payment.update({
        where: { id: booking.payment?.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date()
        }
      })
    ]);

    await ctx.reply(`✅ Бронирование ${bookingId} подтверждено.`);

    // Уведомляем пользователя
    await ctx.telegram.sendMessage(
      Number(booking.user.telegramId),
      `✅ <b>Ваша оплата подтверждена!</b>\n\nБронирование подтверждено. Теперь заполните анкету:`,
      { parse_mode: 'HTML' }
    );

    // Запускаем анкету для пользователя
    // Нужно использовать специальный контекст для пользователя
    // В реальности это лучше сделать через отдельное сообщение
  } catch (error) {
    console.error('Ошибка в handleConfirmCommand:', error);
    await ctx.reply('Произошла ошибка при подтверждении бронирования.');
  }
}

/**
 * Команда /cancel <booking_id> - отменяет бронирование
 */
export async function handleCancelCommand(ctx: Context) {
  try {
    const args = ctx.message && 'text' in ctx.message
      ? ctx.message.text.split(' ')
      : [];

    if (args.length < 2) {
      await ctx.reply('Использование: /cancel <booking_id> [причина]');
      return;
    }

    const bookingId = args[1];
    const reason = args.slice(2).join(' ') || 'Отменено администратором';

    // Проверяем, существует ли бронирование
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: true }
    });

    if (!booking) {
      await ctx.reply('Бронирование не найдено.');
      return;
    }

    // Отменяем бронирование
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: reason
      }
    });

    await ctx.reply(`❌ Бронирование ${bookingId} отменено.`);

    // Уведомляем пользователя
    await ctx.telegram.sendMessage(
      Number(booking.user.telegramId),
      `❌ <b>Ваше бронирование отменено</b>\n\nПричина: ${reason}`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Ошибка в handleCancelCommand:', error);
    await ctx.reply('Произошла ошибка при отмене бронирования.');
  }
}

// ==========================
// УПРАВЛЕНИЕ СЛОТАМИ
// ==========================

/**
 * Парсит дату из строки (ДД.ММ.ГГГГ или ДД.ММ)
 */
function parseDate(dateStr: string): Date | null {
  let date: Date;

  // Формат ДД.ММ.ГГГГ
  if (dateStr.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
    date = parse(dateStr, 'dd.MM.yyyy', new Date());
  }
  // Формат ДД.ММ (используем текущий год)
  else if (dateStr.match(/^\d{2}\.\d{2}$/)) {
    const year = new Date().getFullYear();
    date = parse(`${dateStr}.${year}`, 'dd.MM.yyyy', new Date());
  }
  else {
    return null;
  }

  return isValid(date) ? date : null;
}

/**
 * Парсит время из строки (ЧЧ:ММ)
 */
function parseTime(timeStr: string): { startTime: string; endTime: string } | null {
  if (!timeStr.match(/^\d{2}:\d{2}$/)) {
    return null;
  }

  const [hours, minutes] = timeStr.split(':').map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  // Вычисляем время окончания (+ 1 час)
  const endHours = hours + 1;
  const endTime = `${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

  return { startTime: timeStr, endTime };
}

/**
 * Команда /slot ДД.ММ ЧЧ:ММ - создать свободный слот
 * Пример: /slot 28.11 14:00
 */
export async function handleSlotCommand(ctx: Context) {
  try {
    const args = ctx.message && 'text' in ctx.message
      ? ctx.message.text.split(' ').slice(1)
      : [];

    if (args.length < 2) {
      await ctx.replyWithHTML(
        '<b>📅 Создание слота</b>\n\n' +
        'Использование: <code>/slot ДД.ММ ЧЧ:ММ</code>\n\n' +
        'Примеры:\n' +
        '<code>/slot 28.11 14:00</code> - создать слот на 28 ноября в 14:00\n' +
        '<code>/slot 05.12.2025 10:00</code> - создать слот на 5 декабря 2025'
      );
      return;
    }

    const dateStr = args[0];
    const timeStr = args[1];

    const date = parseDate(dateStr);
    if (!date) {
      await ctx.reply('❌ Неверный формат даты. Используйте ДД.ММ или ДД.ММ.ГГГГ');
      return;
    }

    const time = parseTime(timeStr);
    if (!time) {
      await ctx.reply('❌ Неверный формат времени. Используйте ЧЧ:ММ (например, 14:00)');
      return;
    }

    // Проверяем, что дата не в прошлом
    if (toUTCDate(date) < todayUTC()) {
      await ctx.reply('❌ Нельзя создать слот на прошедшую дату');
      return;
    }

    const slotDate = toUTCDate(date);

    // Проверяем, существует ли уже такой слот
    const existingSlot = await prisma.availableSlot.findUnique({
      where: {
        date_startTime: {
          date: slotDate,
          startTime: time.startTime
        }
      }
    });

    if (existingSlot) {
      await ctx.reply('❌ Слот на это время уже существует');
      return;
    }

    // Создаём слот
    const slot = await prisma.availableSlot.create({
      data: {
        date: slotDate,
        startTime: time.startTime,
        endTime: time.endTime,
        createdBy: BigInt(ctx.from!.id)
      }
    });

    const formattedDate = format(date, 'd MMMM yyyy', { locale: ru });
    await ctx.replyWithHTML(
      `✅ <b>Слот создан</b>\n\n` +
      `📅 Дата: ${formattedDate}\n` +
      `🕐 Время: ${time.startTime} - ${time.endTime}`
    );

  } catch (error) {
    console.error('Ошибка в handleSlotCommand:', error);
    await ctx.reply('Произошла ошибка при создании слота.');
  }
}

/**
 * Команда /slots [дата] - показать доступные слоты
 * Пример: /slots или /slots 28.11
 */
export async function handleSlotsCommand(ctx: Context) {
  try {
    const args = ctx.message && 'text' in ctx.message
      ? ctx.message.text.split(' ').slice(1)
      : [];

    let startDate = todayUTC();
    let endDate = addDays(startDate, 30); // Следующие 30 дней

    // Если указана конкретная дата
    if (args.length > 0) {
      const date = parseDate(args[0]);
      if (date) {
        startDate = toUTCDate(date);
        endDate = addDays(startDate, 1);
      }
    }

    const slots = await prisma.availableSlot.findMany({
      where: {
        date: {
          gte: startDate,
          lt: endDate
        }
      },
      orderBy: [
        { date: 'asc' },
        { startTime: 'asc' }
      ]
    });

    if (slots.length === 0) {
      await ctx.reply('📭 Нет доступных слотов на указанный период');
      return;
    }

    let response = '<b>📅 Доступные слоты</b>\n\n';

    let currentDate = '';
    for (const slot of slots) {
      const slotDate = format(slot.date, 'd MMMM (EEEE)', { locale: ru });

      if (slotDate !== currentDate) {
        currentDate = slotDate;
        response += `\n<b>${slotDate}</b>\n`;
      }

      const status = slot.isBooked ? '🔴 Занят' : '🟢 Свободен';
      response += `  ${slot.startTime} - ${slot.endTime} ${status}\n`;
    }

    await ctx.replyWithHTML(response);

  } catch (error) {
    console.error('Ошибка в handleSlotsCommand:', error);
    await ctx.reply('Произошла ошибка при получении слотов.');
  }
}

/**
 * Команда /delslot ДД.ММ ЧЧ:ММ - удалить слот
 */
export async function handleDelSlotCommand(ctx: Context) {
  try {
    const args = ctx.message && 'text' in ctx.message
      ? ctx.message.text.split(' ').slice(1)
      : [];

    if (args.length < 2) {
      await ctx.replyWithHTML(
        '<b>🗑 Удаление слота</b>\n\n' +
        'Использование: <code>/delslot ДД.ММ ЧЧ:ММ</code>\n\n' +
        'Пример: <code>/delslot 28.11 14:00</code>'
      );
      return;
    }

    const dateStr = args[0];
    const timeStr = args[1];

    const date = parseDate(dateStr);
    if (!date) {
      await ctx.reply('❌ Неверный формат даты');
      return;
    }

    const time = parseTime(timeStr);
    if (!time) {
      await ctx.reply('❌ Неверный формат времени');
      return;
    }

    // Ищем слот
    const slot = await prisma.availableSlot.findUnique({
      where: {
        date_startTime: {
          date: toUTCDate(date),
          startTime: time.startTime
        }
      }
    });

    if (!slot) {
      await ctx.reply('❌ Слот не найден');
      return;
    }

    if (slot.isBooked) {
      await ctx.reply('❌ Нельзя удалить забронированный слот. Сначала отмените бронирование.');
      return;
    }

    // Удаляем слот
    await prisma.availableSlot.delete({
      where: { id: slot.id }
    });

    const formattedDate = format(date, 'd MMMM', { locale: ru });
    await ctx.reply(`✅ Слот ${formattedDate} ${time.startTime} удалён`);

  } catch (error) {
    console.error('Ошибка в handleDelSlotCommand:', error);
    await ctx.reply('Произошла ошибка при удалении слота.');
  }
}

/**
 * Команда /addweek - добавить слоты на неделю (стандартные часы)
 */
export async function handleAddWeekCommand(ctx: Context) {
  try {
    const args = ctx.message && 'text' in ctx.message
      ? ctx.message.text.split(' ').slice(1)
      : [];

    let startDate = todayUTC();

    // Если указана дата начала
    if (args.length > 0) {
      const date = parseDate(args[0]);
      if (date) {
        startDate = toUTCDate(date);
      }
    }

    const { startHour, endHour } = config.booking;
    const slotsCreated: string[] = [];
    const slotsSkipped: string[] = [];

    // Создаём слоты на 7 дней
    for (let day = 0; day < 7; day++) {
      const slotDate = addDays(startDate, day);

      // Создаём слоты с startHour до endHour-1 (так как каждый слот 1 час)
      for (let hour = startHour; hour < endHour; hour++) {
        const startTime = `${hour.toString().padStart(2, '0')}:00`;
        const endTime = `${(hour + 1).toString().padStart(2, '0')}:00`;

        try {
          await prisma.availableSlot.create({
            data: {
              date: slotDate,
              startTime,
              endTime,
              createdBy: BigInt(ctx.from!.id)
            }
          });
          slotsCreated.push(`${format(slotDate, 'dd.MM')} ${startTime}`);
        } catch (e) {
          // Слот уже существует
          slotsSkipped.push(`${format(slotDate, 'dd.MM')} ${startTime}`);
        }
      }
    }

    let response = `<b>📅 Добавление слотов на неделю</b>\n\n`;
    response += `✅ Создано слотов: ${slotsCreated.length}\n`;
    if (slotsSkipped.length > 0) {
      response += `⏭ Пропущено (уже существуют): ${slotsSkipped.length}\n`;
    }
    response += `\n📆 Период: ${format(startDate, 'd MMMM', { locale: ru })} - ${format(addDays(startDate, 6), 'd MMMM', { locale: ru })}`;
    response += `\n🕐 Время: ${startHour}:00 - ${endHour}:00`;

    await ctx.replyWithHTML(response);

  } catch (error) {
    console.error('Ошибка в handleAddWeekCommand:', error);
    await ctx.reply('Произошла ошибка при создании слотов.');
  }
}

/**
 * Команда /genslots - создать слоты до конца текущей недели
 * Создаёт слоты на будние дни (пн-пт) с 12:00 до 16:00
 */
export async function handleGenSlotsCommand(ctx: Context) {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=вс, 1=пн, ..., 6=сб

    // Если сегодня суббота или воскресенье - нет будних дней до конца недели
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      await ctx.reply('📭 Сегодня выходной. Будних дней до конца недели нет.\nСлоты на следующую неделю создадутся автоматически в воскресенье в 19:00.');
      return;
    }

    // Находим сколько дней до воскресенья
    const daysUntilSunday = 7 - dayOfWeek;

    const { startHour, endHour } = config.booking;
    let created = 0;
    let skipped = 0;
    const createdDates: string[] = [];

    // Идём от завтра до субботы (не включая воскресенье)
    for (let i = 1; i < daysUntilSunday; i++) {
      const date = addDays(now, i);
      const dow = date.getDay();

      // Только будние дни (1-5)
      if (dow >= 1 && dow <= 5) {
        const slotDate = toUTCDate(date);
        let dayCreated = 0;

        for (let hour = startHour; hour < endHour; hour++) {
          const startTime = `${hour.toString().padStart(2, '0')}:00`;
          const endTime = `${(hour + 1).toString().padStart(2, '0')}:00`;

          try {
            await prisma.availableSlot.create({
              data: {
                date: slotDate,
                startTime,
                endTime,
                createdBy: BigInt(ctx.from!.id)
              }
            });
            created++;
            dayCreated++;
          } catch (e) {
            // Слот уже существует
            skipped++;
          }
        }

        if (dayCreated > 0) {
          createdDates.push(format(date, 'd MMMM (EEEE)', { locale: ru }));
        }
      }
    }

    let response = `<b>📅 Генерация слотов до конца недели</b>\n\n`;
    response += `✅ Создано слотов: ${created}\n`;
    if (skipped > 0) {
      response += `⏭ Пропущено (уже существуют): ${skipped}\n`;
    }
    response += `\n🕐 Время: ${startHour}:00 - ${endHour}:00\n`;

    if (createdDates.length > 0) {
      response += `\n📆 Дни:\n`;
      for (const d of createdDates) {
        response += `  • ${d}\n`;
      }
    } else if (created === 0 && skipped === 0) {
      response += `\n📭 Нет будних дней до конца недели.`;
    }

    await ctx.replyWithHTML(response);

  } catch (error) {
    console.error('Ошибка в handleGenSlotsCommand:', error);
    await ctx.reply('Произошла ошибка при создании слотов.');
  }
}

/**
 * Команда /pending - показать записи, ожидающие подтверждения оплаты
 */
export async function handlePendingCommand(ctx: Context) {
  try {
    const pendingBookings = await prisma.booking.findMany({
      where: {
        status: 'PENDING'
      },
      include: {
        user: true,
        service: true,
        payment: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (pendingBookings.length === 0) {
      await ctx.reply('✅ Нет записей, ожидающих подтверждения оплаты');
      return;
    }

    let response = `<b>⏳ Записи, ожидающие оплаты (${pendingBookings.length})</b>\n\n`;

    for (const booking of pendingBookings) {
      const dateStr = format(booking.startTime, 'd MMMM HH:mm', { locale: ru });
      const priceUsd = booking.payment ? (booking.payment.amountUsd / 100).toFixed(2) : '?';

      response += `📋 <b>${booking.service.name}</b>\n`;
      response += `👤 ${booking.user.firstName || ''} ${booking.user.lastName || ''} @${booking.user.username || 'нет'}\n`;
      response += `📅 ${dateStr}\n`;
      response += `💰 $${priceUsd}\n`;
      response += `🆔 <code>${booking.id}</code>\n`;
      response += `📌 /confirm ${booking.id}\n\n`;
    }

    await ctx.replyWithHTML(response);

  } catch (error) {
    console.error('Ошибка в handlePendingCommand:', error);
    await ctx.reply('Произошла ошибка при получении записей.');
  }
}

// ==========================
// УПРАВЛЕНИЕ ПРОМОКОДАМИ
// ==========================

/**
 * Парсит дату из строки для промокода (ДД.ММ.ГГГГ)
 */
function parsePromoDate(dateStr: string): Date | null {
  if (!dateStr.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
    return null;
  }

  const date = parse(dateStr, 'dd.MM.yyyy', new Date());
  // Устанавливаем конец дня (23:59:59)
  date.setHours(23, 59, 59, 999);

  return isValid(date) ? date : null;
}

/**
 * Команда /promo - создать промокод
 * Формат: /promo КОД ПРОЦЕНТ ДД.ММ.ГГГГ [услуга]
 * Пример: /promo WELCOME 20 31.12.2025
 * Пример: /promo VIP2025 30 01.06.2025 online
 */
export async function handlePromoCommand(ctx: Context) {
  try {
    const args = ctx.message && 'text' in ctx.message
      ? ctx.message.text.split(' ').slice(1)
      : [];

    if (args.length < 3) {
      await ctx.replyWithHTML(
        '<b>🎁 Создание промокода</b>\n\n' +
        'Использование: <code>/promo КОД ПРОЦЕНТ ДД.ММ.ГГГГ [услуга]</code>\n\n' +
        '<b>Примеры:</b>\n' +
        '<code>/promo WELCOME 20 31.12.2025</code> - 20% на все услуги\n' +
        '<code>/promo VIP2025 30 01.06.2025 online</code> - 30% на онлайн\n' +
        '<code>/promo SPECIAL 15 15.01.2026 written</code> - 15% на письменное\n\n' +
        '<b>Услуги:</b> online, written, conclusion (или пропустить для всех)'
      );
      return;
    }

    const code = args[0].toUpperCase();
    const percentStr = args[1];
    const dateStr = args[2];
    const serviceShortName = args[3] || null;

    // Валидация процента
    const percent = parseInt(percentStr, 10);
    if (isNaN(percent) || percent < 1 || percent > 100) {
      await ctx.reply('❌ Процент скидки должен быть от 1 до 100');
      return;
    }

    // Валидация даты
    const expiresAt = parsePromoDate(dateStr);
    if (!expiresAt) {
      await ctx.reply('❌ Неверный формат даты. Используйте ДД.ММ.ГГГГ (например, 31.12.2025)');
      return;
    }

    if (expiresAt < new Date()) {
      await ctx.reply('❌ Дата истечения должна быть в будущем');
      return;
    }

    // Определяем услугу
    let serviceId: string | null = null;
    if (serviceShortName) {
      serviceId = getServiceIdFromShortName(serviceShortName);
      // Проверяем, что услуга существует, если указана
      if (serviceId) {
        const serviceExists = await prisma.service.findFirst({
          where: { serviceId }
        });
        if (!serviceExists) {
          await ctx.reply(`❌ Услуга "${serviceShortName}" не найдена. Доступны: online, written, conclusion`);
          return;
        }
      }
    }

    // Создаём промокод
    const promoCode = await createPromoCode(
      code,
      percent,
      expiresAt,
      serviceId,
      BigInt(ctx.from!.id)
    );

    const serviceName = getServiceNameById(serviceId);
    const formattedDate = format(expiresAt, 'd MMMM yyyy', { locale: ru });

    await ctx.replyWithHTML(
      `<b>✅ Промокод создан!</b>\n\n` +
      `🎁 <b>Код:</b> <code>${promoCode.code}</code>\n` +
      `💰 <b>Скидка:</b> ${promoCode.discountPercent}%\n` +
      `📅 <b>Действует до:</b> ${formattedDate}\n` +
      `🔧 <b>Услуга:</b> ${serviceName}`
    );

  } catch (error: any) {
    console.error('Ошибка в handlePromoCommand:', error);
    if (error.message?.includes('уже существует')) {
      await ctx.reply(`❌ ${error.message}`);
    } else {
      await ctx.reply('Произошла ошибка при создании промокода.');
    }
  }
}

/**
 * Команда /promos - список всех промокодов
 */
export async function handlePromosCommand(ctx: Context) {
  try {
    const promoCodes = await getActivePromoCodes();

    if (promoCodes.length === 0) {
      await ctx.reply('📭 Нет активных промокодов');
      return;
    }

    let response = `<b>🎁 Активные промокоды (${promoCodes.length})</b>\n\n`;

    for (const promo of promoCodes) {
      const formattedDate = format(promo.expiresAt, 'd.MM.yyyy', { locale: ru });
      const serviceName = getServiceNameById(promo.serviceId);
      const usageCount = promo._count.usages;

      response += `<code>${promo.code}</code> - ${promo.discountPercent}%\n`;
      response += `  📅 До: ${formattedDate}\n`;
      response += `  🔧 ${serviceName}\n`;
      response += `  👥 Использований: ${usageCount}\n\n`;
    }

    response += `\n<i>Для деактивации: /promodel КОД</i>`;

    await ctx.replyWithHTML(response);

  } catch (error) {
    console.error('Ошибка в handlePromosCommand:', error);
    await ctx.reply('Произошла ошибка при получении списка промокодов.');
  }
}

/**
 * Команда /promodel - деактивировать промокод
 * Формат: /promodel КОД
 */
export async function handlePromoDelCommand(ctx: Context) {
  try {
    const args = ctx.message && 'text' in ctx.message
      ? ctx.message.text.split(' ').slice(1)
      : [];

    if (args.length < 1) {
      await ctx.replyWithHTML(
        '<b>🗑 Деактивация промокода</b>\n\n' +
        'Использование: <code>/promodel КОД</code>\n\n' +
        'Пример: <code>/promodel WELCOME</code>'
      );
      return;
    }

    const code = args[0].toUpperCase();

    await deactivatePromoCode(code);

    await ctx.reply(`✅ Промокод ${code} деактивирован`);

  } catch (error: any) {
    console.error('Ошибка в handlePromoDelCommand:', error);
    if (error.message?.includes('не найден')) {
      await ctx.reply(`❌ ${error.message}`);
    } else {
      await ctx.reply('Произошла ошибка при деактивации промокода.');
    }
  }
}

/**
 * Команда /pending_memo - показывает платежи требующие ручной проверки
 * (без MEMO или с недостаточной суммой)
 */
export async function handlePendingMemoCommand(ctx: Context) {
  try {
    const pendingPayments = await prisma.payment.findMany({
      where: {
        OR: [
          { memoMatchStatus: 'MANUAL_REVIEW' },
          { memoMatchStatus: 'INSUFFICIENT' }
        ]
      },
      include: {
        booking: {
          include: {
            service: true,
            user: true
          }
        }
      },
      orderBy: { initiatedAt: 'desc' },
      take: 20
    });

    if (pendingPayments.length === 0) {
      await ctx.reply('✅ Нет платежей, требующих ручной проверки.');
      return;
    }

    let response = `<b>⚠️ Платежи на ручной проверке (${pendingPayments.length})</b>\n\n`;

    for (const payment of pendingPayments) {
      const user = payment.booking.user;
      const requiredAmount = (payment.amountUsd / 100).toFixed(2);
      const receivedAmount = payment.receivedAmountUsd
        ? (payment.receivedAmountUsd / 100).toFixed(2)
        : '?';

      const statusText = payment.memoMatchStatus === 'INSUFFICIENT'
        ? '💰 Недостаточная сумма'
        : '📝 Отсутствует/неверный MEMO';

      response += `<b>${statusText}</b>\n` +
        `🆔 ID: <code>${payment.id}</code>\n` +
        `📝 MEMO: <code>${payment.paymentMemo || 'не задан'}</code>\n` +
        `💳 Требуется: ${requiredAmount} USDT\n` +
        `💰 Получено: ${receivedAmount} USDT\n` +
        `👤 ${user.firstName || 'Не указано'} (@${user.username || 'нет'})\n` +
        `🔗 Hash: <code>${payment.tonTransactionHash || 'нет'}</code>\n\n` +
        `---\n\n`;
    }

    // Разбиваем на части, если слишком длинное
    const maxLength = 4000;
    if (response.length > maxLength) {
      const chunks = response.match(/.{1,4000}/gs) || [];
      for (const chunk of chunks) {
        await ctx.replyWithHTML(chunk);
      }
    } else {
      await ctx.replyWithHTML(response);
    }
  } catch (error) {
    console.error('Ошибка в handlePendingMemoCommand:', error);
    await ctx.reply('Произошла ошибка при получении платежей.');
  }
}

// ==========================
// ИГНОРИРОВАНИЕ ТРАНЗАКЦИЙ
// ==========================

/**
 * Команда /ignore_tx HASH - добавить транзакцию в список игнорируемых
 * Транзакции из этого списка не будут показываться как неопознанные
 */
export async function handleIgnoreTxCommand(ctx: Context) {
  try {
    const args = ctx.message && 'text' in ctx.message
      ? ctx.message.text.split(' ').slice(1)
      : [];

    if (args.length < 1) {
      await ctx.replyWithHTML(
        '<b>🔇 Игнорирование транзакции</b>\n\n' +
        'Использование: <code>/ignore_tx HASH</code>\n\n' +
        'Пример:\n<code>/ignore_tx abc123def456...</code>\n\n' +
        'После добавления транзакция не будет показываться в уведомлениях о неопознанных платежах.'
      );
      return;
    }

    const txHash = args[0];

    // Проверяем, не добавлен ли уже
    if (ignoredTransactions.has(txHash)) {
      await ctx.reply('ℹ️ Эта транзакция уже в списке игнорируемых.');
      return;
    }

    // Добавляем в список игнорируемых
    ignoredTransactions.add(txHash);

    await ctx.replyWithHTML(
      `✅ <b>Транзакция добавлена в список игнорируемых</b>\n\n` +
      `🔗 Hash:\n<code>${txHash}</code>\n\n` +
      `<i>Всего игнорируемых: ${ignoredTransactions.size}</i>`
    );

  } catch (error) {
    console.error('Ошибка в handleIgnoreTxCommand:', error);
    await ctx.reply('Произошла ошибка при добавлении транзакции в игнор.');
  }
}

/**
 * Команда /ignored_txs - показать список игнорируемых транзакций
 */
export async function handleIgnoredTxsCommand(ctx: Context) {
  try {
    if (ignoredTransactions.size === 0) {
      await ctx.reply('📭 Список игнорируемых транзакций пуст.');
      return;
    }

    let response = `<b>🔇 Игнорируемые транзакции (${ignoredTransactions.size})</b>\n\n`;

    let index = 1;
    for (const txHash of ignoredTransactions) {
      // Показываем сокращённый хэш для удобства
      const shortHash = txHash.length > 20
        ? `${txHash.slice(0, 10)}...${txHash.slice(-10)}`
        : txHash;
      response += `${index}. <code>${shortHash}</code>\n`;
      index++;

      // Ограничиваем вывод для длинных списков
      if (index > 50) {
        response += `\n... и ещё ${ignoredTransactions.size - 50} транзакций`;
        break;
      }
    }

    response += `\n\n<i>Для очистки списка: /clear_ignored</i>`;

    await ctx.replyWithHTML(response);

  } catch (error) {
    console.error('Ошибка в handleIgnoredTxsCommand:', error);
    await ctx.reply('Произошла ошибка при получении списка.');
  }
}

/**
 * Команда /clear_ignored - очистить список игнорируемых транзакций
 */
export async function handleClearIgnoredCommand(ctx: Context) {
  try {
    const count = ignoredTransactions.size;

    if (count === 0) {
      await ctx.reply('📭 Список игнорируемых транзакций уже пуст.');
      return;
    }

    ignoredTransactions.clear();

    await ctx.reply(`✅ Список игнорируемых транзакций очищен (удалено: ${count}).`);

  } catch (error) {
    console.error('Ошибка в handleClearIgnoredCommand:', error);
    await ctx.reply('Произошла ошибка при очистке списка.');
  }
}
