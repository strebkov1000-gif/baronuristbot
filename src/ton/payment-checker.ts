import { TonClient, Address, Cell } from '@ton/ton';
import { JettonMaster, JettonWallet } from '@ton/ton';
import { config } from '../config';
import { prisma } from '../services/database';
import { Telegraf } from 'telegraf';

let tonClient: TonClient | null = null;
let ourJettonWalletAddress: Address | null = null;

// Кэш для уже обработанных транзакций (чтобы не слать повторные уведомления)
const processedTransactions = new Set<string>();

// Список игнорируемых транзакций (не будут показываться в админке)
export const ignoredTransactions = new Set<string>();

/**
 * Инициализирует TON клиент
 */
export function initTonClient(): TonClient {
  if (!tonClient) {
    tonClient = new TonClient({
      endpoint: config.ton.apiEndpoint,
      apiKey: config.ton.apiKey || undefined
    });
    console.log('✅ TON Client инициализирован');
  }
  return tonClient;
}

/**
 * Получает адрес нашего Jetton Wallet для USDT
 * Каждый TON-кошелёк имеет отдельный Jetton Wallet для каждого токена
 */
async function getOurJettonWalletAddress(client: TonClient): Promise<Address> {
  if (ourJettonWalletAddress) {
    return ourJettonWalletAddress;
  }

  const jettonMasterAddress = Address.parse(config.ton.usdtJettonAddress);
  const ourWalletAddress = Address.parse(config.ton.walletAddress);

  // Получаем адрес Jetton Wallet через Jetton Master контракт
  const jettonMaster = client.open(JettonMaster.create(jettonMasterAddress));
  ourJettonWalletAddress = await jettonMaster.getWalletAddress(ourWalletAddress);

  console.log(`💰 USDT Jetton Wallet адрес: ${ourJettonWalletAddress.toString()}`);
  return ourJettonWalletAddress;
}

/**
 * Парсит forward_payload для извлечения комментария
 * TEP-74 стандарт: opcode 0 = текстовый комментарий
 */
function parseJettonComment(forwardPayload: Cell | null): string | null {
  if (!forwardPayload) return null;

  try {
    const slice = forwardPayload.beginParse();

    // Проверяем есть ли биты для opcode
    if (slice.remainingBits < 32) {
      // Нет opcode - пробуем прочитать как текст
      try {
        return slice.loadStringTail();
      } catch {
        return null;
      }
    }

    const opcode = slice.loadUint(32);

    // Opcode 0 = текстовый комментарий (TEP-74)
    if (opcode === 0) {
      return slice.loadStringTail();
    }

    return null; // Другой opcode, не комментарий
  } catch (error) {
    console.error('Ошибка парсинга jetton comment:', error);
    return null;
  }
}

/**
 * Проверяет входящие USDT Jetton транзакции через TonAPI
 */
export async function checkIncomingUsdtTransfers(bot: Telegraf<any>) {
  try {
    // Получаем список ожидающих платежей
    const pendingPayments = await prisma.payment.findMany({
      where: {
        status: 'PENDING',
        memoMatchStatus: 'AWAITING',
        expiresAt: { gt: new Date() }
      },
      include: {
        booking: {
          include: {
            service: true,
            user: true
          }
        }
      },
      take: 50
    });

    if (pendingPayments.length === 0) {
      return;
    }

    console.log(`🔍 Проверка USDT платежей... (${pendingPayments.length} ожидающих)`);

    // Получаем адрес Jetton Wallet через TonAPI
    const client = initTonClient();
    const jettonWalletAddress = await getOurJettonWalletAddress(client);
    const jettonWalletAddressStr = jettonWalletAddress.toString();

    // Используем TonAPI для получения событий (более надёжно)
    const response = await fetch(
      `https://tonapi.io/v2/accounts/${jettonWalletAddressStr}/events?limit=30`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      console.error('Ошибка TonAPI:', response.status, response.statusText);
      return;
    }

    const data = await response.json() as { events?: any[] };
    const events = data.events || [];

    console.log(`📊 Получено ${events.length} событий через TonAPI`);

    // Обрабатываем каждое событие
    for (const event of events) {
      try {
        const actions = event.actions || [];

        for (const action of actions) {
          // Ищем входящие Jetton переводы
          if (action.type === 'JettonTransfer' && action.JettonTransfer) {
            const transfer = action.JettonTransfer;

            // Проверяем, что это перевод на наш кошелёк
            const recipientAddress = transfer.recipient?.address;
            if (!recipientAddress) continue;

            // Нормализуем адрес для сравнения
            const recipientNormalized = recipientAddress.replace('0:', '');
            const ourWalletNormalized = Address.parse(config.ton.walletAddress).toRawString().replace('0:', '');

            if (recipientNormalized !== ourWalletNormalized) continue;

            // Получаем данные о переводе
            const amountMicro = parseInt(transfer.amount || '0');
            const amountUsdt = amountMicro / 1_000_000;
            const amountCents = Math.floor(amountUsdt * 100);
            const memo = transfer.comment || null;
            const senderAddress = transfer.sender?.address || '';
            const txHash = event.event_id;
            const lt = event.lt?.toString() || '';

            console.log(`💸 TonAPI: ${amountUsdt} USDT, memo: "${memo || 'нет'}", event: ${txHash.slice(0, 16)}...`);

            // Проверяем, не обработана ли уже эта транзакция
            const existingTx = await prisma.payment.findFirst({
              where: { tonTransactionHash: txHash }
            });

            if (existingTx) {
              continue; // Уже обработана
            }

            // Сопоставляем платёж по MEMO
            await matchPaymentByMemo(
              bot,
              memo,
              amountCents,
              txHash,
              senderAddress,
              lt
            );
          }
        }
      } catch (error) {
        console.error('Ошибка обработки события TonAPI:', error);
      }
    }
  } catch (error) {
    console.error('Ошибка в checkIncomingUsdtTransfers:', error);
  }
}

