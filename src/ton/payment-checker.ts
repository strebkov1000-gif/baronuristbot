import { TonClient, Address, Cell } from '@ton/ton';
import { JettonMaster, JettonWallet } from '@ton/ton';
import { config } from '../config';
import { prisma } from '../services/database';
import { Telegraf } from 'telegraf';

let tonClient: TonClient | null = null;
let ourJettonWalletAddress: Address | null = null;

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
 * Проверяет входящие USDT Jetton транзакции
 */
export async function checkIncomingUsdtTransfers(bot: Telegraf<any>) {
  try {
    const client = initTonClient();

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

    // Получаем адрес нашего USDT Jetton Wallet
    const jettonWalletAddress = await getOurJettonWalletAddress(client);

    // Получаем последние транзакции на Jetton Wallet
    const transactions = await client.getTransactions(jettonWalletAddress, {
      limit: 30
    });

    // Обрабатываем каждую транзакцию
    for (const tx of transactions) {
      try {
        if (tx.inMessage?.info.type === 'internal') {
          const body = tx.inMessage.body;

          if (body) {
            const slice = body.beginParse();

            if (slice.remainingBits >= 32) {
              const op = slice.loadUint(32);

              // 0x7362d09c = transfer_notification (входящий Jetton)
              if (op === 0x7362d09c) {
                const queryId = slice.loadUint(64);
                const amount = slice.loadCoins(); // USDT в micro-единицах (6 decimals)
                const senderAddress = slice.loadAddress();

                // Загружаем forward_payload (содержит memo)
                let forwardPayload: Cell | null = null;
                if (slice.remainingBits > 0 && slice.loadBit()) {
                  forwardPayload = slice.loadRef();
                } else if (slice.remainingBits > 0) {
                  forwardPayload = slice.asCell();
                }

                // Извлекаем комментарий/memo
                const memo = parseJettonComment(forwardPayload);

                // Конвертируем USDT (6 decimals) в центы
                const amountUsdt = Number(amount) / 1_000_000;
                const amountCents = Math.floor(amountUsdt * 100);

                const txHash = tx.hash().toString('hex');

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
                  senderAddress?.toString() || '',
                  tx.lt.toString()
                );
              }
            }
          }
        }
      } catch (error) {
        console.error('Ошибка обработки транзакции:', error);
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
    } else if (!payment) {
      // MEMO не найден в БД
      console.log(`⚠️ MEMO "${memo}" не найден в БД. Hash: ${txHash}`);
      await notifyAdminsAboutUnmatchedPayment(bot, txHash, amountCents, memo, senderAddress);
    }
  } else {
    // Нет MEMO или неверный формат
    console.log(`⚠️ Платёж без MEMO или неверный формат: "${memo}". Hash: ${txHash}`);
    await notifyAdminsAboutUnmatchedPayment(bot, txHash, amountCents, memo, senderAddress);
  }
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
        paymentStatus: 'COMPLETED'
      }
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
 * Уведомляет админов о неопознанном платеже
 */
async function notifyAdminsAboutUnmatchedPayment(
  bot: Telegraf<any>,
  txHash: string,
  amountCents: number,
  memo: string | null,
  senderAddress: string
) {
  const message = `<b>⚠️ НЕОПОЗНАННЫЙ ПЛАТЁЖ USDT</b>\n\n` +
    `💰 <b>Сумма:</b> ${(amountCents / 100).toFixed(2)} USDT\n` +
    `📝 <b>Комментарий:</b> ${memo || 'отсутствует'}\n` +
    `📤 <b>Отправитель:</b>\n<code>${senderAddress}</code>\n` +
    `🔗 <b>Hash:</b>\n<code>${txHash}</code>\n\n` +
    `<i>Платёж требует ручной проверки</i>`;

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
