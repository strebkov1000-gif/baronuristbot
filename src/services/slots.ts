import { addDays, startOfDay, setHours, setMinutes, format, addMinutes, nextMonday } from 'date-fns';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import { ru } from 'date-fns/locale';
import { Telegraf, Context } from 'telegraf';
import { config } from '../config';
import { prisma } from './database';

export interface TimeSlot {
  startTime: Date;
  endTime: Date;
  available: boolean;
  formatted: string; // "12:00-13:00"
}

/**
 * Проверяет, является ли день доступным для бронирования
 */
export function isAvailableDay(date: Date): boolean {
  const dayOfWeek = date.getDay();
  return config.booking.availableDays.includes(dayOfWeek);
}

/**
 * Генерирует список доступных слотов для заданной даты
 */
export function generateTimeSlots(date: Date): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const timezone = config.booking.timezone;

  // Конвертируем дату в московское время
  const moscowDate = utcToZonedTime(date, timezone);
  const startOfDayMoscow = startOfDay(moscowDate);

  // Генерируем слоты с startHour до endHour
  for (let hour = config.booking.startHour; hour < config.booking.endHour; hour++) {
    const slotStart = setMinutes(setHours(startOfDayMoscow, hour), 0);
    const slotEnd = addMinutes(slotStart, config.booking.slotDuration);

    slots.push({
      startTime: zonedTimeToUtc(slotStart, timezone),
      endTime: zonedTimeToUtc(slotEnd, timezone),
      available: true,
      formatted: `${format(slotStart, 'HH:mm')}-${format(slotEnd, 'HH:mm')}`
    });
  }

  return slots;
}

/**
 * Проверяет доступность конкретного слота
 */
export async function isSlotAvailable(
  serviceId: string,
  startTime: Date,
  endTime: Date,
  excludeUserId?: string
): Promise<boolean> {
  const now = new Date();

  // 1. Проверяем, не в прошлом ли слот
  if (startTime < now) {
    return false;
  }

  // 2. Проверяем существующие подтверждённые бронирования
  const existingBooking = await prisma.booking.findFirst({
    where: {
      serviceId,
      startTime: { lte: endTime },
      endTime: { gt: startTime },
      status: { in: ['PENDING', 'CONFIRMED'] },
      paymentStatus: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] },
      ...(excludeUserId && { userId: { not: excludeUserId } })
    }
  });

  if (existingBooking) {
    return false;
  }

  // 3. Проверяем активные резервирования (не истекшие)
  const activeReservation = await prisma.reservation.findFirst({
    where: {
      serviceId,
      startTime: { lte: endTime },
      endTime: { gt: startTime },
      status: 'ACTIVE',
      expiresAt: { gt: now },
      ...(excludeUserId && { userId: { not: excludeUserId } })
    }
  });

  if (activeReservation) {
    return false;
  }

  return true;
}

/**
 * Получает доступные слоты для услуги на указанную дату
 */
export async function getAvailableSlots(
  serviceId: string,
  date: Date,
  excludeUserId?: string
): Promise<TimeSlot[]> {
  // Проверяем, является ли день доступным
  if (!isAvailableDay(date)) {
    return [];
  }

  // Генерируем все возможные слоты
  const allSlots = generateTimeSlots(date);

  // Проверяем доступность каждого слота
  const slotsWithAvailability = await Promise.all(
    allSlots.map(async (slot) => {
      const available = await isSlotAvailable(
        serviceId,
        slot.startTime,
        slot.endTime,
        excludeUserId
      );

      return {
        ...slot,
        available
      };
    })
  );

  return slotsWithAvailability;
}

/**
 * Создаёт временное резервирование слота (на 30 минут)
 */
export async function createReservation(
  userId: string,
  serviceId: string,
  startTime: Date,
  endTime: Date
): Promise<string> {
  // Удаляем старые резервирования этого пользователя для этой услуги
  await prisma.reservation.updateMany({
    where: {
      userId,
      serviceId,
      status: 'ACTIVE'
    },
    data: {
      status: 'CANCELLED'
    }
  });

  // Создаём новое резервирование
  const expiresAt = addMinutes(new Date(), config.booking.reservationDuration);

  const reservation = await prisma.reservation.create({
    data: {
      userId,
      serviceId,
      startTime,
      endTime,
      expiresAt,
      status: 'ACTIVE'
    }
  });

  return reservation.id;
}

