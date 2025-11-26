import { Context, Markup } from 'telegraf';
import { createBooking } from '../services/booking';
import { getUserByTelegramId, addReferralBonus } from '../services/user';
import { config } from '../config';
import { startSurveyAfterPayment } from './survey';
import { prisma } from '../services/database';
import {
  validatePromoCode,
  applyDiscount,
  calculateDiscount,
  recordPromoUsage,
  getPromoCodeById
} from '../services/promo';
import { generatePaymentMemo } from '../services/memo-generator';

export interface WebAppData {
  serviceId: string;
  slotId?: string;
  date: string;      // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  // Промокод (опционально)
  promoCode?: string;
  promoCodeId?: string;
  discountPercent?: number;
}

/**
 * Обработчик данных из WebApp (выбор даты и времени)
 */
export async function handleWebAppData(ctx: Context) {
  console.log('🎯 [handleWebAppData] Функция вызвана!');
  console.log('🎯 [handleWebAppData] ctx.from:', ctx.from?.id);
  console.log('🎯 [handleWebAppData] ctx.message:', JSON.stringify(ctx.message, null, 2));

  try {
    if (!ctx.from || !('web_app_data' in ctx.message!)) {
      console.log('⚠️ [handleWebAppData] Нет from или web_app_data в сообщении');
      return;
    }

    const webAppData = (ctx.message as any).web_app_data.data;
    const data: WebAppData = JSON.parse(webAppData);

    console.log('✅ [handleWebAppData] WebApp data received:', data);

    // Получаем пользователя
    const user = await getUserByTelegramId(ctx.from.id);
    if (!user) {
      await ctx.reply('Ошибка: пользователь не найден. Используйте /start для регистрации.');
      return;
    }

    // Получаем услугу по serviceId (например service_online)
    const service = await prisma.service.findFirst({
      where: {
        OR: [
          { serviceId: data.serviceId },
          { id: data.serviceId }
        ]
      }
    });

    if (!service) {
      await ctx.reply('Ошибка: услуга не найдена.');
      return;
    }

    // Парсим дату и время
    const [year, month, day] = data.date.split('-').map(Number);
    const [startHour, startMin] = data.startTime.split(':').map(Number);
    const [endHour, endMin] = data.endTime.split(':').map(Number);

    const startTime = new Date(Date.UTC(year, month - 1, day, startHour - 3, startMin)); // UTC (MSK = UTC+3)
    const endTime = new Date(Date.UTC(year, month - 1, day, endHour - 3, endMin));

    // Создаём бронирование и платёж
    const { booking, payment } = await createBooking({
      userId: user.id,
      serviceId: service.id,
      startTime,
      endTime
    });

    // Помечаем слот как занятый
    if (data.slotId) {
      await prisma.availableSlot.update({
        where: { id: data.slotId },
        data: {
          isBooked: true,
          bookingId: booking.id
        }
      });
    }

    // Форматируем дату и время для отображения
    const startTimeFormatted = `${data.date.split('-').reverse().join('.')} ${data.startTime}`;

    // Рассчитываем суммы (цены уже в центах USD)
    const priceUsdt = (service.priceUsd / 100).toFixed(2);
    let finalAmountUsd = payment.amountUsd;
    let promoApplied = false;
    let promoInfo = '';

    // Генерируем уникальный MEMO для платежа
    const paymentMemo = await generatePaymentMemo();

    // Обрабатываем промокод если передан из WebApp
    if (data.promoCode && data.promoCodeId) {
      // Повторно валидируем промокод для безопасности
      const validation = await validatePromoCode(
        data.promoCode,
        user.id,
        service.serviceId
      );

      if (validation.valid && validation.promoCode) {
        // Применяем скидку
        const discountAmount = calculateDiscount(payment.amountUsd, validation.promoCode.discountPercent);
        finalAmountUsd = applyDiscount(payment.amountUsd, validation.promoCode.discountPercent);

        // Обновляем платёж с промокодом и MEMO
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            amountUsd: finalAmountUsd,
            amountTon: (finalAmountUsd / 100).toFixed(2),
            promoInfo: `Промокод: ${validation.promoCode.code} (-${validation.promoCode.discountPercent}%)`,
            paymentMemo: paymentMemo
          }
        });

        // Записываем использование промокода
        await recordPromoUsage(
          validation.promoCode.id,
          user.id,
          booking.id,
          discountAmount
        );

        promoApplied = true;
        promoInfo = `🎁 <b>Промокод ${validation.promoCode.code}:</b> -${validation.promoCode.discountPercent}% (-${(discountAmount / 100).toFixed(2)} USDT)\n`;
      }
    }

    const prepaymentUsdt = (finalAmountUsd / 100).toFixed(2);

    // Если промокод не применён, сохраняем сумму USDT и MEMO
    if (!promoApplied) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          amountTon: prepaymentUsdt,
          paymentMemo: paymentMemo
        }
      });
    }

    // Формируем текст с учётом промокода
    let confirmationText = `<b>💵 Оплата бронирования (USDT)</b>\n\n` +
      `🔧 <b>Услуга:</b> ${service.name}\n` +
      `📅 <b>Дата и время:</b> ${startTimeFormatted} (МСК)\n` +
      `⏱ <b>Длительность:</b> ${service.durationMinutes} минут\n\n` +
      `💰 <b>Стоимость услуги:</b> ${priceUsdt} USDT\n`;

    if (promoApplied) {
      const originalPrepayment = (payment.amountUsd / 100).toFixed(2);
      confirmationText += `💳 <b>Предоплата (25%):</b> <s>${originalPrepayment}</s> USDT\n` +
        promoInfo +
        `✨ <b>К оплате:</b> ${prepaymentUsdt} USDT\n\n`;
    } else {
      confirmationText += `💳 <b>Предоплата (25%):</b> ${prepaymentUsdt} USDT\n\n`;
    }

    confirmationText += `━━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>📮 Адрес кошелька:</b>\n` +
      `<code>${config.ton.walletAddress}</code>\n\n` +
      `<b>📝 ОБЯЗАТЕЛЬНЫЙ КОММЕНТАРИЙ:</b>\n` +
      `<code>${paymentMemo}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>⚠️ ВАЖНО:</b>\n` +
      `• Отправляйте <b>USDT в сети TON</b> (не TON!)\n` +
      `• <b>ОБЯЗАТЕЛЬНО</b> укажите комментарий: <code>${paymentMemo}</code>\n` +
      `• Без комментария платёж <b>НЕ БУДЕТ</b> зачислен!\n\n` +
      `<b>Инструкция:</b>\n` +
      `1. Откройте кошелёк (Tonkeeper, Tonhub)\n` +
      `2. Выберите <b>USDT</b>\n` +
      `3. Адрес: скопируйте выше\n` +
      `4. Сумма: <b>${prepaymentUsdt} USDT</b>\n` +
      `5. Комментарий: <b>${paymentMemo}</b>\n` +
      `6. Подтвердите перевод\n\n` +
      `⏰ <i>Платёж действителен 1 час</i>\n` +
      `✅ <i>Оплата зачислится автоматически</i>`;

    // Формируем кнопки - без кнопки промокода если уже применён
    // Убрана кнопка "Я оплатил" - платёж зачисляется автоматически по MEMO
    const buttons = promoApplied
      ? [
          [Markup.button.callback('🔄 Проверить статус платежа', `check:${payment.id}`)],
          [Markup.button.callback('❌ Отменить бронирование', `cancel:${booking.id}`)]
        ]
      : [
          [Markup.button.callback('🎁 У меня есть промокод', `promo:${payment.id}`)],
          [Markup.button.callback('🔄 Проверить статус платежа', `check:${payment.id}`)],
          [Markup.button.callback('❌ Отменить бронирование', `cancel:${booking.id}`)]
        ];

    await ctx.replyWithHTML(
      confirmationText,
      Markup.inlineKeyboard(buttons)
    );

    // Сохраняем ID в сессию
    if ('session' in ctx) {
      (ctx as any).session.pendingBookingId = booking.id;
      (ctx as any).session.pendingServiceId = service.id;
    }
  } catch (error) {
    console.error('Ошибка в handleWebAppData:', error);
    await ctx.reply('Произошла ошибка при создании бронирования. Пожалуйста, попробуйте позже.');
  }
}

