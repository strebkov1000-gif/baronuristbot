import { Context } from 'telegraf';

import { prisma } from '../services/database';
import { getUserByTelegramId } from '../services/user';
import { config } from '../config';
import { confirmBooking } from '../services/booking';

export interface SurveyState {
  step: 'name' | 'phone' | 'problem' | 'materials' | 'completed';
  serviceId: string;
  bookingId: string | null;
  answers: {
    fullName?: string;
    phoneNumber?: string;
    problemDescription?: string;
    voiceMessageFileId?: string;
    materialsLink?: string;
  };
}

/**
 * Обработчик текстовых сообщений для анкеты
 */
export async function handleSurveyResponse(ctx: Context) {
  if (!ctx.from || !ctx.message || !('text' in ctx.message)) {
    return;
  }

  // Проверяем, есть ли активное состояние анкеты
  if (!('session' in ctx) || !(ctx as any).session.surveyState) {
    return;
  }

  const surveyState: SurveyState = (ctx as any).session.surveyState;
  const text = ctx.message.text;

  try {
    switch (surveyState.step) {
      case 'name':
        await handleNameResponse(ctx, surveyState, text);
        break;
      case 'phone':
        await handlePhoneResponse(ctx, surveyState, text);
        break;
      case 'problem':
        await handleProblemResponse(ctx, surveyState, text);
        break;
      case 'materials':
        await handleMaterialsResponse(ctx, surveyState, text);
        break;
    }
  } catch (error) {
    console.error('Ошибка в handleSurveyResponse:', error);
    await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
  }
}

/**
 * Обработчик голосовых сообщений для анкеты
 */
export async function handleVoiceResponse(ctx: Context) {
  if (!ctx.from || !ctx.message || !('voice' in ctx.message)) {
    return;
  }

  // Проверяем, есть ли активное состояние анкеты
  if (!('session' in ctx) || !(ctx as any).session.surveyState) {
    return;
  }

  const surveyState: SurveyState = (ctx as any).session.surveyState;

  // Голосовое сообщение принимается только на этапе описания проблемы
  if (surveyState.step !== 'problem') {
    return;
  }

  try {
    const fileId = ctx.message.voice.file_id;
    surveyState.answers.voiceMessageFileId = fileId;
    surveyState.answers.problemDescription = '[Голосовое сообщение]';

    // Переходим к следующему вопросу
    await askMaterialsLink(ctx, surveyState);
  } catch (error) {
    console.error('Ошибка в handleVoiceResponse:', error);
    await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
  }
}

/**
 * Обработка ответа на вопрос об имени
 */
async function handleNameResponse(ctx: Context, surveyState: SurveyState, name: string) {
  surveyState.answers.fullName = name;
  surveyState.step = 'phone';
  (ctx as any).session.surveyState = surveyState;

  await ctx.replyWithHTML(
    '<b>2. Ваш номер телефона</b>\n\nПожалуйста, укажите номер телефона для связи (в любом формате).'
  );
}

/**
 * Обработка ответа на вопрос о телефоне
 */
async function handlePhoneResponse(ctx: Context, surveyState: SurveyState, phone: string) {
  surveyState.answers.phoneNumber = phone;
  surveyState.step = 'problem';
  (ctx as any).session.surveyState = surveyState;

  await ctx.replyWithHTML(
    '<b>3. Опишите вашу проблему</b>\n\nВы можете написать текстом или отправить голосовое сообщение.'
  );
}

/**
 * Обработка ответа на вопрос о проблеме
 */
async function handleProblemResponse(ctx: Context, surveyState: SurveyState, problem: string) {
  surveyState.answers.problemDescription = problem;

  await askMaterialsLink(ctx, surveyState);
}

/**
 * Запрашивает ссылку на материалы
 */
async function askMaterialsLink(ctx: Context, surveyState: SurveyState) {
  surveyState.step = 'materials';
  (ctx as any).session.surveyState = surveyState;

  await ctx.replyWithHTML(
    '<b>4. Ссылка на материалы дела</b>\n\nЕсли у вас есть материалы (документы, договоры и т.п.), загрузите их на облачное хранилище (Google Drive, Dropbox и т.п.) и отправьте ссылку.\n\nЕсли материалов пока нет, напишите "нет" или "пропустить".'
  );
}

/**
 * Обработка ответа на вопрос о материалах
 */
async function handleMaterialsResponse(ctx: Context, surveyState: SurveyState, materials: string) {
  if (materials.toLowerCase() !== 'нет' && materials.toLowerCase() !== 'пропустить') {
    surveyState.answers.materialsLink = materials;
  }

  // Завершаем опрос
  await completeSurvey(ctx, surveyState);
}

/**
 * Завершение опроса и сохранение анкеты
 */