/**
 * Сопоставляет входящий платёж с заказом по MEMO
 */
async function matchPaymentByMemo(
  bot: Telegraf<any>,
  memo: string | null,
  amountCents: number,
  txHash: string,
  senderAddress: string,
  logicalTime: string
) {
  // Проверяем формат MEMO (ORD-XXXXXX)
  if (memo && memo.startsWith('ORD-')) {
    // Сначала ищем в таблице платежей (первый платёж / предоплата)
    const payment = await prisma.payment.findUnique({
      where: { paymentMemo: memo },
      include: {
        booking: {
          include: {
            service: true,
            user: true
          }
        }
      }
    });

    if (payment && payment.status === 'PENDING') {
      const requiredAmount = payment.amountUsd;
      const minAmount = Math.floor(requiredAmount * 0.95); // 5% допуск

      if (amountCents >= minAmount) {
        // УСПЕХ: MEMO совпал и сумма достаточна
        await confirmPaymentWithMemo(bot, payment, txHash, amountCents, senderAddress, logicalTime);
      } else {
        // НЕДОСТАТОЧНО: MEMO верный, но сумма мала
        await markPaymentInsufficient(bot, payment, txHash, amountCents, senderAddress);
      }
      return;
    }

    // Если не найден в платежах, ищем в бронированиях (оплата остатка)
    const bookingWithRemaining = await prisma.booking.findFirst({
      where: {
        remainingPaymentMemo: memo,
        status: 'CONFIRMED',
        remainingAmountUsd: { gt: 0 }
      } as any,
      include: {
        service: true,
        user: true,
        payment: true
      }
    });

    if (bookingWithRemaining) {
      const requiredAmount = (bookingWithRemaining as any).remainingAmountUsd || 0;
      const minAmount = Math.floor(requiredAmount * 0.95); // 5% допуск

      if (amountCents >= minAmount) {
        // УСПЕХ: Оплата остатка
        await confirmRemainingPayment(bot, bookingWithRemaining, txHash, amountCents, senderAddress, memo);
      } else {
        // НЕДОСТАТОЧНО: MEMO верный, но сумма мала для остатка
        await notifyInsufficientRemainingPayment(bot, bookingWithRemaining, txHash, amountCents, senderAddress, memo);
      }
      return;
    }

    // MEMO не найден ни в платежах, ни в бронированиях
    console.log(`⚠️ MEMO "${memo}" не найден в БД. Hash: ${txHash}`);
    await notifyAdminsAboutUnmatchedPayment(bot, txHash, amountCents, memo, senderAddress);
  } else {
    // Нет MEMO или неверный формат
    console.log(`⚠️ Платёж без MEMO или неверный формат: "${memo}". Hash: ${txHash}`);
    await notifyAdminsAboutUnmatchedPayment(bot, txHash, amountCents, memo, senderAddress);
  }
}

/**
 * Подтверждает платёж за остаток
 */