/**
 * @deprecated Функция handlePaidButton удалена - платежи теперь обрабатываются автоматически по MEMO
 */

/**
 * Обработчик кнопки "Оплатить TON" (legacy, если нужен)
 */
export async function handleTonPayment(ctx: Context, paymentId: string) {
  try {
    await ctx.answerCbQuery();

    // Получаем информацию о платеже
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        booking: {
          include: {
            service: true
          }
        }
      }
    });

    if (!payment) {
      await ctx.reply('Ошибка: платёж не найден.');
      return;
    }

    const prepaymentUsd = (payment.amountUsd / 100).toFixed(2);
    const prepaymentTon = payment.amountTon || '0';

    // Сохраняем paymentId в сессию для проверки хэша
    if ('session' in ctx) {
      (ctx as any).session.awaitingTxHash = paymentId;
    }

    // Формируем сообщение с инструкцией по оплате
    const paymentText = `<b>💎 Оплата TON</b>\n\n` +
      `💳 <b>Сумма:</b> ~${prepaymentTon} TON ($${prepaymentUsd})\n` +
      `📮 <b>Адрес кошелька:</b>\n<code>${config.ton.walletAddress}</code>\n\n` +
      `<b>Инструкция:</b>\n` +
      `1. Откройте ваш TON кошелёк (Tonkeeper, Tonhub и т.п.)\n` +
      `2. Отправьте <b>${prepaymentTon} TON</b> на указанный адрес\n` +
      `3. После оплаты <b>скиньте хэш транзакции</b> сюда в чат\n\n` +
      `⏰ <i>Платёж действителен 1 час</i>\n\n` +
      `Если возникли проблемы с оплатой, свяжитесь с менеджером @${config.telegram.managerUsername}`;

    await ctx.replyWithHTML(
      paymentText,
      Markup.inlineKeyboard([
        [Markup.button.url('💬 Написать менеджеру', `https://t.me/${config.telegram.managerUsername}`)],
        [Markup.button.callback('❌ Отменить', `cancel:${payment.bookingId}`)]
      ])
    );

    // Отправляем уведомление админам о новом бронировании
    await sendBookingNotificationToAdmins(ctx, payment);
  } catch (error) {
    console.error('Ошибка в handleTonPayment:', error);
    await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
  }
}