async function completeSurvey(ctx: Context, surveyState: SurveyState) {
  if (!ctx.from) return;

  try {
    // Получаем пользователя
    const user = await getUserByTelegramId(ctx.from.id);
    if (!user) {
      await ctx.reply('Ошибка: пользователь не найден');
      return;
    }

    // Сохраняем анкету в БД
    const survey = await prisma.userSurvey.create({
      data: {
        userId: user.id,
        serviceId: surveyState.serviceId,
        bookingId: surveyState.bookingId,
        fullName: surveyState.answers.fullName!,
        phoneNumber: surveyState.answers.phoneNumber!,
        problemDescription: surveyState.answers.problemDescription!,
        voiceMessageFileId: surveyState.answers.voiceMessageFileId,
        materialsLink: surveyState.answers.materialsLink,
        status: 'PENDING'
      }
    });

    // Если есть бронирование, подтверждаем его
    if (surveyState.bookingId) {
      await confirmBooking(surveyState.bookingId);
    }

    // Отправляем подтверждение пользователю
    await ctx.replyWithHTML(
      '<b>✅ Спасибо!</b>\n\nМы получили вашу анкету и материалы. Юрист свяжется с вами в выбранное время.'
    );

    // Отправляем информацию админам
    await sendSurveyToAdmins(ctx, user, surveyState, survey.id);

    // Очищаем состояние сессии
    surveyState.step = 'completed';
    delete (ctx as any).session.surveyState;
  } catch (error) {
    console.error('Ошибка в completeSurvey:', error);
    await ctx.reply('Произошла ошибка при сохранении анкеты. Пожалуйста, свяжитесь с менеджером.');
  }
}

/**
 * Отправляет информацию о заполненной анкете админам
 */
async function sendSurveyToAdmins(ctx: Context, user: any, surveyState: SurveyState, surveyId: string) {
  try {
    // Получаем информацию об услуге
    const service = await prisma.service.findUnique({
      where: { id: surveyState.serviceId }
    });

    // Получаем информацию о бронировании, если есть
    let bookingInfo = '';
    if (surveyState.bookingId) {
      const booking = await prisma.booking.findUnique({
        where: { id: surveyState.bookingId },
        include: { payment: true }
      });

      if (booking) {
        const startTimeFormatted = booking.startTime.toLocaleString('ru-RU', {
          timeZone: config.booking.timezone,
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        bookingInfo = `\n📅 <b>Дата консультации:</b> ${startTimeFormatted} (МСК)\n` +
          `💰 <b>Статус оплаты:</b> ${booking.paymentStatus}`;
      }
    }

    // Формируем сообщение
    let message = `<b>📋 НОВАЯ АНКЕТА</b>\n\n`;
    message += `🆔 <b>ID анкеты:</b> <code>${surveyId}</code>\n`;
    message += `👤 <b>Пользователь:</b> ${user.firstName || 'Не указано'}\n`;
    message += `📞 <b>Telegram:</b> @${user.username || 'нет'} (<code>${user.telegramId}</code>)\n`;
    message += `🔧 <b>Услуга:</b> ${service?.name || 'Не указано'}${bookingInfo}\n\n`;
    message += `<b>📝 Ответы на анкету:</b>\n\n`;
    message += `<b>Имя:</b> ${surveyState.answers.fullName}\n`;
    message += `<b>Телефон:</b> ${surveyState.answers.phoneNumber}\n`;
    message += `<b>Проблема:</b> ${surveyState.answers.problemDescription}\n`;

    if (surveyState.answers.materialsLink) {
      message += `<b>Материалы:</b> ${surveyState.answers.materialsLink}\n`;
    }

    // Отправляем в админ-чат
    await ctx.telegram.sendMessage(config.telegram.adminChatId, message, {
      parse_mode: 'HTML'
    });

    // Если есть голосовое сообщение, пересылаем его
    if (surveyState.answers.voiceMessageFileId) {
      await ctx.telegram.sendVoice(
        config.telegram.adminChatId,
        surveyState.answers.voiceMessageFileId,
        { caption: `🎤 Голосовое сообщение от ${surveyState.answers.fullName}` }
      );
    }
  } catch (error) {
    console.error('Ошибка в sendSurveyToAdmins:', error);
  }
}

/**
 * Запускает анкету после оплаты
 */
export async function startSurveyAfterPayment(
  ctx: Context,
  serviceId: string,
  bookingId: string
) {
  if (!ctx.from) return;

  const text = `<b>Спасибо за обращение!</b>

Для подготовки к консультации юристу нужно, чтобы вы заполнили анкету и направили все необходимые документы.

Пожалуйста, ответьте на вопросы:

<b>1. Ваше имя</b>
Пожалуйста, укажите ваше полное имя.`;

  // Сохраняем в состояние
  if ('session' in ctx) {
    (ctx as any).session.surveyState = {
      step: 'name',
      serviceId,
      bookingId,
      answers: {}
    };
  }

  await ctx.replyWithHTML(text);
}