async function confirmRemainingPayment(
  bot: Telegraf<any>,
  booking: any,
  txHash: string,
  actualAmountCents: number,
  senderAddress: string,
  memo: string
) {
  const user = booking.user;
  const service = booking.service;

  // Обновляем бронирование - обнуляем остаток и обновляем оплаченную сумму
  const prepaidBefore = (booking as any).prepaidAmountUsd || 0;
  const newPrepaid = prepaidBefore + actualAmountCents;

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      prepaidAmountUsd: newPrepaid,
      remainingAmountUsd: 0,
      remainingPaymentMemo: null // Очищаем MEMO после оплаты
    } as any
  });

  console.log(`✅ Оплата остатка подтверждена для бронирования ${booking.id}`);

  // Форматируем дату и время
  const startTimeFormatted = booking.startTime.toLocaleString('ru-RU', {
    timeZone: config.booking.timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Уведомляем пользователя
  try {
    await bot.telegram.sendMessage(
      Number(user.telegramId),
      `<b>✅ Оплата остатка принята!</b>\n\n` +
      `Ваша консультация полностью оплачена:\n\n` +
      `🔧 <b>Услуга:</b> ${service.name}\n` +
      `📅 <b>Дата и время:</b> ${startTimeFormatted} (МСК)\n` +
      `💰 <b>Получено:</b> ${(actualAmountCents / 100).toFixed(2)} USDT\n\n` +
      `Спасибо! Ждём вас на консультации.`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Ошибка отправки уведомления пользователю:', error);
  }

  // Уведомляем админов
  const adminMessage = `<b>✅ ОПЛАТА ОСТАТКА USDT ПОДТВЕРЖДЕНА</b>\n\n` +
    `🆔 <b>Бронирование:</b> <code>${booking.id}</code>\n` +
    `📝 <b>MEMO:</b> <code>${memo}</code>\n` +
    `👤 <b>Пользователь:</b> ${user.firstName || 'Не указано'} (@${user.username || 'нет'})\n` +
    `📞 <b>Telegram ID:</b> <code>${user.telegramId}</code>\n\n` +
    `🔧 <b>Услуга:</b> ${service.name}\n` +
    `💳 <b>Получено (остаток):</b> ${(actualAmountCents / 100).toFixed(2)} USDT\n` +
    `💰 <b>Всего оплачено:</b> ${(newPrepaid / 100).toFixed(2)} USDT\n` +
    `📅 <b>Дата консультации:</b> ${startTimeFormatted} (МСК)\n\n` +
    `🔗 <b>Hash:</b>\n<code>${txHash}</code>`;

  try {
    await bot.telegram.sendMessage(config.telegram.adminChatId, adminMessage, {
      parse_mode: 'HTML'
    });
  } catch (error) {
    console.error('Ошибка в notifyAdminsAboutRemainingPayment:', error);
  }
}

/**
 * Уведомляет о недостаточной сумме оплаты остатка
 */
async function notifyInsufficientRemainingPayment(
  bot: Telegraf<any>,
  booking: any,
  txHash: string,
  actualAmountCents: number,
  senderAddress: string,
  memo: string
) {
  const user = booking.user;
  const requiredAmount = (booking as any).remainingAmountUsd || 0;

  const required = (requiredAmount / 100).toFixed(2);
  const received = (actualAmountCents / 100).toFixed(2);

  // Уведомляем пользователя
  try {
    await bot.telegram.sendMessage(
      Number(user.telegramId),
      `<b>⚠️ Недостаточная сумма оплаты остатка</b>\n\n` +
      `💰 Получено: <b>${received} USDT</b>\n` +
      `💳 Требуется: <b>${required} USDT</b>\n\n` +
      `Пожалуйста, доплатите недостающую сумму (укажите тот же комментарий <code>${memo}</code>) или свяжитесь с менеджером @${config.telegram.managerUsername}`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Ошибка отправки уведомления о недостаточной сумме:', error);
  }

  // Уведомляем админов
  await bot.telegram.sendMessage(
    config.telegram.adminChatId,
    `<b>⚠️ НЕДОСТАТОЧНАЯ СУММА ОПЛАТЫ ОСТАТКА</b>\n\n` +
    `🆔 Бронирование: <code>${booking.id}</code>\n` +
    `📝 MEMO: <code>${memo}</code>\n` +
    `💰 Получено: ${received} USDT\n` +
    `💳 Требуется: ${required} USDT\n` +
    `👤 Пользователь: ${user.firstName || 'Не указано'} (@${user.username || 'нет'})\n` +
    `🔗 Hash: <code>${txHash}</code>`,
    { parse_mode: 'HTML' }
  );
}

/**
 * Подтверждает платёж после успешного сопоставления MEMO
 */
async function confirmPaymentWithMemo(
  bot: Telegraf<any>,
  payment: any,
  txHash: string,
  actualAmountCents: number,
  senderAddress: string,
  logicalTime: string
) {
  const booking = payment.booking;
  const user = booking.user;
  const service = booking.service;

  // Обновляем статус платежа и бронирования
  // Также обновляем prepaidAmountUsd
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'COMPLETED',
        memoMatchStatus: 'MATCHED',
        tonTransactionHash: txHash,
        tonTransactionLt: logicalTime,
        senderAddress,
        receivedAmountUsd: actualAmountCents,
        completedAt: new Date()
      }
    }),
    prisma.booking.update({
      where: { id: payment.bookingId },
      data: {
        status: 'CONFIRMED',
        paymentStatus: 'COMPLETED',
        prepaidAmountUsd: actualAmountCents // Записываем оплаченную сумму
      } as any
    })
  ]);

  // Начисляем реферальный бонус
  const { addReferralBonus } = await import('../services/user');
  await addReferralBonus(payment.userId, payment.amountUsd);

  // Форматируем дату и время
  const startTimeFormatted = booking.startTime.toLocaleString('ru-RU', {
    timeZone: config.booking.timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Уведомляем пользователя
  try {
    await bot.telegram.sendMessage(
      Number(user.telegramId),
      `<b>✅ Платёж успешно принят!</b>\n\n` +
      `Ваше бронирование подтверждено:\n\n` +
      `🔧 <b>Услуга:</b> ${service.name}\n` +
      `📅 <b>Дата и время:</b> ${startTimeFormatted} (МСК)\n` +
      `💰 <b>Получено:</b> ${(actualAmountCents / 100).toFixed(2)} USDT\n\n` +
      `Теперь, пожалуйста, заполните анкету для подготовки к консультации.\n\n` +
      `<b>1. Ваше имя</b>\nПожалуйста, укажите ваше полное имя.`,
      { parse_mode: 'HTML' }
    );
    console.log(`📧 Уведомление отправлено пользователю ${user.telegramId}`);
  } catch (error) {
    console.error('Ошибка отправки уведомления пользователю:', error);
  }

  // Уведомляем админов
  await notifyAdminsAboutPayment(bot, payment, txHash, actualAmountCents, startTimeFormatted);
}

/**
 * Помечает платёж как недостаточный по сумме
 */
async function markPaymentInsufficient(
  bot: Telegraf<any>,
  payment: any,
  txHash: string,
  actualAmountCents: number,
  senderAddress: string
) {
  const user = payment.booking.user;

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      memoMatchStatus: 'INSUFFICIENT',
      tonTransactionHash: txHash,
      senderAddress,
      receivedAmountUsd: actualAmountCents
    }
  });

  const required = (payment.amountUsd / 100).toFixed(2);
  const received = (actualAmountCents / 100).toFixed(2);

  // Уведомляем пользователя
  try {
    await bot.telegram.sendMessage(
      Number(user.telegramId),
      `<b>⚠️ Недостаточная сумма платежа</b>\n\n` +
      `💰 Получено: <b>${received} USDT</b>\n` +
      `💳 Требуется: <b>${required} USDT</b>\n\n` +
      `Пожалуйста, доплатите недостающую сумму (укажите тот же комментарий <code>${payment.paymentMemo}</code>) или свяжитесь с менеджером @${config.telegram.managerUsername}`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Ошибка отправки уведомления о недостаточной сумме:', error);
  }

  // Уведомляем админов
  await bot.telegram.sendMessage(
    config.telegram.adminChatId,
    `<b>⚠️ НЕДОСТАТОЧНАЯ СУММА ПЛАТЕЖА</b>\n\n` +
    `🆔 Бронирование: <code>${payment.bookingId}</code>\n` +
    `📝 MEMO: <code>${payment.paymentMemo}</code>\n` +
    `💰 Получено: ${received} USDT\n` +
    `💳 Требуется: ${required} USDT\n` +
    `👤 Пользователь: ${user.firstName || 'Не указано'} (@${user.username || 'нет'})\n` +
    `🔗 Hash: <code>${txHash}</code>`,
    { parse_mode: 'HTML' }
  );
}

