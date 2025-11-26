import { Context, Markup } from 'telegraf';
import { prisma } from '../services/database';
import { config } from '../config';

/**
 * Обработчик выбора услуги
 */
export async function handleServiceSelect(ctx: Context, serviceId: string) {
  try {
    // Получаем услугу из БД
    const service = await prisma.service.findUnique({
      where: { serviceId }
    });

    if (!service) {
      await ctx.answerCbQuery('Услуга не найдена');
      return;
    }

    await ctx.answerCbQuery();

    // Для service_other сразу показываем анкету
    if (serviceId === 'service_other') {
      await handleOtherService(ctx, service.id);
      return;
    }

    // Для остальных услуг показываем описание
    await showServiceDescription(ctx, service);
  } catch (error) {
    console.error('Ошибка в handleServiceSelect:', error);
    await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
  }
}

/**
 * Показывает описание услуги и этапы работы
 */
async function showServiceDescription(ctx: Context, service: any) {
  const stages = JSON.parse(service.stages) as string[];
  const priceUsd = (service.priceUsd / 100).toFixed(0);

  let description = `<b>${service.name}</b>\n\n`;
  description += `💵 <b>Стоимость:</b> от $${priceUsd}\n`;
  description += `⏱ <b>Длительность:</b> ${service.durationMinutes} минут\n\n`;
  description += `${service.description}\n\n`;
  description += `<b>📋 Этапы работы:</b>\n`;

  stages.forEach((stage, index) => {
    description += `${index + 1}. ${stage}\n`;
  });

  await ctx.replyWithHTML(
    description,
    Markup.inlineKeyboard([
      [Markup.button.callback('📅 Забронировать', `book:${service.id}`)],
      [Markup.button.callback('« Назад к услугам', 'back:services')]
    ])
  );
}

/**
 * Обработчик для "Иные услуги" - сразу анкета
 */
async function handleOtherService(ctx: Context, serviceId: string) {
  if (!ctx.from) return;

  const text = `<b>Иные услуги</b>

Для подбора подходящей услуги заполните, пожалуйста, анкету. Наш менеджер свяжется с вами и подберёт оптимальное решение.

Начнём с первого вопроса:

<b>1. Как вас зовут?</b>
Пожалуйста, укажите ваше полное имя.`;

  // Сохраняем в состояние, что пользователь начал заполнять анкету для service_other
  // Здесь мы используем контекст сессии (будет настроено в bot.ts)
  if ('session' in ctx) {
    (ctx as any).session.surveyState = {
      step: 'name',
      serviceId,
      bookingId: null,
      answers: {}
    };
  }

  await ctx.replyWithHTML(text);
}

/**
 * Обработчик кнопки "Назад к услугам"
 */
export async function handleBackToServices(ctx: Context) {
  try {
    await ctx.answerCbQuery();

    // Получаем список услуг
    const services = await prisma.service.findMany({
      orderBy: { serviceId: 'asc' }
    });

    const welcomeText = `Выберите услугу:`;

    const buttons = services.map(service => {
      const price = service.priceUsd > 0 ? ` (от $${(service.priceUsd / 100).toFixed(0)})` : '';
      return [Markup.button.callback(service.name + price, `service:${service.serviceId}`)];
    });

    await ctx.editMessageText(welcomeText, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    });
  } catch (error) {
    console.error('Ошибка в handleBackToServices:', error);
  }
}