/**
 * Обработчик кнопки "Оплатить Stars"
 */
export async function handleStarsPayment(ctx: Context, paymentId: string) {
  try {
    await ctx.answerCbQuery();

    // Получаем информацию о платеже
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        booking: {
          include: {
            service: true,
            user: true
          }
        }
      }
    });

    if (!payment) {
      await ctx.reply('Ошибка: платёж не найден.');
      return;
    }

    const prepaymentUsd = payment.amountUsd / 100;
    // Курс Stars примерно 1 Star = $0.02
    const starsAmount = Math.ceil(prepaymentUsd / 0.02);

    // Создаём инвойс для Telegram Stars
    await ctx.replyWithInvoice({
      title: `Предоплата: ${payment.booking.service.name}`,
      description: `Предоплата 25% за услугу "${payment.booking.service.name}"`,
      payload: JSON.stringify({ paymentId, type: 'stars' }),
      currency: 'XTR', // Telegram Stars
      prices: [{ label: 'Предоплата', amount: starsAmount }],
      provider_token: '' // Пустой для Stars
    });

  } catch (error) {
    console.error('Ошибка в handleStarsPayment:', error);
    await ctx.reply('Ошибка при создании платежа Stars. Попробуйте оплату TON.');
  }
}

/**
 * Обработчик кнопки "Проверить оплату" (ручная проверка)
 */