/**
 * Уведомляет админов об успешной оплате
 */
async function notifyAdminsAboutPayment(
  bot: Telegraf<any>,
  payment: any,
  txHash: string,
  actualAmountCents: number,
  startTimeFormatted: string
) {
  const booking = payment.booking;
  const user = booking.user;
  const service = booking.service;

  const message = `<b>✅ ОПЛАТА USDT ПОДТВЕРЖДЕНА (MEMO)</b>\n\n` +
    `🆔 <b>Бронирование:</b> <code>${booking.id}</code>\n` +
    `📝 <b>MEMO:</b> <code>${payment.paymentMemo}</code>\n` +
    `👤 <b>Пользователь:</b> ${user.firstName || 'Не указано'} (@${user.username || 'нет'})\n` +
    `📞 <b>Telegram ID:</b> <code>${user.telegramId}</code>\n\n` +
    `🔧 <b>Услуга:</b> ${service.name}\n` +
    `💳 <b>Получено:</b> ${(actualAmountCents / 100).toFixed(2)} USDT\n` +
    `💰 <b>Ожидалось:</b> ${(payment.amountUsd / 100).toFixed(2)} USDT\n` +
    `📅 <b>Дата консультации:</b> ${startTimeFormatted} (МСК)\n\n` +
    `🔗 <b>Hash:</b>\n<code>${txHash}</code>`;

  try {
    await bot.telegram.sendMessage(config.telegram.adminChatId, message, {
      parse_mode: 'HTML'
    });
    console.log(`📧 Уведомление отправлено админам`);
  } catch (error) {
    console.error('Ошибка в notifyAdminsAboutPayment:', error);
  }
}

