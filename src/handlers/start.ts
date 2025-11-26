import { Context, Markup } from 'telegraf';
import { findOrCreateUser, getReferralStats, getUserByTelegramId } from '../services/user';
import { prisma } from '../services/database';
import { config } from '../config';

/**
 * Обработчик команды /start
 */
export async function handleStart(ctx: Context) {
  try {
    if (!ctx.from) {
      return;
    }

    // Проверяем, есть ли реферальный код в параметрах
    const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const referralCode = messageText.split(' ')[1]; // /start REFCODE

    // Создаём или обновляем пользователя
    await findOrCreateUser({
      telegramId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      referralCode: referralCode
    });

    // Показываем главное меню
    await showMainMenu(ctx);
  } catch (error) {
    console.error('Ошибка в handleStart:', error);
    await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
  }
}

/**
 * Показывает главное меню бота с кнопкой открытия Mini App
 */
export async function showMainMenu(ctx: Context) {
  // Проверяем тип чата - WebApp кнопки работают только в личных сообщениях
  const isPrivateChat = ctx.chat?.type === 'private';

  if (isPrivateChat) {
    const welcomeText = `<b>PRAVO XII</b>

Юридические консультации онлайн.

💬 Поддержка: @nft_lawyer`;

    // Используем inline keyboard с webApp - она корректно передаёт initData
    await ctx.replyWithHTML(
      welcomeText,
      Markup.inlineKeyboard([
        [Markup.button.webApp('Записаться на консультацию', config.webapp.url)],
        [Markup.button.url('Написать в поддержку', 'https://t.me/nft_lawyer')]
      ])
    );
  } else {
    // В групповых чатах показываем ссылку на бота
    const botInfo = await ctx.telegram.getMe();
    const welcomeText = `<b>PRAVO XII</b>

Юридические консультации онлайн.

Для записи на консультацию напишите боту в личные сообщения:
@${botInfo.username}`;

    await ctx.replyWithHTML(welcomeText);
  }
}

/**
 * Показывает раздел "Юридические консультации" (старый стартовый экран)
 */
export async function showConsultationsMenu(ctx: Context) {
  // Получаем список услуг, сортируем от дешёвых к дорогим
  const services = await prisma.service.findMany({
    orderBy: { priceUsd: 'asc' }
  });

  const consultationsText = `<b>📋 Юридические консультации</b>

Через бота вы можете забронировать одну из услуг, которая подходит под вашу ситуацию.

<b>Онлайн-консультация</b> — без детального изучения документов и в рамках одного-двух созвонов.

<b>Письменная консультация</b> — это минимум два звонка: первый для получения подробностей и материалов вашей ситуации, второй — для ознакомления вас с результатом.

<b>Правовое заключение</b> — это письменная консультация с детальным изучением документов и материалов дела.

После выбора услуги вы сможете выбрать дату и время, а также внести предоплату для бронирования консультации.`;

  // Создаём кнопки для услуг
  const buttons = services.map(service => {
    const price = service.priceUsd > 0 ? ` (от $${(service.priceUsd / 100).toFixed(0)})` : '';
    return [Markup.button.callback(service.name + price, `service:${service.serviceId}`)];
  });

  // Добавляем кнопку "Назад"
  buttons.push([Markup.button.callback('« Главное меню', 'menu:main')]);

  await ctx.replyWithHTML(
    consultationsText,
    Markup.inlineKeyboard(buttons)
  );
}

/**
 * Показывает раздел "Мои записи"
 */
export async function showMyBookings(ctx: Context) {
  if (!ctx.from) return;

  const user = await getUserByTelegramId(ctx.from.id);
  if (!user) {
    await ctx.reply('Ошибка: пользователь не найден. Нажмите /start');
    return;
  }

  // Получаем бронирования пользователя
  const bookings = await prisma.booking.findMany({
    where: {
      userId: user.id,
      status: { in: ['CONFIRMED', 'PENDING'] }
    },
    include: { service: true },
    orderBy: { startTime: 'asc' }
  });

  let text = `<b>📅 Мои записи</b>\n\n`;

  if (bookings.length === 0) {
    text += 'У вас пока нет активных записей.\n\nЗапишитесь на консультацию через раздел "Юридические консультации".';
  } else {
    bookings.forEach((booking, index) => {
      const startTimeFormatted = booking.startTime.toLocaleString('ru-RU', {
        timeZone: config.booking.timezone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const statusEmoji = booking.status === 'CONFIRMED' ? '✅' : '⏳';
      const statusText = booking.status === 'CONFIRMED' ? 'Подтверждено' : 'Ожидает оплаты';

      text += `${index + 1}. <b>${booking.service.name}</b>\n`;
      text += `   📅 ${startTimeFormatted} (МСК)\n`;
      text += `   ${statusEmoji} ${statusText}\n\n`;
    });
  }

  await ctx.replyWithHTML(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback('« Главное меню', 'menu:main')]
    ])
  );
}

/**
 * Показывает раздел "Реферальная программа"
 */
export async function showReferralProgram(ctx: Context) {
  if (!ctx.from) return;

  const user = await getUserByTelegramId(ctx.from.id);
  if (!user) {
    await ctx.reply('Ошибка: пользователь не найден. Нажмите /start');
    return;
  }

  const stats = await getReferralStats(user.id);

  // Получаем username бота
  const botInfo = await ctx.telegram.getMe();
  const botUsername = botInfo.username;

  const referralLink = stats.referralCode
    ? `https://t.me/${botUsername}?start=${stats.referralCode}`
    : 'Код не найден';

  let text = `<b>👥 Реферальная программа</b>\n\n`;
  text += `Приглашайте друзей и получайте <b>5%</b> от стоимости каждой консультации, на которую они запишутся!\n\n`;
  text += `<b>Ваша реферальная ссылка:</b>\n`;
  text += `<code>${referralLink}</code>\n\n`;
  text += `<b>Статистика:</b>\n`;
  text += `👤 Приглашено друзей: ${stats.totalReferrals}\n`;
  text += `💰 Накоплено бонусов: $${(stats.totalBonus / 100).toFixed(2)}\n`;

  if (stats.referrals.length > 0) {
    text += `\n<b>Последние приглашённые:</b>\n`;
    stats.referrals.slice(0, 5).forEach(ref => {
      const name = ref.firstName || ref.username || 'Пользователь';
      const date = ref.createdAt.toLocaleDateString('ru-RU');
      text += `• ${name} (${date})\n`;
    });
  }

  await ctx.replyWithHTML(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback('📤 Поделиться ссылкой', 'referral:share')],
      [Markup.button.callback('« Главное меню', 'menu:main')]
    ])
  );
}
