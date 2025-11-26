import { Booking, Payment, Service, User } from '@prisma/client';
import { addMinutes } from 'date-fns';
// @ts-ignore
import { config } from '../config';
import { prisma } from './database';
import { markReservationAsUsed } from './slots';

export interface CreateBookingParams {
  userId: string;
  serviceId: string;
  startTime: Date;
  endTime: Date;
  reservationId?: string;
}

export interface BookingWithDetails extends Booking {
  service: Service;
  user: User;
  payment: Payment | null;
}

/**
 * Создаёт бронирование с платежом
 */
export async function createBooking(
  params: CreateBookingParams
): Promise<{ booking: Booking; payment: Payment }> {
  const { userId, serviceId, startTime, endTime, reservationId } = params;

  // Получаем информацию об услуге
  const service = await prisma.service.findUnique({
    where: { id: serviceId }
  });

  if (!service) {
    throw new Error('Услуга не найдена');
  }

  // Рассчитываем сумму предоплаты (25%)
  const prepaymentAmount = Math.floor(service.priceUsd * 0.25);

  // Создаём бронирование и платёж в транзакции
  const result = await prisma.$transaction(async (tx) => {
    // Создаём бронирование
    const booking = await tx.booking.create({
      data: {
        userId,
        serviceId,
        startTime,
        endTime,
        status: 'PENDING',
        paymentStatus: 'PENDING'
      }
    });

    // Создаём платёж
    const payment = await tx.payment.create({
      data: {
        bookingId: booking.id,
        userId,
        amountUsd: prepaymentAmount,
        recipientAddress: config.ton.walletAddress,
        status: 'PENDING',
        expiresAt: addMinutes(new Date(), config.booking.paymentExpiration)
      }
    });

    // Если было резервирование, помечаем его как использованное
    if (reservationId) {
      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'USED' }
      });
    }

    return { booking, payment };
  });

  return result;
}

/**
 * Получает бронирование по ID с полной информацией
 */
export async function getBookingById(bookingId: string): Promise<BookingWithDetails | null> {
  return await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      service: true,
      user: true,
      payment: true
    }
  });
}

/**
 * Получает бронирования пользователя
 */
export async function getUserBookings(userId: string): Promise<BookingWithDetails[]> {
  return await prisma.booking.findMany({
    where: { userId },
    include: {
      service: true,
      user: true,
      payment: true
    },
    orderBy: { startTime: 'desc' }
  });
}

/**
 * Подтверждает бронирование после оплаты
 */
export async function confirmBooking(bookingId: string): Promise<void> {
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: 'CONFIRMED',
      paymentStatus: 'COMPLETED'
    }
  });
}

/**
 * Отменяет бронирование
 */
export async function cancelBooking(
  bookingId: string,
  reason?: string
): Promise<void> {
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancellationReason: reason
    }
  });
}

/**
 * Помечает бронирование как завершённое
 */
export async function completeBooking(bookingId: string): Promise<void> {
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: 'COMPLETED'
    }
  });
}

/**
 * Истекает неоплаченные бронирования
 */
export async function expireUnpaidBookings(): Promise<number> {
  // Находим истекшие платежи
  const expiredPayments = await prisma.payment.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { lt: new Date() }
    },
    include: {
      booking: true
    }
  });

  // Обновляем их статус
  for (const payment of expiredPayments) {
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'EXPIRED' }
      }),
      prisma.booking.update({
        where: { id: payment.bookingId },
        data: {
          status: 'EXPIRED',
          paymentStatus: 'EXPIRED'
        }
      })
    ]);
  }

  return expiredPayments.length;
}

/**
 * Получает все бронирования на сегодня
 */
export async function getTodayBookings(): Promise<BookingWithDetails[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return await prisma.booking.findMany({
    where: {
      startTime: {
        gte: today,
        lt: tomorrow
      },
      status: { in: ['CONFIRMED', 'PENDING'] }
    },
    include: {
      service: true,
      user: true,
      payment: true
    },
    orderBy: { startTime: 'asc' }
  });
}

/**
 * Получает бронирования на неделю
 */
export async function getWeekBookings(): Promise<BookingWithDetails[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  return await prisma.booking.findMany({
    where: {
      startTime: {
        gte: today,
        lt: nextWeek
      },
      status: { in: ['CONFIRMED', 'PENDING'] }
    },
    include: {
      service: true,
      user: true,
      payment: true
    },
    orderBy: { startTime: 'asc' }
  });
}

/**
 * Форматирует информацию о бронировании для отправки
 */
export function formatBookingInfo(booking: BookingWithDetails): string {
  const startTimeFormatted = booking.startTime.toLocaleString('ru-RU', {
    timeZone: config.booking.timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const priceUsd = (booking.service.priceUsd / 100).toFixed(2);
  const prepaymentUsd = booking.payment
    ? (booking.payment.amountUsd / 100).toFixed(2)
    : '0.00';

  return `📋 <b>Бронирование #${booking.id.substring(0, 8)}</b>\n\n` +
    `👤 Пользователь: ${booking.user.firstName || 'Не указано'} (@${booking.user.username || 'нет'})\n` +
    `📞 Telegram ID: <code>${booking.user.telegramId}</code>\n\n` +
    `🔧 Услуга: ${booking.service.name}\n` +
    `💵 Стоимость: $${priceUsd}\n` +
    `💳 Предоплата: $${prepaymentUsd}\n\n` +
    `📅 Дата и время: ${startTimeFormatted} (МСК)\n` +
    `⏱ Длительность: ${booking.service.durationMinutes} мин\n\n` +
    `📊 Статус: ${getStatusEmoji(booking.status)} ${booking.status}\n` +
    `💰 Оплата: ${getPaymentStatusEmoji(booking.paymentStatus)} ${booking.paymentStatus}`;
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'PENDING': return '⏳';
    case 'CONFIRMED': return '✅';
    case 'COMPLETED': return '✔️';
    case 'CANCELLED': return '❌';
    case 'EXPIRED': return '⏰';
    default: return '❓';
  }
}

function getPaymentStatusEmoji(status: string): string {
  switch (status) {
    case 'PENDING': return '⏳';
    case 'PROCESSING': return '🔄';
    case 'COMPLETED': return '✅';
    case 'FAILED': return '❌';
    case 'EXPIRED': return '⏰';
    default: return '❓';
  }
}