/**
 * Уведомляет админов о неопознанном платеже (только один раз)
 */
async function notifyAdminsAboutUnmatchedPayment(
  bot: Telegraf<any>,
  txHash: string,
  amountCents: number,
  memo: string | null,
  senderAddress: string
) {
  // Проверяем, игнорируется ли эта транзакция
  if (ignoredTransactions.has(txHash)) {
    return; // Игнорируем
  }

  // Проверяем, не отправляли ли уже уведомление об этой транзакции
  if (processedTransactions.has(txHash)) {
    return; // Уже уведомляли
  }

  // Добавляем в кэш
  processedTransactions.add(txHash);

  // Ограничиваем размер кэша (макс 1000 транзакций)
  if (processedTransactions.size > 1000) {
    const firstKey = processedTransactions.values().next().value;
    if (firstKey) processedTransactions.delete(firstKey);
  }

  const message = `<b>⚠️ НЕОПОЗНАННЫЙ ПЛАТЁЖ USDT</b>\n\n` +
    `💰 <b>Сумма:</b> ${(amountCents / 100).toFixed(2)} USDT\n` +
    `📝 <b>Комментарий:</b> ${memo || 'отсутствует'}\n` +
    `📤 <b>Отправитель:</b>\n<code>${senderAddress}</code>\n` +
    `🔗 <b>Hash:</b>\n<code>${txHash}</code>\n\n` +
    `<i>Платёж требует ручной проверки.\nИспользуйте /confirm_tx MEMO для подтверждения.</i>`;

  try {
    await bot.telegram.sendMessage(config.telegram.adminChatId, message, {
      parse_mode: 'HTML'
    });
  } catch (error) {
    console.error('Ошибка в notifyAdminsAboutUnmatchedPayment:', error);
  }
}

/**
 * Запускает периодическую проверку платежей
 */
export function startPaymentChecker(bot: Telegraf<any>, intervalSeconds: number = 30) {
  console.log(`🚀 Запущена периодическая проверка USDT платежей (каждые ${intervalSeconds} сек)`);

  // Первая проверка сразу
  checkIncomingUsdtTransfers(bot);

  // Периодическая проверка
  setInterval(() => {
    checkIncomingUsdtTransfers(bot);
  }, intervalSeconds * 1000);
}

/**
 * Очистка истекших платежей (запускается периодически)
 */
export async function cleanupExpiredPayments() {
  try {
    const expiredPayments = await prisma.payment.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() }
      },
      data: {
        status: 'EXPIRED'
      }
    });

    if (expiredPayments.count > 0) {
      console.log(`🧹 Очищено истекших платежей: ${expiredPayments.count}`);

      // Также обновляем статус бронирований
      await prisma.booking.updateMany({
        where: {
          paymentStatus: 'PENDING',
          payment: {
            status: 'EXPIRED'
          }
        },
        data: {
          status: 'EXPIRED',
          paymentStatus: 'EXPIRED'
        }
      });
    }
  } catch (error) {
    console.error('Ошибка в cleanupExpiredPayments:', error);
  }
}

/**
 * Старая функция для совместимости (проверяет TON, не USDT)
 * @deprecated Используйте checkIncomingUsdtTransfers
 */
export async function checkIncomingTransactions(bot: Telegraf<any>) {
  // Перенаправляем на новую функцию
  return checkIncomingUsdtTransfers(bot);
}