/**
 * Отменяет резервирование
 */
export async function cancelReservation(reservationId: string): Promise<void> {
  await prisma.reservation.update({
    where: { id: reservationId },
    data: { status: 'CANCELLED' }
  });
}

/**
 * Помечает резервирование как использованное
 */
export async function markReservationAsUsed(reservationId: string): Promise<void> {
  await prisma.reservation.update({
    where: { id: reservationId },
    data: { status: 'USED' }
  });
}

/**
 * Очистка истекших резервирований (запускается периодически)
 */
export async function cleanupExpiredReservations(): Promise<number> {
  const result = await prisma.reservation.updateMany({
    where: {
      status: 'ACTIVE',
      expiresAt: { lt: new Date() }
    },
    data: {
      status: 'EXPIRED'
    }
  });

  return result.count;
}

/**
 * Генерирует даты на ближайшие N недель с учётом доступных дней
 */
export function generateAvailableDates(weeksAhead: number = 3): Date[] {
  const dates: Date[] = [];
  const today = startOfDay(new Date());

  for (let i = 0; i < weeksAhead * 7; i++) {
    const date = addDays(today, i);
    if (isAvailableDay(date)) {
      dates.push(date);
    }
  }

  return dates;
}

// ========================================
// АВТОМАТИЧЕСКОЕ СОЗДАНИЕ СЛОТОВ
// ========================================

/**
 * Создаёт дату в UTC без времени (только дата)
 */
function toUTCDate(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/**
 * Генерирует слоты на следующую неделю (пн-пт)
 * Вызывается автоматически каждое воскресенье в 19:00
 */
async function generateSlotsForNextWeek<T extends Context>(bot: Telegraf<T>): Promise<void> {
  try {
    // Находим следующий понедельник
    const now = new Date();
    const nextMon = nextMonday(now);

    const { startHour, endHour } = config.booking;
    let created = 0;
    let skipped = 0;
    const createdDates: string[] = [];

    // Создаём слоты на пн-пт (5 дней)
    for (let i = 0; i < 5; i++) {
      const date = addDays(nextMon, i);
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
              createdBy: BigInt(0) // Автоматически создано системой
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

    // Уведомляем админа
    const endDate = addDays(nextMon, 4);
    let message = `📅 <b>Автоматическое создание слотов</b>\n\n`;
    message += `✅ Создано: ${created}\n`;
    if (skipped > 0) {
      message += `⏭ Пропущено (уже существуют): ${skipped}\n`;
    }
    message += `\n📆 Неделя: ${format(nextMon, 'd MMMM', { locale: ru })} - ${format(endDate, 'd MMMM', { locale: ru })}\n`;
    message += `🕐 Время: ${startHour}:00 - ${endHour}:00`;

    if (createdDates.length > 0) {
      message += `\n\n📋 Дни:\n`;
      for (const d of createdDates) {
        message += `  • ${d}\n`;
      }
    }

    await bot.telegram.sendMessage(
      config.telegram.adminChatId,
      message,
      { parse_mode: 'HTML' }
    );

    console.log(`📅 Автоматически создано ${created} слотов на неделю ${format(nextMon, 'dd.MM')} - ${format(endDate, 'dd.MM')}`);

  } catch (error) {
    console.error('Ошибка при автоматическом создании слотов:', error);

    // Уведомляем админа об ошибке
    try {
      await bot.telegram.sendMessage(
        config.telegram.adminChatId,
        `❌ <b>Ошибка автоматического создания слотов</b>\n\nПроверьте логи сервера.`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      console.error('Не удалось отправить уведомление админу:', e);
    }
  }
}

/**
 * Запускает планировщик автоматического создания слотов
 * Срабатывает каждое воскресенье в 19:00 по Москве
 */
export function startWeeklySlotScheduler<T extends Context>(bot: Telegraf<T>): void {
  console.log('📅 Запущен планировщик автоматического создания слотов (воскресенье 19:00 МСК)');

  // Проверяем каждый час
  setInterval(async () => {
    const now = new Date();
    const moscowNow = utcToZonedTime(now, config.booking.timezone);

    // Воскресенье (0) в 19:00
    if (moscowNow.getDay() === 0 && moscowNow.getHours() === 19) {
      console.log('🔄 Запуск автоматического создания слотов...');
      await generateSlotsForNextWeek(bot);
    }
  }, 60 * 60 * 1000); // Проверяем каждый час
}