export async function handleCheckPayment(ctx: Context, paymentId: string) {
  try {
    await ctx.answerCbQuery('Проверка оплаты...');

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId }
    });

    if (!payment) {
      await ctx.reply('Ошибка: платёж не найден.');
      return;
    }

    if (payment.status === 'COMPLETED') {
      await ctx.reply('✅ Ваш платёж уже подтверждён!');
    } else {
      await ctx.reply('⏳ Платёж ещё не обнаружен. Пожалуйста, подождите 1-2 минуты после отправки.');
    }
  } catch (error) {
    console.error('Ошибка в handleCheckPayment:', error);
  }
}

/**
 * @deprecated Функции extractTxHash, handleTxHashMessage, verifyTonTransaction удалены.
 * Платежи теперь обрабатываются автоматически по MEMO в payment-checker.ts
 */

/**
 * Обработчик успешной оплаты Telegram Stars
 */
export async function handleSuccessfulPayment(ctx: Context) {
  if (!ctx.from || !ctx.message || !('successful_payment' in ctx.message)) return;

  try {
    const successfulPayment = ctx.message.successful_payment;
    const payload = JSON.parse(successfulPayment.invoice_payload);

    if (payload.type !== 'stars') return;

    const paymentId = payload.paymentId;

    // Получаем платёж
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        booking: {
          include: {
            service: true,
            user: true
          }
        }
      }
    });

    if (!payment) {
      await ctx.reply('Ошибка: платёж не найден.');
      return;
    }

    // Обновляем статус платежа и бронирования
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          promoInfo: `Stars: ${successfulPayment.telegram_payment_charge_id}`
        }
      }),
      prisma.booking.update({
        where: { id: payment.bookingId },
        data: {
          status: 'CONFIRMED',
          paymentStatus: 'COMPLETED'
        }
      })
    ]);

    // Уведомляем пользователя
    await ctx.replyWithHTML(
      '<b>✅ Оплата Stars успешно принята!</b>\n\n' +
      'Ваше бронирование подтверждено. Теперь заполните анкету для подготовки к консультации.'
    );

    // Запускаем анкету
    await startSurveyAfterPayment(ctx, payment.booking.serviceId, payment.bookingId);

    // Уведомляем админов
    const startTimeFormatted = payment.booking.startTime.toLocaleString('ru-RU', {
      timeZone: config.booking.timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    await ctx.telegram.sendMessage(
      config.telegram.adminChatId,
      `<b>⭐ ОПЛАТА STARS ПОДТВЕРЖДЕНА</b>\n\n` +
      `🆔 Бронирование: <code>${payment.bookingId}</code>\n` +
      `👤 Пользователь: ${ctx.from.first_name} (@${ctx.from.username || 'нет'})\n` +
      `🔧 Услуга: ${payment.booking.service.name}\n` +
      `📅 Дата: ${startTimeFormatted} (Berlin)\n` +
      `💰 Оплачено: ${successfulPayment.total_amount} Stars\n` +
      `🆔 Telegram Payment ID: <code>${successfulPayment.telegram_payment_charge_id}</code>`,
      { parse_mode: 'HTML' }
    );

  } catch (error) {
    console.error('Ошибка в handleSuccessfulPayment:', error);
    await ctx.reply('Произошла ошибка при обработке платежа. Свяжитесь с менеджером.');
  }
}

/**
 * Обработчик отмены бронирования
 */
export async function handleCancelBooking(ctx: Context, bookingId: string) {
  try {
    await ctx.answerCbQuery();

    // Отменяем бронирование
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: 'Отменено пользователем'
      }
    });

    await ctx.reply('❌ Бронирование отменено.');
  } catch (error) {
    console.error('Ошибка в handleCancelBooking:', error);
    await ctx.reply('Произошла ошибка при отмене бронирования.');
  }
}

