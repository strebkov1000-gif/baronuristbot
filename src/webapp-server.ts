import express, { Request, Response } from 'express';
import path from 'path';
import { config } from './config';
import { prisma } from './services/database';
import { addDays, format } from 'date-fns';
import { validatePromoCode } from './services/promo';
import { generatePaymentMemo } from './services/memo-generator';

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

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../webapp')));

// ===================
// API ROUTES
// ===================

/**
 * GET /api/services
 * Получает список всех услуг
 */
app.get('/api/services', async (req: Request, res: Response) => {
  try {
    // Сортируем от дешёвых к дорогим
    const services = await prisma.service.findMany({
      orderBy: { priceUsd: 'asc' }
    });

    res.json(services);
  } catch (error) {
    console.error('Error in GET /api/services:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/services/:id
 * Получает информацию об услуге по serviceId
 */
app.get('/api/services/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Ищем по serviceId или id
    const service = await prisma.service.findFirst({
      where: {
        OR: [
          { serviceId: id },
          { id: id }
        ]
      }
    });

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json(service);
  } catch (error) {
    console.error('Error in GET /api/services/:id:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/available-dates
 * Получает все даты, на которые есть доступные (не забронированные) слоты
 */
app.get('/api/available-dates', async (req: Request, res: Response) => {
  try {
    const today = todayUTC();
    const endDate = addDays(today, 90); // Следующие 90 дней

    // Получаем все свободные слоты
    const slots = await prisma.availableSlot.findMany({
      where: {
        date: {
          gte: today,
          lte: endDate
        },
        isBooked: false
      },
      select: {
        date: true
      },
      distinct: ['date'],
      orderBy: {
        date: 'asc'
      }
    });

    // Форматируем даты в ISO формат
    const dates = slots.map(slot => format(slot.date, 'yyyy-MM-dd'));

    res.json({ dates });
  } catch (error) {
    console.error('Error in GET /api/available-dates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/slots
 * Получает слоты на указанную дату
 * Query params: date (YYYY-MM-DD)
 */
app.get('/api/slots', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        error: 'Missing required parameter: date'
      });
    }

    // Парсим дату
    const selectedDate = new Date(date as string);
    if (isNaN(selectedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    const dateStart = toUTCDate(selectedDate);

    // Получаем слоты на эту дату из БД
    const slots = await prisma.availableSlot.findMany({
      where: {
        date: dateStart
      },
      orderBy: {
        startTime: 'asc'
      }
    });

    // Форматируем ответ
    const formattedSlots = slots.map(slot => ({
      id: slot.id,
      date: format(slot.date, 'yyyy-MM-dd'),
      startTime: slot.startTime,
      endTime: slot.endTime,
      isBooked: slot.isBooked
    }));

    res.json(formattedSlots);
  } catch (error) {
    console.error('Error in GET /api/slots:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/user/:telegramId
 * Получает данные пользователя по Telegram ID
 */
app.get('/api/user/:telegramId', async (req: Request, res: Response) => {
  try {
    const telegramId = BigInt(req.params.telegramId);

    const user = await prisma.user.findUnique({
      where: { telegramId },
      include: {
        referrals: {
          select: {
            id: true,
            firstName: true,
            username: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      telegramId: user.telegramId.toString(),
      username: user.username,
      firstName: user.firstName,
      referralCode: user.referralCode,
      referralBonus: user.referralBonus,
      totalReferrals: user.referrals.length,
      referrals: user.referrals.map(r => ({
        firstName: r.firstName,
        username: r.username,
        createdAt: r.createdAt
      }))
    });
  } catch (error) {
    console.error('Error in GET /api/user/:telegramId:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/bookings/:telegramId
 * Получает бронирования пользователя по Telegram ID
 */
app.get('/api/bookings/:telegramId', async (req: Request, res: Response) => {
  try {
    const telegramId = BigInt(req.params.telegramId);

    const user = await prisma.user.findUnique({
      where: { telegramId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const bookings = await prisma.booking.findMany({
      where: {
        userId: user.id,
        status: { in: ['CONFIRMED', 'PENDING'] }
      },
      include: {
        service: true,
        payment: true
      },
      orderBy: { startTime: 'asc' }
    });

    const formattedBookings = bookings.map(booking => ({
      id: booking.id,
      serviceName: booking.service.name,
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      priceUsd: booking.service.priceUsd,
      prepaymentUsd: booking.payment?.amountUsd || 0,
      // Информация о частичной оплате
      paymentType: (booking as any).paymentType || 'PREPAYMENT',
      totalPriceUsd: (booking as any).totalPriceUsd || booking.service.priceUsd,
      prepaidAmountUsd: (booking as any).prepaidAmountUsd || 0,
      remainingAmountUsd: (booking as any).remainingAmountUsd || 0,
      paymentMemo: booking.payment?.paymentMemo || null,
      remainingPaymentMemo: (booking as any).remainingPaymentMemo || null
    }));

    res.json(formattedBookings);
  } catch (error) {
    console.error('Error in GET /api/bookings/:telegramId:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/booking/:id
 * Получает детали одного бронирования с платёжной информацией
 */
app.get('/api/booking/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        service: true,
        payment: true
      }
    });

    if (!booking) {
      return res.status(404).json({ error: 'Бронирование не найдено' });
    }

    res.json({
      id: booking.id,
      serviceName: booking.service.name,
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      priceUsd: (booking.service.priceUsd / 100).toFixed(0),
      prepaymentUsd: booking.payment ? (booking.payment.amountUsd / 100).toFixed(2) : '0',
      paymentMemo: booking.payment?.paymentMemo || '',
      paymentExpires: booking.payment?.expiresAt?.toISOString() || null,
      promoInfo: booking.payment?.promoInfo || ''
    });
  } catch (error) {
    console.error('Error in GET /api/booking/:id:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/booking/:id/status
 * Проверяет статус оплаты бронирования (для polling)
 */
app.get('/api/booking/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        service: true,
        payment: true
      }
    });

    if (!booking) {
      return res.status(404).json({ error: 'Бронирование не найдено' });
    }

    // Форматируем дату и время
    const startTime = booking.startTime;
    const dateStr = startTime.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: config.booking.timezone
    });
    const timeStr = startTime.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: config.booking.timezone
    });

    res.json({
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      serviceName: booking.service.name,
      date: dateStr,
      time: timeStr,
      paidAmount: booking.payment?.receivedAmountUsd
        ? (booking.payment.receivedAmountUsd / 100).toFixed(0)
        : (booking.payment?.amountUsd ? (booking.payment.amountUsd / 100).toFixed(0) : '0'),
      remainingAmount: (booking as any).remainingAmountUsd
        ? ((booking as any).remainingAmountUsd / 100).toFixed(0)
        : '0'
    });
  } catch (error) {
    console.error('Error in GET /api/booking/:id/status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/booking/apply-promo
 * Применяет промокод к существующему бронированию
 */
app.post('/api/booking/apply-promo', async (req: Request, res: Response) => {
  try {
    const { bookingId, promoCode, telegramId } = req.body;

    if (!bookingId || !promoCode || !telegramId) {
      return res.status(400).json({ success: false, error: 'Отсутствуют обязательные параметры' });
    }

    // Находим пользователя
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    // Находим бронирование с платежом и услугой
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        payment: true,
        service: true
      }
    });

    if (!booking) {
      return res.status(404).json({ success: false, error: 'Бронирование не найдено' });
    }

    if (booking.userId !== user.id) {
      return res.status(403).json({ success: false, error: 'Нет доступа к этому бронированию' });
    }

    if (!booking.payment) {
      return res.status(400).json({ success: false, error: 'Платёж не найден' });
    }

    if (booking.payment.promoInfo) {
      return res.status(400).json({ success: false, error: 'Промокод уже применён' });
    }

    // Валидируем промокод
    const promoResult = await validatePromoCode(promoCode, user.id, booking.service.serviceId);

    if (!promoResult.valid || !promoResult.promoCode) {
      return res.json({ success: false, error: promoResult.error || 'Недействительный промокод' });
    }

    const promo = promoResult.promoCode;

    // Рассчитываем новую сумму
    const currentAmount = booking.payment.amountUsd;
    const discountAmount = Math.floor(currentAmount * promo.discountPercent / 100);
    const newAmount = currentAmount - discountAmount;

    // Обновляем платёж
    await prisma.payment.update({
      where: { id: booking.payment.id },
      data: {
        amountUsd: newAmount,
        amountTon: (newAmount / 100).toFixed(2),
        promoInfo: `Промокод: ${promo.code} (-${promo.discountPercent}%)`
      }
    });

    // Записываем использование промокода
    await prisma.promoCodeUsage.create({
      data: {
        promoCodeId: promo.id,
        userId: user.id,
        bookingId: booking.id,
        discountAmount: discountAmount
      }
    });

    console.log(`✅ Промокод ${promo.code} применён к бронированию ${bookingId}. Скидка: ${discountAmount} центов`);

    res.json({
      success: true,
      discountPercent: promo.discountPercent,
      discountAmount: (discountAmount / 100).toFixed(2),
      newAmount: (newAmount / 100).toFixed(2)
    });

  } catch (error) {
    console.error('Error in POST /api/booking/apply-promo:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/promo/validate
 * Валидация промокода
 */
app.post('/api/promo/validate', async (req: Request, res: Response) => {
  try {
    const { code, serviceId, telegramId } = req.body;

    if (!code || !serviceId || !telegramId) {
      return res.status(400).json({
        valid: false,
        error: 'Отсутствуют обязательные параметры'
      });
    }

    // Находим пользователя по telegramId
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) }
    });

    if (!user) {
      return res.status(404).json({
        valid: false,
        error: 'Пользователь не найден'
      });
    }

    // Валидируем промокод
    const result = await validatePromoCode(code, user.id, serviceId);

    res.json(result);
  } catch (error) {
    console.error('Error in POST /api/promo/validate:', error);
    res.status(500).json({
      valid: false,
      error: 'Ошибка сервера'
    });
  }
});

/**
 * GET /api/generate-memo
 * Генерирует уникальный MEMO для платежа
 */
app.get('/api/generate-memo', async (req: Request, res: Response) => {
  try {
    const memo = await generatePaymentMemo();
    res.json({ memo });
  } catch (error) {
    console.error('Error in GET /api/generate-memo:', error);
    res.status(500).json({ error: 'Failed to generate memo' });
  }
});

/**
 * POST /api/booking
 * Создаёт бронирование напрямую из WebApp
 */
app.post('/api/booking', async (req: Request, res: Response) => {
  try {
    const {
      telegramId,
      serviceId,
      slotId,
      date,
      startTime,
      endTime,
      promoCode,
      promoCodeId,
      discountPercent,
      paymentType,     // 'FULL' или 'PREPAYMENT'
      totalPrice,      // Полная стоимость в центах
      paymentAmount,   // Сумма к оплате в центах (уже с учётом скидки)
      paymentMemo: clientMemo  // MEMO который уже показан пользователю на экране подтверждения
    } = req.body;

    console.log('📱 [API] Создание бронирования:', { telegramId, serviceId, slotId, date, startTime, paymentType });

    if (!telegramId || !serviceId || !date || !startTime || !endTime) {
      return res.status(400).json({ error: 'Отсутствуют обязательные поля' });
    }

    // Находим пользователя
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) }
    });

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Находим услугу
    const service = await prisma.service.findFirst({
      where: {
        OR: [
          { serviceId: serviceId },
          { id: serviceId }
        ]
      }
    });

    if (!service) {
      return res.status(404).json({ error: 'Услуга не найдена' });
    }

    // Парсим дату и время
    const [year, month, day] = date.split('-').map(Number);
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    const bookingStartTime = new Date(Date.UTC(year, month - 1, day, startHour - 3, startMin)); // UTC (MSK = UTC+3)
    const bookingEndTime = new Date(Date.UTC(year, month - 1, day, endHour - 3, endMin));

    // Определяем тип оплаты и суммы
    const isFullPayment = paymentType === 'FULL';
    const originalPriceUsd = service.priceUsd; // Оригинальная цена услуги

    // Применяем скидку к полной стоимости если есть промокод
    let discountedTotalPrice = originalPriceUsd;
    if (promoCode && discountPercent) {
      discountedTotalPrice = Math.ceil(originalPriceUsd * (100 - discountPercent) / 100);
    }

    // Сумма к текущей оплате
    let currentPaymentAmount = paymentAmount;
    if (!currentPaymentAmount) {
      if (isFullPayment) {
        currentPaymentAmount = discountedTotalPrice;
      } else {
        // 25% предоплата от цены со скидкой
        currentPaymentAmount = Math.ceil(discountedTotalPrice * 0.25);
      }
    }

    // Рассчитываем остаток к оплате (от цены со скидкой минус текущий платёж)
    const remainingAmount = isFullPayment ? 0 : (discountedTotalPrice - currentPaymentAmount);

    // Используем MEMO от клиента (уже показан пользователю) или генерируем новый
    const paymentMemo = clientMemo || await generatePaymentMemo();
    console.log('📱 [API] MEMO для платежа:', paymentMemo, clientMemo ? '(от клиента)' : '(новый)');

    // Создаём бронирование и платёж в транзакции
    const result = await prisma.$transaction(async (tx) => {
      // Создаём бронирование
      const booking = await tx.booking.create({
        data: {
          userId: user.id,
          serviceId: service.id,
          startTime: bookingStartTime,
          endTime: bookingEndTime,
          status: 'PENDING',
          paymentStatus: 'PENDING',
          paymentType: isFullPayment ? 'FULL' : 'PREPAYMENT',
          totalPriceUsd: discountedTotalPrice,
          prepaidAmountUsd: 0,
          remainingAmountUsd: isFullPayment ? 0 : remainingAmount
        } as any
      });

      // Создаём платёж
      const payment = await tx.payment.create({
        data: {
          bookingId: booking.id,
          userId: user.id,
          amountUsd: currentPaymentAmount,
          amountTon: (currentPaymentAmount / 100).toFixed(2),
          recipientAddress: config.ton.walletAddress,
          status: 'PENDING',
          paymentMemo: paymentMemo,
          promoInfo: promoCode ? `Промокод: ${promoCode} (-${discountPercent}%)` : null,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 часа
        }
      });

      // Помечаем слот как занятый
      if (slotId) {
        await tx.availableSlot.update({
          where: { id: slotId },
          data: {
            isBooked: true,
            bookingId: booking.id
          }
        });
      }

      // Записываем использование промокода
      if (promoCodeId) {
        // Скидка рассчитывается от оригинальной цены
        const discountAmount = originalPriceUsd - discountedTotalPrice;
        await tx.promoCodeUsage.create({
          data: {
            promoCodeId: promoCodeId,
            userId: user.id,
            bookingId: booking.id,
            discountAmount: discountAmount
          }
        });
      }

      return { booking, payment };
    });

    // Форматируем дату для ответа
    const dateFormatted = `${day.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}.${year}`;

    console.log('✅ [API] Бронирование создано:', result.booking.id, 'тип оплаты:', paymentType);

    res.json({
      success: true,
      booking: {
        id: result.booking.id,
        serviceName: service.name,
        date: dateFormatted,
        time: `${startTime} - ${endTime}`,
        prepayment: (currentPaymentAmount / 100).toFixed(0),
        paymentMemo: paymentMemo,
        paymentType: isFullPayment ? 'FULL' : 'PREPAYMENT',
        totalPrice: (discountedTotalPrice / 100).toFixed(0),
        remainingAmount: (remainingAmount / 100).toFixed(0)
      }
    });

  } catch (error) {
    console.error('Error in POST /api/booking:', error);
    res.status(500).json({ error: 'Ошибка создания бронирования' });
  }
});

/**
 * POST /api/booking/pay-remaining
 * Создаёт платёж на оплату остатка по бронированию
 */
app.post('/api/booking/pay-remaining', async (req: Request, res: Response) => {
  try {
    const { bookingId, telegramId } = req.body;

    if (!bookingId || !telegramId) {
      return res.status(400).json({ success: false, error: 'Отсутствуют обязательные параметры' });
    }

    // Находим пользователя
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    // Находим бронирование
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        service: true,
        payment: true
      }
    });

    if (!booking) {
      return res.status(404).json({ success: false, error: 'Бронирование не найдено' });
    }

    if (booking.userId !== user.id) {
      return res.status(403).json({ success: false, error: 'Нет доступа к этому бронированию' });
    }

    // Проверяем, что бронирование подтверждено (первый платёж прошёл)
    if (booking.status !== 'CONFIRMED') {
      return res.status(400).json({ success: false, error: 'Бронирование ещё не подтверждено' });
    }

    // Проверяем, что есть остаток к оплате
    const remainingAmount = (booking as any).remainingAmountUsd || 0;
    if (remainingAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Остаток уже оплачен' });
    }

    // Генерируем новый MEMO для платежа остатка
    const paymentMemo = await generatePaymentMemo();

    // Сохраняем MEMO для остатка в отдельное поле бронирования
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        remainingPaymentMemo: paymentMemo
      } as any
    });

    console.log(`✅ [API] Создан запрос на оплату остатка для бронирования ${bookingId}, MEMO: ${paymentMemo}, сумма: ${remainingAmount} центов`);

    res.json({
      success: true,
      paymentMemo: paymentMemo,
      amount: (remainingAmount / 100).toFixed(0),
      amountCents: remainingAmount
    });

  } catch (error) {
    console.error('Error in POST /api/booking/pay-remaining:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * GET /booking
 * Главная страница WebApp
 */
app.get('/booking', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../webapp/index.html'));
});

/**
 * GET / (корень) - редирект на /booking
 */
app.get('/', (req: Request, res: Response) => {
  res.redirect('/booking');
});

// ===================
// ERROR HANDLING
// ===================

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: Function) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ===================
// SERVER START
// ===================

export function startWebAppServer() {
  const port = config.webapp.port;

  app.listen(port, () => {
    console.log(`✅ WebApp сервер запущен на порту ${port}`);
    console.log(`🌐 URL: ${config.webapp.url}`);
  });

  return app;
}

// Запускаем сервер, если файл запущен напрямую
if (require.main === module) {
  startWebAppServer();
}

export { app };
