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
    const services = await prisma.service.findMany({
      orderBy: { serviceId: 'asc' }
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
      prepaymentUsd: booking.payment?.amountUsd || 0
    }));

    res.json(formattedBookings);
  } catch (error) {
    console.error('Error in GET /api/bookings/:telegramId:', error);
    res.status(500).json({ error: 'Internal server error' });
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