/**
 * Отправляет уведомление о новом бронировании админам
 */
async function sendBookingNotificationToAdmins(ctx: Context, payment: any) {
  try {
    const booking = payment.booking;
    const service = booking.service;

    const startTimeFormatted = booking.startTime.toLocaleString('ru-RU', {
      timeZone: config.booking.timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const priceUsd = (service.priceUsd / 100).toFixed(2);
    const prepaymentUsd = (payment.amountUsd / 100).toFixed(2);

    const message = `<b>🆕 НОВОЕ БРОНИРОВАНИЕ</b>\n\n` +
      `🆔 <b>ID:</b> <code>${booking.id}</code>\n` +
      `👤 <b>Пользователь:</b> ${ctx.from?.first_name || 'Не указано'}\n` +
      `📞 <b>Telegram:</b> @${ctx.from?.username || 'нет'} (<code>${ctx.from?.id}</code>)\n\n` +
      `🔧 <b>Услуга:</b> ${service.name}\n` +
      `💵 <b>Стоимость:</b> $${priceUsd}\n` +
      `💳 <b>Предоплата:</b> ${payment.amountTon} USDT\n\n` +
      `📅 <b>Дата и время:</b> ${startTimeFormatted} (МСК)\n` +
      `⏱ <b>Длительность:</b> ${service.durationMinutes} минут\n\n` +
      `⏳ <b>Статус:</b> Ожидает оплаты`;

    await ctx.telegram.sendMessage(config.telegram.adminChatId, message, {
      parse_mode: 'HTML'
    });
  } catch (error) {
    console.error('Ошибка в sendBookingNotificationToAdmins:', error);
  }
}

/**
 * Обработчик ввода имени и username после оплаты
 */
export async function handleUserDataInput(ctx: Context) {
  if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;
  if (!('session' in ctx)) return;

  const session = (ctx as any).session;
  const bookingId = session.awaitingUserData;

  if (!bookingId) return;

  const inputText = ctx.message.text.trim();

  // Получаем бронирование с деталями
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      service: true,
      user: true
    }
  });

  if (!booking) {
    await ctx.reply('Ошибка: бронирование не найдено.');
    session.awaitingUserData = undefined;
    return;
  }

  // Парсим введённые данные (имя и username)
  const usernameMatch = inputText.match(/@([a-zA-Z0-9_]+)/);
  const username = usernameMatch ? usernameMatch[1] : ctx.from.username || '';
  const name = inputText.replace(/@[a-zA-Z0-9_]+/, '').trim() || ctx.from.first_name || 'Не указано';

  // Обновляем данные пользователя
  await prisma.user.update({
    where: { id: booking.userId },
    data: {
      firstName: name,
      username: username || undefined
    }
  });

  // Очищаем сессию
  session.awaitingUserData = undefined;

  // Форматируем дату и время
  const startTimeFormatted = booking.startTime.toLocaleString('ru-RU', {
    timeZone: config.booking.timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Уведомляем пользователя о успешной записи
  await ctx.replyWithHTML(
    `<b>🎉 Вы успешно записаны на консультацию!</b>\n\n` +
    `🔧 <b>Услуга:</b> ${booking.service.name}\n` +
    `📅 <b>Дата и время:</b> ${startTimeFormatted} (МСК)\n` +
    `⏱ <b>Длительность:</b> ${booking.service.durationMinutes} минут\n\n` +
    `👤 <b>Имя:</b> ${name}\n` +
    `📱 <b>Telegram:</b> @${username || ctx.from.username || 'нет'}\n\n` +
    `<i>За 1 час до консультации вам придёт напоминание.</i>\n\n` +
    `Для возврата в главное меню нажмите /start`
  );

  // Уведомляем админов о полной записи
  await ctx.telegram.sendMessage(
    config.telegram.adminChatId,
    `<b>🎉 НОВАЯ ЗАПИСЬ НА КОНСУЛЬТАЦИЮ</b>\n\n` +
    `🆔 Бронирование: <code>${booking.id}</code>\n` +
    `👤 <b>Имя:</b> ${name}\n` +
    `📱 <b>Telegram:</b> @${username || ctx.from.username || 'нет'} (<code>${ctx.from.id}</code>)\n\n` +
    `🔧 <b>Услуга:</b> ${booking.service.name}\n` +
    `📅 <b>Дата и время:</b> ${startTimeFormatted} (МСК)\n` +
    `⏱ <b>Длительность:</b> ${booking.service.durationMinutes} минут\n\n` +
    `✅ <b>Статус:</b> Оплачено, записан`,
    { parse_mode: 'HTML' }
  );
}

// ==========================
// ПРОМОКОДЫ
// ==========================

/**
 * Обработчик кнопки "У меня есть промокод"
 */
export async function handlePromoButton(ctx: Context, paymentId: string) {
  try {
    await ctx.answerCbQuery();

    // Получаем информацию о платеже
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        booking: {
          include: {
            service: true
          }
        }
      }
    });

    if (!payment) {
      await ctx.reply('Ошибка: платёж не найден.');
      return;
    }

    if (payment.status === 'COMPLETED') {
      await ctx.reply('Этот платёж уже завершён.');
      return;
    }

    // Сохраняем paymentId в сессию для обработки промокода
    if ('session' in ctx) {
      (ctx as any).session.awaitingPromoCode = paymentId;
    }

    await ctx.replyWithHTML(
      `<b>🎁 Введите промокод</b>\n\n` +
      `Отправьте промокод текстовым сообщением.\n\n` +
      `<i>Например: WELCOME</i>`
    );

  } catch (error) {
    console.error('Ошибка в handlePromoButton:', error);
    await ctx.reply('Произошла ошибка. Попробуйте позже.');
  }
}

/**
 * Обработчик ввода промокода
 */
export async function handlePromoCodeInput(ctx: Context) {
  if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;
  if (!('session' in ctx)) return;

  const session = (ctx as any).session;
  const paymentId = session.awaitingPromoCode;

  if (!paymentId) return;

  const promoCode = ctx.message.text.trim().toUpperCase();

  try {
    // Получаем платёж с бронированием
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        booking: {
          include: {
            service: true,
            user: true
          }
        }
      }
    });

    if (!payment) {
      await ctx.reply('Ошибка: платёж не найден.');
      session.awaitingPromoCode = undefined;
      return;
    }

    if (payment.status === 'COMPLETED') {
      await ctx.reply('Этот платёж уже завершён.');
      session.awaitingPromoCode = undefined;
      return;
    }

    // Валидируем промокод
    const validation = await validatePromoCode(
      promoCode,
      payment.userId,
      payment.booking.service.serviceId
    );

    if (!validation.valid) {
      await ctx.reply(`❌ ${validation.error}`);
      // Не очищаем сессию, чтобы пользователь мог попробовать другой код
      return;
    }

    // Промокод валиден - применяем скидку
    const originalAmount = payment.amountUsd;
    const discountAmount = calculateDiscount(originalAmount, validation.promoCode!.discountPercent);
    const newAmount = applyDiscount(originalAmount, validation.promoCode!.discountPercent);

    // Обновляем сумму платежа
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        amountUsd: newAmount,
        amountTon: (newAmount / 100).toFixed(2),
        promoInfo: `Промокод: ${validation.promoCode!.code} (-${validation.promoCode!.discountPercent}%)`
      }
    });

    // Сохраняем промокод в сессию для записи использования после оплаты
    session.appliedPromoCode = {
      id: validation.promoCode!.id,
      code: validation.promoCode!.code,
      discountPercent: validation.promoCode!.discountPercent,
      discountAmount: discountAmount
    };

    // Очищаем ожидание ввода промокода
    session.awaitingPromoCode = undefined;

    // Форматируем суммы
    const originalUsdt = (originalAmount / 100).toFixed(2);
    const discountUsdt = (discountAmount / 100).toFixed(2);
    const newUsdt = (newAmount / 100).toFixed(2);
    const priceUsdt = (payment.booking.service.priceUsd / 100).toFixed(2);

    // Форматируем дату
    const startTimeFormatted = payment.booking.startTime.toLocaleString('ru-RU', {
      timeZone: config.booking.timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Получаем paymentMemo из платежа
    const paymentMemo = payment.paymentMemo;

    // Отправляем обновлённое сообщение об оплате с MEMO
    const confirmationText = `<b>💵 Оплата бронирования (USDT)</b>\n\n` +
      `🔧 <b>Услуга:</b> ${payment.booking.service.name}\n` +
      `📅 <b>Дата и время:</b> ${startTimeFormatted} (МСК)\n` +
      `⏱ <b>Длительность:</b> ${payment.booking.service.durationMinutes} минут\n\n` +
      `💰 <b>Стоимость услуги:</b> ${priceUsdt} USDT\n` +
      `💳 <b>Предоплата (25%):</b> <s>${originalUsdt}</s> USDT\n` +
      `🎁 <b>Промокод ${validation.promoCode!.code}:</b> -${validation.promoCode!.discountPercent}% (-${discountUsdt} USDT)\n` +
      `✨ <b>К оплате:</b> ${newUsdt} USDT\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>📮 Адрес кошелька:</b>\n` +
      `<code>${config.ton.walletAddress}</code>\n\n` +
      `<b>📝 ОБЯЗАТЕЛЬНЫЙ КОММЕНТАРИЙ:</b>\n` +
      `<code>${paymentMemo}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>⚠️ ВАЖНО:</b>\n` +
      `• Отправляйте <b>USDT в сети TON</b> (не TON!)\n` +
      `• <b>ОБЯЗАТЕЛЬНО</b> укажите комментарий: <code>${paymentMemo}</code>\n` +
      `• Без комментария платёж <b>НЕ БУДЕТ</b> зачислен!\n\n` +
      `<b>Инструкция:</b>\n` +
      `1. Откройте кошелёк (Tonkeeper, Tonhub)\n` +
      `2. Выберите <b>USDT</b>\n` +
      `3. Адрес: скопируйте выше\n` +
      `4. Сумма: <b>${newUsdt} USDT</b>\n` +
      `5. Комментарий: <b>${paymentMemo}</b>\n` +
      `6. Подтвердите перевод\n\n` +
      `⏰ <i>Платёж действителен 1 час</i>\n` +
      `✅ <i>Оплата зачислится автоматически</i>`;

    await ctx.replyWithHTML(
      confirmationText,
      Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Проверить статус платежа', `check:${payment.id}`)],
        [Markup.button.callback('❌ Отменить бронирование', `cancel:${payment.bookingId}`)]
      ])
    );

  } catch (error) {
    console.error('Ошибка в handlePromoCodeInput:', error);
    await ctx.reply('Произошла ошибка при применении промокода. Попробуйте позже.');
  }
}

/**
 * Записывает использование промокода после успешной оплаты
 */
export async function recordPromoUsageAfterPayment(
  ctx: Context,
  bookingId: string,
  userId: string
) {
  if (!('session' in ctx)) return;

  const session = (ctx as any).session;
  const appliedPromo = session.appliedPromoCode;

  if (!appliedPromo) return;

  try {
    await recordPromoUsage(
      appliedPromo.id,
      userId,
      bookingId,
      appliedPromo.discountAmount
    );

    // Очищаем сессию
    session.appliedPromoCode = undefined;
  } catch (error) {
    console.error('Ошибка при записи использования промокода:', error);
    // Не прерываем основной поток - промокод уже применён к сумме
  }
}
